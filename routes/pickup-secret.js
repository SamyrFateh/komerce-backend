/**
 * @komerce-arch
 * @role          pickup-secret
 * @domain        logistics
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       order_items, orders, pickup_print_tokens, pickup_reveal_codes, products, relais, users
 * @db-write      SET, avec, orders, pickup_print_tokens, pickup_reveal_codes
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

/**
 * KOMERCE — Pickup Secret API v1
 *
 * Implémentation du modèle Western Union pour Komerce :
 *   - Code secret généré AU MOMENT DU PAIEMENT (jamais avant)
 *   - Code hashé en DB (sha256 + salt unique par commande)
 *   - Le code clair n'est renvoyé qu'UNE SEULE FOIS (au moment de la génération)
 *   - Validation du code au moment du retrait avec rate limit
 *
 * Voir /docs/SECURITY-MODEL.md pour la doctrine complète.
 *
 * Routes :
 *   POST /api/pickup/pay-cash/:orderId   — Encaissement cash → génère le code
 *   GET  /api/pickup/receipt/:orderId    — HTML imprimable du reçu (agent only, one-shot)
 *   POST /api/pickup/verify/:orderId     — Vérifier un code au retrait (rate-limited)
 *   POST /api/pickup/collect/:orderId    — Marquer comme récupéré (après verify OK)
 *   POST /api/pickup/regenerate/:orderId — Admin : régénérer un code (perte de reçu)
 */

'use strict';

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { transitionOrderStatus } = require('../services/order-status-machine');
const { confirmPickupCashPayment } = require('../services/confirm-pickup-cash-payment');
const log = require('../utils/logger').child({ module: 'pickup-secret' });
const { buildReceiptHTML, escapeHTML } = require('../utils/pickup-receipt-html');

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

// Alphabet sans confusion visuelle : pas de 0/O/I/1/l
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH   = 8;

/**
 * Génère un code secret de 8 caractères groupés par 3 : "A7K-3M9-P2"
 * Espace de code : 32^8 = 1.1e12 combinaisons
 */
function generatePickupCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let raw = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    raw += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  // Formatter : A7K-3M9-P2 (groupes 3-3-2)
  return raw.slice(0, 3) + '-' + raw.slice(3, 6) + '-' + raw.slice(6, 8);
}

/**
 * Hash un code avec salt (sha256)
 */
function hashCode(code, salt) {
  const normalized = String(code).replace(/[-\s]/g, '').toUpperCase();
  return crypto.createHash('sha256').update(normalized + salt).digest('hex');
}

/**
 * Normalise un code saisi (retire tirets et espaces, upper-case)
 */
function normalizeCode(input) {
  return String(input || '').replace(/[-\s]/g, '').toUpperCase();
}

// Helper : rôle agent relais ou admin
function isRelaisOrAdmin(req) {
  const role = req.user?.role;
  return role === 'admin' || role === 'agent_relais';
}
function requireRelaisOrAdmin(req, res, next) {
  if (!isRelaisOrAdmin(req)) {
    return res.status(403).json({ error: 'Accès réservé agents relais et admin' });
  }
  next();
}

// ══════════════════════════════════════════════════════════════════════════════
// FONCTION UTILITAIRE PARTAGÉE — Génération anti-collision + stockage DB
// ══════════════════════════════════════════════════════════════════════════════
//
// Utilisée par tous les canaux d'émission du code :
//   • POST /pay-cash (agent relais)       → channel = 'cash_relais'
//   • Webhook Stripe (payment_intent OK)  → channel = 'stripe'
//   • Callback Mobile Money               → channel = 'mobile_money'
//   • Validation Wallet                   → channel = 'wallet'
//   • Regenerate admin (perte)            → channel = passé en paramètre
//
// Renvoie { code, last4 } — le code CLAIR ne doit être utilisé qu'UNE FOIS
// (affichage écran ou impression), jamais stocké ailleurs que dans le hash.
//
// dbClient : optionnel, si fourni utilise cette connexion (pour transaction)
//            sinon utilise le pool global
// excludeOrderId : pour regenerate, ignore la commande elle-même dans l'anti-collision

