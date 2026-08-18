/**
 * @komerce-arch
 * @role          pickup-secret
 * @domain        logistics
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*, services/order-mutation-service.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       order_items, orders, pickup_print_tokens, pickup_reveal_codes, products, relais, users
 * @db-write      pickup_print_tokens, pickup_reveal_codes
 * @db-write-via:order-mutation-service orders
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
 *
 * Lot 5 — retrait exceptionnel par autorisation nominative (substitution,
 * jamais le moyen normal) :
 *   GET  /api/pickup/exceptional-pickup/:orderId         — Disponibilité (booléen, jamais le nom)
 *   POST /api/pickup/exceptional-pickup/:orderId/collect — Remise après contrôle de pièce
 */

'use strict';

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { pickup } = require('../validators');
const { transitionOrderStatus } = require('../services/order-status-machine');
const { confirmPickupCashPayment } = require('../services/confirm-pickup-cash-payment');
const { markPickupSecretRevealed } = require('../services/order-mutation-service');
const log = require('../utils/logger').child({ module: 'pickup-secret' });
const { buildReceiptHTML, escapeHTML } = require('../utils/pickup-receipt-html');
// O7.2 (Cycle B) : generatePickupCode/hashCode/generateAndStoreSecret/
// cacheCodeForReveal étaient dupliqués ici alors qu'un service équivalent,
// déjà testé, existait sans être câblé (services/pickup-secret-service.js,
// logistics). On délègue désormais à ce service — comportement runtime
// identique (code repris à l'identique dans le service). C'est aussi ce qui
// permet à services/payment-paypal.js et services/payment-stripe.js
// (payments) de ne plus importer un fichier ROUTE pour générer un code
// retrait au moment du paiement. Voir docs/O7_2_CYCLE_ANALYSIS.md, Cycle B.
const {
  generateAndStoreSecret, cacheCodeForReveal,
  verifyPickupCode, regenerateCode,
  getExceptionalPickupAvailability, collectByAuthorizedName,
} = require('../services/pickup-secret-service');

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

// generatePickupCode / hashCode / normalizeCode / verifyPickupCode / regenerateCode :
// voir services/pickup-secret-service.js — seul propriétaire de la logique
// métier du secret de retrait (Lot 2C).

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
// generateAndStoreSecret : voir services/pickup-secret-service.js (O7.2 Cycle B)

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
      // O7.2 (Cycle B) : importait auparavant routes/purchasing.js (une route,
      // pas une boundary de feature) pour son ré-export de compatibilité.
      // triggerPurchasing est un vrai service purchasing — on le prend
      // directement. Voir docs/O7_2_CYCLE_ANALYSIS.md, Cycle B.
      const { triggerPurchasing } = require('../services/purchasing-trigger-service');
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

    // Lot 2C : logique métier (rate limit, expiration, comparaison hash
    // salé, compteurs) déléguée à pickup-secret-service.verifyPickupCode.
    // Le routeur reste un adaptateur HTTP pur.
    const result = await verifyPickupCode({ orderId, code, agentId });
    res.status(result.status).json(result.body);

  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. POST /collect/:orderId — Marquer la commande comme récupérée
// ══════════════════════════════════════════════════════════════════════════════
// À appeler après un verify réussi et remise physique du colis.
// Cycle B (O7.2) : la logique inline de collect a été déplacée dans
// services/pickup-secret-service.js:collectOrder, comme pour les autres
// fonctions de ce fichier. collectOrder pose désormais un FOR UPDATE +
// relecture dans une transaction unique (résolution @db-txn
// resolve_before_behavior_change). Le routeur reste un adaptateur HTTP.
router.post('/collect/:orderId', authenticate, requireRelaisOrAdmin, async (req, res, next) => {
  try {
    const { collectOrder } = require('../services/pickup-secret-service');
    const result = await collectOrder({
      orderId:         req.params.orderId,
      agentId:         req.user.id,
      role:            req.user.role,
      collectedByName: req.body.collected_by_name,
    });
    res.status(result.status).json(result.body);
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

    // Lot 2C : génération anti-collision, contrôle du motif et compteur de
    // régénérations délégués à pickup-secret-service.regenerateCode. Le
    // routeur reste un adaptateur HTTP pur — préserve exactement le
    // contrôle admin, le motif obligatoire, la révélation unique du
    // nouveau code, et l'absence de code dans les logs.
    const result = await regenerateCode({ orderId, adminId, reason });
    res.status(result.status).json(result.body);

  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// 5bis. Retrait exceptionnel par autorisation nominative (Lot 5)
// ══════════════════════════════════════════════════════════════════════════════
// Substitution exceptionnelle au code secret — jamais le moyen normal. Voir
// services/pickup-secret-service.js pour la doctrine complète (§ du lot).
// Le routeur reste un adaptateur HTTP pur, comme pour le reste du fichier.

router.get(
  '/exceptional-pickup/:orderId',
  authenticate,
  requireRelaisOrAdmin,
  validate(pickup.exceptionalAvailability),
  async (req, res, next) => {
  try {
    const result = await getExceptionalPickupAvailability({
      orderId: req.params.orderId,
      agentId: req.user.id,
      role:    req.user.role,
    });
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
  }
);

router.post(
  '/exceptional-pickup/:orderId/collect',
  authenticate,
  requireRelaisOrAdmin,
  validate(pickup.exceptionalCollect),
  async (req, res, next) => {
  try {
    const result = await collectByAuthorizedName({
      orderId:         req.params.orderId,
      agentId:         req.user.id,
      role:            req.user.role,
      givenNames:      req.body.given_names,
      familyName:      req.body.family_name,
      documentChecked: req.body.document_checked,
    });
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
  }
);

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
      markPickupSecretRevealed(db, orderId),
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

// cacheCodeForReveal : voir services/pickup-secret-service.js (O7.2 Cycle B)

module.exports = router;