async function generateAndStoreSecret({
  orderId,
  relaisId = null,
  channel,
  dbClient = null,
  excludeOrderId = null,
  extraUpdates = {},  // colonnes additionnelles à updater au même moment (métadonnées canal)
}) {
  if (!orderId) throw new Error('generateAndStoreSecret: orderId requis');
  if (!channel) throw new Error('generateAndStoreSecret: channel requis');

  const dbHandle = dbClient || db;

  // Génération anti-collision au niveau du relais
  let code, last4, hash;
  const salt = crypto.randomBytes(16).toString('hex');
  const MAX_GEN_ATTEMPTS = 50;
  let attempts = 0;

  while (attempts < MAX_GEN_ATTEMPTS) {
    code  = generatePickupCode();
    last4 = code.replace(/-/g, '').slice(-4);

    // Vérifier unicité du last4 parmi les codes ACTIFS du même relais
    const params = [last4, relaisId];
    let query = `
      SELECT id FROM orders
      WHERE pickup_secret_last4 = $1
        AND relais_id IS NOT DISTINCT FROM $2
        AND status NOT IN ('collected', 'cancelled', 'refunded')
        AND (pickup_secret_expires_at IS NULL OR pickup_secret_expires_at > NOW())
    `;
    if (excludeOrderId) {
      query += ` AND id <> $3`;
      params.push(excludeOrderId);
    }
    query += ` LIMIT 1`;

    const { rows: [dup] } = await dbHandle.query(query, params);
    if (!dup) break;
    attempts++;
  }

  if (attempts >= MAX_GEN_ATTEMPTS) {
    log.error(`[PICKUP-SECRET] Saturation anti-collision relais=${relaisId} channel=${channel}`);
    throw new Error('Génération du code impossible (saturation)');
  }

  hash = hashCode(code, salt);
  const now     = new Date();
  const expires = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // +60 jours

  // Construire l'UPDATE avec les colonnes de base + extras (stripe metadata, etc.)
  const baseCols = {
    pickup_secret_hash:            hash,
    pickup_secret_salt:            salt,
    pickup_secret_last4:           last4,
    pickup_secret_created_at:      now,
    pickup_secret_expires_at:      expires,
    pickup_secret_attempts:        0,
    pickup_secret_blocked_until:   null,
    pickup_secret_channel:         channel,
    pickup_secret_emitted_at:      now,
  };
  const allCols = Object.assign({}, baseCols, extraUpdates || {});
  const colNames = Object.keys(allCols);
  const setClauses = colNames.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const values = colNames.map(c => allCols[c]);
  values.push(orderId);

  await dbHandle.query(
    `UPDATE orders SET ${setClauses}, updated_at = NOW() WHERE id = $${values.length}`,
    values
  );

  log.info(`[PICKUP-SECRET] ✅ Code généré channel=${channel} order=${orderId} last4=${last4}`);

  return { code, last4 };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. POST /pay-cash/:orderId — Encaissement cash, génère le code secret
// ══════════════════════════════════════════════════════════════════════════════
// L'agent encaisse le cash. Le backend génère le code. Le code clair est renvoyé
// UNE SEULE FOIS (l'agent doit l'imprimer immédiatement). Après ça, seul le hash
// reste en DB.
router.post('/pay-cash/:orderId', authenticate, requireRelaisOrAdmin, async (req, res, next) => {
  try {
    const result = await confirmPickupCashPayment({
      orderId: req.params.orderId,
      user: req.user,
      payload: req.body,
      generateAndStoreSecret,
    });

    if (result.status !== 200) {
      return res.status(result.status).json(result.body);
    }

    const printToken = crypto.randomBytes(24).toString('hex');
    // SEC-1b : INSERT en DB (pickup_print_tokens) — survit aux redémarrages + multi-instance (2026-05-26)
    await db.query(
      `INSERT INTO pickup_print_tokens (token, order_id, code, payer_name, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '2 minutes')
       ON CONFLICT (token) DO NOTHING`,
      [printToken, result.body.order_id, result.body.code, result.body.payer_name || null]
    );

    res.json({
      success:     true,
      message:     result.body.message,
      code:        result.body.code,
      print_token: printToken,
      order_ref:   result.body.order_ref,
      amount_kmf:  result.body.amount_kmf,
    });

    // Post-commit hooks — fire-and-forget, non-bloquants
    try {
      const loyaltyService = require('../services/loyalty-service');
      loyaltyService.handleOrderConfirmed({ orderId: result.body.order_id })
        .then(r => { if (r && !r.skipped) log.info('[loyalty] hook OK:', r); })
        .catch(e => log.warn({ err: e }, '[loyalty] hook error:'));
    } catch (_) { /* non-bloquant */ }

    try {
      const { triggerPurchasing } = require('./purchasing');
      triggerPurchasing(result.body.order_id)
        .then(r => log.info('[PURCHASING] Pickup cash trigger OK:', result.body.order_ref, r))
        .catch(e => log.error('[PURCHASING] Pickup cash trigger error:', result.body.order_ref, e.message));
    } catch (e) {
      log.error({ err: e }, '[PICKUP-CASH-POSTCOMMIT] triggerPurchasing load error:');
    }

  } catch (err) { next(err); }
});

// SEC-1b : printTokens Map in-memory supprimée (2026-05-26).
// Les tokens d'impression sont persistés dans pickup_print_tokens (migration 070).
// Le nettoyage est assuré par startPickupTokenCleanupCron (bootstrap/crons.js).

// ══════════════════════════════════════════════════════════════════════════════
// 2. GET /receipt/:orderId?token=... — HTML imprimable du reçu
// ══════════════════════════════════════════════════════════════════════════════
// Accès protégé par print_token (valable 2 min après encaissement).
// Retourne un HTML prêt à être imprimé (window.print()).
router.get('/receipt/:orderId', authenticate, requireRelaisOrAdmin, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { token }   = req.query;

    if (!token) {
      return res.status(400).send('<h1>Token manquant</h1>');
    }

    // SEC-1b : lecture depuis DB (pickup_print_tokens) (2026-05-26)
    const { rows: [tokenData] } = await db.query(
      `DELETE FROM pickup_print_tokens
        WHERE token = $1 AND order_id = $2 AND expires_at > NOW()
        RETURNING order_id, code, payer_name, expires_at`,
      [token, orderId]
    );
    if (!tokenData) {
      return res.status(403).send('<h1>Token invalide ou expiré</h1>');
    }
    const data = { orderId: tokenData.order_id, code: tokenData.code, payer_name: tokenData.payer_name };

    // Récupérer les détails de la commande pour le reçu
    const { rows: [order] } = await db.query(`
      SELECT
        o.reference, o.total_kmf, o.created_at,
        o.payment_received_at,
        o.payer_name,
        r.name AS relais_name, r.zone AS relais_city,
        u.full_name AS agent_name
      FROM orders o
      LEFT JOIN relais r ON r.id = o.relais_id
      LEFT JOIN users u ON u.id = o.payment_received_by_agent_id
      WHERE o.id = $1
    `, [orderId]);

    if (!order) {
      return res.status(404).send('<h1>Commande introuvable</h1>');
    }

    // Récupérer les articles
    const { rows: items } = await db.query(`
      SELECT oi.quantity, oi.price_kmf, p.name AS product_name
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1
    `, [orderId]);

    // Générer le HTML imprimable
    const html = buildReceiptHTML({
      code:       data.code,
      order,
      items,
    });

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);

  } catch (err) { next(err); }
});

router.post('/verify/:orderId', authenticate, requireRelaisOrAdmin, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { code }    = req.body;
    const agentId     = req.user.id;

    if (!code) {
      return res.status(400).json({ error: 'Code requis' });
    }

    const { rows: [order] } = await db.query(`
      SELECT id, reference, status,
             pickup_secret_hash, pickup_secret_salt, pickup_secret_last4,
             pickup_secret_expires_at,
             pickup_secret_attempts, pickup_secret_blocked_until
      FROM orders WHERE id = $1
    `, [orderId]);

    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }
    if (!order.pickup_secret_hash) {
      return res.status(400).json({ error: 'Cette commande n\'a pas encore de code (paiement non effectué ?)' });
    }

    // Rate limit : si bloqué, refuser
    const now = new Date();
    if (order.pickup_secret_blocked_until && new Date(order.pickup_secret_blocked_until) > now) {
      const retryAfter = Math.ceil((new Date(order.pickup_secret_blocked_until) - now) / 1000 / 60);
      return res.status(429).json({
        error: `Trop de tentatives. Réessayez dans ${retryAfter} min.`,
        blocked_until: order.pickup_secret_blocked_until,
      });
    }

    // Expiration du code ?
    if (order.pickup_secret_expires_at && new Date(order.pickup_secret_expires_at) < now) {
      return res.status(410).json({ error: 'Code expiré. Escalade admin nécessaire.' });
    }

    // Vérifier le code : 2 modes selon la longueur saisie
    // - 4 chars : compare avec pickup_secret_last4 (saisie rapide au guichet)
    // - 8 chars (code complet) : compare avec le hash salé
    const normalized = normalizeCode(code);
    let matched = false;

    if (normalized.length === 4) {
      // Mode court : comparaison directe du last4 (non-sensible, unique par relais actif)
      matched = !!(order.pickup_secret_last4 && normalized === order.pickup_secret_last4);
    } else if (normalized.length === 8) {
      // Mode complet : comparaison du hash
      const testHash = hashCode(normalized, order.pickup_secret_salt);
      matched = (testHash === order.pickup_secret_hash);
    } else {
      return res.status(400).json({ error: 'Code attendu : 4 caractères (raccourci) ou 8 caractères (complet)' });
    }

    if (!matched) {
      // Incrémenter le compteur de tentatives
      const attempts = (order.pickup_secret_attempts || 0) + 1;
      let blockUntil = null;
      if (attempts >= 3) {
        blockUntil = new Date(now.getTime() + 15 * 60 * 1000); // +15 min
      }
      await db.query(`
        UPDATE orders
        SET pickup_secret_attempts     = $1,
            pickup_secret_blocked_until = $2,
            updated_at                 = NOW()
        WHERE id = $3
      `, [attempts, blockUntil, orderId]);

      log.warn(`[PICKUP-SECRET] Tentative échouée ${attempts}/3 pour ${order.reference} agent=${agentId}`);

      return res.status(401).json({
        error: 'Code incorrect',
        attempts,
        remaining: Math.max(0, 3 - attempts),
        blocked_until: blockUntil,
      });
    }

    // Succès : reset compteur, ne pas marquer collected encore (séparation verify/collect)
    await db.query(`
      UPDATE orders
      SET pickup_secret_attempts = 0,
          pickup_secret_blocked_until = NULL,
          updated_at = NOW()
      WHERE id = $1
    `, [orderId]);

    log.info(`[PICKUP-SECRET] ✅ Code vérifié pour ${order.reference}`);

    res.json({
      success: true,
      message: 'Code valide. Vous pouvez remettre le colis.',
      order_ref: order.reference,
    });

  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. POST /collect/:orderId — Marquer la commande comme récupérée
// ══════════════════════════════════════════════════════════════════════════════
// À appeler après un verify réussi et remise physique du colis.
router.post('/collect/:orderId', authenticate, requireRelaisOrAdmin, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const agentId     = req.user.id;
    const { collected_by_name } = req.body;

    const { rows: [order] } = await db.query(`
      SELECT id, reference, status FROM orders WHERE id = $1
    `, [orderId]);

    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }
    if (order.status === 'collected') {
      return res.status(409).json({ error: 'Cette commande est déjà marquée comme récupérée' });
    }

    const transition = await transitionOrderStatus({
      orderId,
      newStatus: 'collected',
      actor: { id: agentId, role: req.user.role },
      source: 'patch',
      note: 'Colis remis apres verification du code retrait',
    });
    if (!transition.success && !transition.noop) {
      return res.status(409).json({ error: transition.error });
    }

    await db.query(`
      UPDATE orders
      SET collected_by_name = $1,
          updated_at        = NOW()
      WHERE id = $2
    `, [collected_by_name || null, orderId]);

    log.info(`[PICKUP-SECRET] 📦 Colis remis pour ${order.reference} à "${collected_by_name || '(anonyme)'}"`);

    res.json({
      success: true,
      message: 'Colis remis. Commande marquée comme récupérée.',
      order_ref: order.reference,
    });

  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. POST /regenerate/:orderId — Admin régénère un code (perte de reçu)
// ══════════════════════════════════════════════════════════════════════════════
// Réservé admin. Invalide l'ancien code et en génère un nouveau.
// Utilisé quand un client vient déclarer la perte de son reçu après avoir
// présenté sa pièce d'identité.
router.post('/regenerate/:orderId', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const adminId     = req.user.id;
    const { reason }  = req.body;

    if (!reason || reason.trim().length < 5) {
      return res.status(400).json({ error: 'Motif obligatoire (min 5 caractères)' });
    }

    const { rows: [order] } = await db.query(`
      SELECT id, reference, pickup_secret_hash, relais_id FROM orders WHERE id = $1
    `, [orderId]);

    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    // Génération anti-collision last4 (même logique que pay-cash)
    let code, last4, hash;
    const salt = crypto.randomBytes(16).toString('hex');
    let attempts = 0;
    const MAX_GEN_ATTEMPTS = 50;
    while (attempts < MAX_GEN_ATTEMPTS) {
      code  = generatePickupCode();
      last4 = code.replace(/-/g, '').slice(-4);
      const { rows: [dup] } = await db.query(`
        SELECT id FROM orders
        WHERE pickup_secret_last4 = $1
          AND relais_id IS NOT DISTINCT FROM $2
          AND id <> $3
          AND status NOT IN ('collected', 'cancelled', 'refunded')
          AND (pickup_secret_expires_at IS NULL OR pickup_secret_expires_at > NOW())
        LIMIT 1
      `, [last4, order.relais_id || null, orderId]);
      if (!dup) break;
      attempts++;
    }
    if (attempts >= MAX_GEN_ATTEMPTS) {
      return res.status(500).json({ error: 'Génération du code impossible (saturation)' });
    }
    hash = hashCode(code, salt);
    const now     = new Date();
    const expires = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    await db.query(`
      UPDATE orders
      SET pickup_secret_hash        = $1,
          pickup_secret_salt        = $2,
          pickup_secret_last4       = $7,
          pickup_secret_created_at  = $3,
          pickup_secret_expires_at  = $4,
          pickup_secret_attempts    = 0,
          pickup_secret_blocked_until = NULL,
          pickup_secret_regen_count = COALESCE(pickup_secret_regen_count, 0) + 1,
          pickup_secret_regen_reason = $5,
          updated_at = NOW()
      WHERE id = $6
    `, [hash, salt, now, expires, reason.trim(), orderId, last4]);

    log.info(`[PICKUP-SECRET] 🔄 Régénéré pour ${order.reference} par admin ${adminId} motif="${reason}"`);

    // Le nouveau code en clair est renvoyé à l'admin UNE SEULE FOIS
    // L'admin est responsable de le transmettre par canal sécurisé à l'agent relais
    res.json({
      success: true,
      message: 'Nouveau code généré. Transmettez-le par canal sécurisé à l\'agent relais.',
      code,
      order_ref: order.reference,
    });

  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. GET /status/:orderId — Status du code (pas le code clair, jamais)
// ══════════════════════════════════════════════════════════════════════════════
// Utile pour l'agent relais qui cherche à savoir si une commande a déjà un code
// (= payée) ou pas encore.
router.get('/status/:orderId', authenticate, requireRelaisOrAdmin, async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const { rows: [order] } = await db.query(`
      SELECT o.id, o.reference, o.status, o.payment_status, o.total_kmf,
             o.payer_name,
             o.tracking_phone,
             o.tracking_phone_secondary,
             o.tracking_phone_confirmed_at,
             o.pickup_secret_created_at,
             o.pickup_secret_expires_at,
             o.pickup_secret_attempts,
             o.pickup_secret_blocked_until,
             o.pickup_secret_regen_count,
             o.pickup_secret_last4,
             o.collected_at, o.collected_by_name,
             u.full_name AS client_name,
             u.phone     AS client_phone
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1
    `, [orderId]);

    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    res.json({
      order_ref: order.reference,
      status: order.status,
      payment_status: order.payment_status,
      total_kmf: Number(order.total_kmf || 0),
      client_name: order.client_name,
      payer_name: order.payer_name,
      tracking: {
        // Numéro principal : priorité à tracking_phone, fallback sur phone user
        primary:   order.tracking_phone || order.client_phone || null,
        secondary: order.tracking_phone_secondary || null,
        confirmed_at: order.tracking_phone_confirmed_at,
      },
      secret: {
        exists: !!order.pickup_secret_created_at,
        created_at: order.pickup_secret_created_at,
        expires_at: order.pickup_secret_expires_at,
        attempts: order.pickup_secret_attempts || 0,
        blocked_until: order.pickup_secret_blocked_until,
        regen_count: order.pickup_secret_regen_count || 0,
        // Affichage masqué à l'agent : "•••-•••-XX" (les 4 derniers chars visibles)
        // L'agent n'a jamais accès au code complet via l'API, c'est voulu.
        last4:  order.pickup_secret_last4 || null,
        masked: order.pickup_secret_last4
                  ? ('•••-•' + order.pickup_secret_last4.slice(0, 2) + '-' + order.pickup_secret_last4.slice(2))
                  : null,
      },
      collected: {
        at: order.collected_at,
        by_name: order.collected_by_name,
      },
    });

  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. GET /reveal-once/:orderId — Révélation du code au payeur (UNE FOIS)
// ══════════════════════════════════════════════════════════════════════════════
//
// Utilisé par la boutique après paiement Stripe / Wallet pour afficher le code
// au PAYEUR (pas à un agent) UNE SEULE FOIS.
//
// Contraintes de sécurité :
//   • Le code ne peut être révélé qu'à l'utilisateur authentifié qui est le
//     propriétaire de la commande (user_id match)
//   • Le code n'est renvoyé QU'UNE FOIS — au premier appel réussi on marque
//     pickup_secret_revealed_at, les appels suivants renvoient un 410 Gone
//   • Fenêtre serrée : doit être appelé dans les 30 minutes après émission
//   • Si déjà révélé → 410 Gone avec procédure de perte comme message
//
// Ce endpoint est le seul moyen d'obtenir le code clair pour Stripe/Wallet/MM.
// Cash utilise /receipt/:orderId qui est côté agent.

router.get('/reveal-once/:orderId', authenticate, async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const userId      = req.user.id;

    // 1. Vérifier que l'utilisateur est bien propriétaire de la commande
    const { rows: [order] } = await db.query(`
      SELECT id, reference, user_id,
             pickup_secret_channel,
             pickup_secret_emitted_at,
             pickup_secret_revealed_at,
             pickup_secret_last4,
             pickup_secret_hash,
             pickup_secret_salt,
             total_kmf
      FROM orders WHERE id = $1
    `, [orderId]);

    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    if (order.user_id && order.user_id !== userId) {
      return res.status(403).json({ error: 'Cette commande ne vous appartient pas' });
    }

    // 2. Pas de code = paiement pas encore validé par Stripe/MM (webhook en retard)
    if (!order.pickup_secret_hash) {
      return res.status(202).json({
        status: 'pending',
        message: 'Paiement en cours de validation, réessayez dans quelques secondes',
      });
    }

    // 3. Code déjà révélé → 410 Gone (procédure de perte)
    if (order.pickup_secret_revealed_at) {
      return res.status(410).json({
        error: 'Code déjà révélé une fois',
        already_revealed_at: order.pickup_secret_revealed_at,
        message: 'Pour retrouver votre code, utilisez la procédure de perte.',
        // Pour aider l'UI à afficher la preuve masquée
        masked: order.pickup_secret_last4
                  ? ('•••-•••-' + order.pickup_secret_last4.slice(-2))
                  : null,
      });
    }

    // 4. Fenêtre temporelle : 30 minutes max après émission
    const emittedAt = new Date(order.pickup_secret_emitted_at);
    const windowEnd = new Date(emittedAt.getTime() + 30 * 60 * 1000);
    if (new Date() > windowEnd) {
      return res.status(410).json({
        error: 'Fenêtre de révélation expirée',
        message: 'Le code ne peut plus être affiché. Utilisez la procédure de perte.',
        masked: order.pickup_secret_last4
                  ? ('•••-•••-' + order.pickup_secret_last4.slice(-2))
                  : null,
      });
    }

    // 5. Révélation : on ne peut PAS reconstruire le code depuis le hash (c'est
    //    le principe du hash). Donc on stocke temporairement le code clair en
    //    DB (table pickup_reveal_codes, TTL 30 min) au moment de la génération.
    //    Migré de REVEAL_CACHE (Map in-memory) vers DB en SEC-1 / migration 070.
    const { rows: [revealRow] } = await db.query(
      'SELECT code FROM pickup_reveal_codes WHERE order_id = $1 AND expires_at > NOW()',
      [orderId]
    );
    if (!revealRow) {
      // Ligne absente ou expirée → 410 (redémarrage, délai dépassé)
      return res.status(410).json({
        error: 'Code non disponible',
        message: 'Le code n\'est plus disponible (redémarrage serveur ou expiration). Utilisez la procédure de perte.',
        masked: order.pickup_secret_last4
                  ? ('•••-•••-' + order.pickup_secret_last4.slice(-2))
                  : null,
      });
    }

    // 6. Marquer comme révélé + supprimer de la table immédiatement (one-shot)
    await Promise.all([
      db.query('UPDATE orders SET pickup_secret_revealed_at = NOW() WHERE id = $1', [orderId]),
      db.query('DELETE FROM pickup_reveal_codes WHERE order_id = $1', [orderId]),
    ]);

    log.info(`[PICKUP-SECRET] 👁 Code révélé (one-shot) order=${orderId} channel=${order.pickup_secret_channel}`);

    // 7. Générer le payload QR (format KMR1.base64url)
    const qrPayloadRaw = JSON.stringify({ c: revealRow.code, o: order.reference });
    const qrPayload = 'KMR1.' + Buffer.from(qrPayloadRaw)
      .toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    return res.json({
      order_ref:   order.reference,
      code:        revealRow.code, // [M1] fix: cached n'existe pas ici, la source est revealRow
      qr_payload:  qrPayload,
      channel:     order.pickup_secret_channel,
      total_kmf:   Number(order.total_kmf || 0),
      expires_in_days: 60,
      warning:     'Ce code ne s\'affichera qu\'une seule fois. Notez-le ou prenez une capture d\'écran maintenant.',
    });

  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// cacheCodeForReveal — persistance DB du code en attente de révélation (SEC-1)
// ══════════════════════════════════════════════════════════════════════════════
// Remplace la Map REVEAL_CACHE in-memory par la table pickup_reveal_codes
// (migration 070). Survit aux redémarrages et fonctionne en multi-instance.
//
// TTL 30 min : si le client ne revient pas (navigateur fermé, timeout),
// le cron startPickupTokenCleanupCron() purge les lignes expirées toutes les 5 min.
// → procédure de perte obligatoire passé ce délai.

async function cacheCodeForReveal(orderId, code) {
  await db.query(
    `INSERT INTO pickup_reveal_codes (order_id, code, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '30 minutes')
     ON CONFLICT (order_id) DO UPDATE
       SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at`,
    [orderId, code]
  );
}

module.exports = router;
module.exports.generateAndStoreSecret = generateAndStoreSecret;
module.exports.cacheCodeForReveal = cacheCodeForReveal;
