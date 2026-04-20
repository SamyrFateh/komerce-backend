/**
 * KOMERCE — Points relais
 *
 * GET  /api/relais            → liste tous les relais actifs (public)
 * GET  /api/relais/public     → alias public
 * GET  /api/relais/:id        → détail d'un relais
 *
 * ── ROUTES ANTI-FRAUDE (migration 014) ────────────────────────────────────────
 *
 * POST /api/relais/handover
 *   L'agent relais entre le code présenté par le client → colis marqué "collected".
 *   Première barrière : sans le code reçu sur le WhatsApp du client, impossible
 *   de marquer la remise comme effectuée.
 *
 * POST /api/relais/declare-reverse
 *   L'agent relais déclare avoir envoyé l'argent à Komerce.
 *   cash_reverse_status → 'declared'. Déclenchera l'alerte admin.
 *
 * POST /api/relais/validate-reverse/:orderId   (admin uniquement)
 *   Un admin Komerce confirme la réception de l'argent.
 *   cash_reverse_status → 'confirmed'. Clôture le cycle.
 *
 * POST /api/relais/regenerate-code/:parcelRef  (admin uniquement)
 *   Regénère un pickup_code si le code précédent est expiré.
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { generatePickupCode, validatePickupCode } = require('../utils/pickup');

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES PUBLIQUES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/relais — liste publique des points relais actifs
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT id, name, agent_name, phone, address, zone, hours, island
      FROM relais
      WHERE is_active = TRUE
      ORDER BY island, name
    `);
    res.json(rows);
  } catch(err) { next(err); }
});

// Route publique — alias
router.get('/public', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, zone, island, address, phone FROM relais WHERE is_active = TRUE ORDER BY island, zone, name'
    );
    res.json({ relais: rows });
  } catch(err) { next(err); }
});

// GET /api/relais/:id — détail d'un relais
router.get('/:id', async (req, res, next) => {
  // Éviter de capturer les routes spécifiques ci-dessous
  if (['handover', 'declare-reverse', 'validate-reverse', 'regenerate-code'].includes(req.params.id)) {
    return next();
  }
  try {
    const { rows } = await db.query(
      `SELECT id, name, agent_name, phone, address, zone, hours, island
       FROM relais WHERE id = $1 AND is_active = TRUE`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Relais introuvable' });
    res.json(rows[0]);
  } catch(err) { next(err); }
});


// ═══════════════════════════════════════════════════════════════════════════════
// ① POST /api/relais/handover — Remise colis par code client
// ═══════════════════════════════════════════════════════════════════════════════
//
// Body : { pickup_code: "R7K4MP" }   (le code reçu sur le WhatsApp du client)
//
// Flux :
//   1. Trouve le colis par pickup_code
//   2. Vérifie que c'est bien un colis du relais de l'agent authentifié
//   3. Valide le code (non expiré, statut = available, non déjà utilisé)
//   4. Marque pickup_confirmed_at, pickup_confirmed_by, status = collected
//   5. Sync orders via syncParcelToOrders
//   6. Notification client (fire-and-forget)
//
router.post('/handover', authenticate, requireRole(['admin', 'agent_relais']), async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { pickup_code } = req.body;
    if (!pickup_code) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'pickup_code requis' });
    }

    // Chercher le colis par pickup_code
    const { rows: [parcel] } = await client.query(`
      SELECT p.*, r.name AS relais_name, r.agent_name AS relais_agent,
             o.reference AS order_ref, o.id AS order_id,
             u.phone AS client_phone, u.full_name AS client_name
      FROM parcels p
      LEFT JOIN relais r ON r.id = p.relais_id
      LEFT JOIN orders o ON o.id = p.order_id
      LEFT JOIN users u  ON u.id = o.user_id
      WHERE UPPER(p.pickup_code) = UPPER($1)
    `, [pickup_code.trim()]);

    if (!parcel) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Code de retrait invalide — colis introuvable' });
    }

    // Vérification relais : l'agent relais ne peut confirmer que ses propres colis
    if (req.user.role === 'agent_relais' && req.user.relais_id && parcel.relais_id !== req.user.relais_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Ce colis n\'appartient pas à votre point relais' });
    }

    // Validation code (expiration, statut, déjà utilisé)
    const validation = validatePickupCode(pickup_code, parcel);
    if (!validation.valid) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: validation.reason });
    }

    // ── Marquer le colis comme collecté ──────────────────────────────────────
    await client.query(`
      UPDATE parcels SET
        status               = 'collected',
        collected_at         = NOW(),
        pickup_confirmed_at  = NOW(),
        pickup_confirmed_by  = $2,
        updated_at           = NOW()
      WHERE id = $1
    `, [parcel.id, req.user.id]);

    // ── Scan event pour traçabilité ───────────────────────────────────────────
    await client.query(`
      INSERT INTO scan_events (parcel_id, event_type, location, notes, scanned_by, actor_name, actor_role, status)
      VALUES ($1, 'collected', $2, $3, $4, $5, 'relay_agent', 'applied')
    `, [
      parcel.id,
      parcel.relais_name || 'Relais',
      `Remise confirmée par code retrait — ${req.user.full_name}`,
      req.user.id,
      req.user.full_name,
    ]);

    // ── Sync statut commande ──────────────────────────────────────────────────
    // Réutilise la fonction existante de parcel-api-v2
    let syncedOrders = [];
    try {
      const { syncParcelToOrders } = require('./parcel-api-v2');
      if (typeof syncParcelToOrders === 'function') {
        syncedOrders = await syncParcelToOrders(client, parcel.id, 'collected');
      }
    } catch (_) {
      // non-fatal — la sync se fera lors du prochain passage
    }

    await client.query('COMMIT');

    // ── Notification client (fire-and-forget) ─────────────────────────────────
    try {
      const notif = require('../services/notification-service');
      notif.notifyParcelScan(parcel.id, parcel.reference, 'collected')
        .catch(e => console.error('[HANDOVER-NOTIF]', e.message));
    } catch (_) {}

    console.log(`[HANDOVER] ✅ Colis ${parcel.reference} remis — agent: ${req.user.full_name} — client: ${parcel.client_name || '?'}`);

    res.json({
      success:       true,
      message:       'Colis remis avec succès',
      parcel_ref:    parcel.reference,
      order_ref:     parcel.order_ref,
      client:        parcel.client_name,
      collected_at:  new Date().toISOString(),
      synced_orders: syncedOrders,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});


// ═══════════════════════════════════════════════════════════════════════════════

// ③ POST /api/relais/validate-payment — Relais confirme l'encaissement cash client
// ═══════════════════════════════════════════════════════════════════════════════
//
// Body : { ref, amount_kmf }
//   ref        : référence commande (KOM-...) ou colis (PCL-...)
//   amount_kmf : montant encaissé par le relais
//
// Principe : le relais a reçu l'argent du client en main propre.
//   En validant, il s'engage sur le montant et débloque la commande.
//   La commande passe de 'pending' → 'confirmed' → sourcing démarre.
//
// Flux :
//   1. Vérifie payment_mode = 'cash_relais' + status = 'pending'
//   2. Vérifie appartenance relais (agent ne peut valider que ses commandes)
//   3. Vérifie cohérence montant (±5% tolérance)
//   4. payment_status → 'paid', cash_paid_at → NOW(), status → 'confirmed'
//
router.post('/validate-payment', authenticate, requireRole(['admin', 'agent_relais']), async (req, res, next) => {
  try {
    const { ref, amount_kmf } = req.body;

    if (!ref)        return res.status(400).json({ error: 'ref (KOM-... ou PCL-...) requis' });
    if (!amount_kmf) return res.status(400).json({ error: 'amount_kmf requis' });

    // Charger la commande via ref commande ou ref colis
    let orderQuery, orderParam;
    if (ref.startsWith('PCL-')) {
      orderQuery = 'JOIN parcels p ON p.order_id = o.id WHERE p.reference = $1';
      orderParam = ref;
    } else {
      orderQuery = 'WHERE o.reference = $1';
      orderParam = ref;
    }

    const { rows: [order] } = await db.query(`
      SELECT o.*, r.agent_name AS relais_agent, r.name AS relais_name
      FROM orders o
      LEFT JOIN relais r ON r.id = o.relais_id
      ${orderQuery}
      LIMIT 1
    `, [orderParam]);

    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    if (order.payment_mode !== 'cash_relais') {
      return res.status(422).json({ error: 'Cette commande n\'est pas un paiement cash relais' });
    }

    // Idempotent — déjà validé
    if (order.payment_status === 'paid') {
      return res.status(409).json({
        error: 'Paiement déjà validé pour cette commande',
        cash_paid_at: order.cash_paid_at,
      });
    }

    if (order.status !== 'pending') {
      return res.status(422).json({
        error: `Commande non pending (statut actuel : ${order.status})`,
      });
    }

    // Vérification appartenance relais
    if (req.user.role === 'agent_relais' && req.user.relais_id && order.relais_id !== req.user.relais_id) {
      return res.status(403).json({ error: 'Cette commande n\'appartient pas à votre point relais' });
    }

    // Tolérance montant ±5%
    const expected = Number(order.total_kmf);
    const received = Number(amount_kmf);
    if (expected > 0) {
      const diff = Math.abs(received - expected) / expected;
      if (diff > 0.05) {
        return res.status(422).json({
          error: `Montant incohérent : attendu ${expected} KMF, déclaré ${received} KMF (écart > 5%)`,
          expected_kmf: expected,
          received_kmf: received,
        });
      }
    }

    const paidAt = new Date().toISOString();

    await db.query(`
      UPDATE orders SET
        payment_status          = 'paid',
        cash_paid_at            = NOW(),
        cash_reverse_amount_kmf = $2,
        status                  = 'confirmed',
        updated_at              = NOW()
      WHERE id = $1
    `, [order.id, amount_kmf]);

    console.log(`[CASH] ✅ Paiement validé — ${order.reference} — ${amount_kmf} KMF — ${req.user.full_name} (${order.relais_name})`);

    // Envoyer facture WhatsApp au client
    notif.notifyPaymentConfirmed(order.id, order.reference).catch(err =>
      console.error(`[CASH] ⚠️ WhatsApp facture non envoyée — ${order.reference}:`, err.message)
    );

    res.json({
      success:     true,
      message:     'Paiement cash validé — commande confirmée et transmise au sourcing',
      order_ref:   order.reference,
      amount_kmf:  received,
      status:      'confirmed',
      paid_at:     paidAt,
      validated_by: req.user.full_name,
      commitment:  `${req.user.full_name} (${order.relais_name || 'relais'}) confirme avoir encaissé ${amount_kmf} KMF en cash du client pour la commande ${order.reference} le ${new Date(paidAt).toLocaleDateString('fr-FR')} à ${new Date(paidAt).toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'})}.`,
    });

  } catch (err) { next(err); }
});


// ② POST /api/relais/declare-reverse — Relais déclare et confirme le reversement
// ═══════════════════════════════════════════════════════════════════════════════
//
// Body : { order_id, amount_kmf, method, notes }
//   method : 'mvola' | 'orange_money' | 'cash' | 'virement'
//   notes  : référence transaction, numéro Orange Money, etc.
//
// Principe : la déclaration du relais EST la confirmation.
//   En déclarant, l'agent s'auto-engage et se rend responsable si l'argent
//   n'arrive pas chez Komerce. Pas de validation admin supplémentaire.
//
// Flux :
//   1. Vérifie que la commande est cash_relais + payment_status = paid
//   2. Vérifie que tous les colis sont bien collected
//   3. Vérifie que le relais est bien celui de la commande
//   4. cash_reverse_status → 'confirmed' — cycle cash clôturé immédiatement
//
router.post('/declare-reverse', authenticate, requireRole(['admin', 'agent_relais']), async (req, res, next) => {
  try {
    const { order_id, ref, amount_kmf, method, notes } = req.body;

    if (!order_id && !ref) return res.status(400).json({ error: 'order_id ou ref (KOM-... ou PCL-...) requis' });
    if (!amount_kmf) return res.status(400).json({ error: 'amount_kmf requis' });

    // Normalise method : 'orange' alias -> 'orange_money'
    const normalizedMethod = method === 'orange' ? 'orange_money' : method;
    const VALID_METHODS = ['mvola', 'orange_money', 'cash', 'virement'];
    if (!normalizedMethod || !VALID_METHODS.includes(normalizedMethod)) {
      return res.status(400).json({
        error: 'method requis',
        accepted_values: VALID_METHODS,
        hint: 'Ex: { "method": "mvola" } — comment l\'argent a été envoyé à Komerce',
      });
    }

    // Charger la commande + infos relais (via order_id, référence commande ou référence colis)
    let orderQuery, orderParam;
    if (order_id) {
      orderQuery = 'WHERE o.id = $1';
      orderParam = order_id;
    } else if (ref.startsWith('PCL-')) {
      orderQuery = 'JOIN parcels p ON p.order_id = o.id WHERE p.reference = $1';
      orderParam = ref;
    } else {
      orderQuery = 'WHERE o.reference = $1';
      orderParam = ref;
    }
    const { rows: [order] } = await db.query(`
      SELECT o.*, r.agent_name AS relais_agent, r.name AS relais_name
      FROM orders o
      LEFT JOIN relais r ON r.id = o.relais_id
      ${orderQuery}
      LIMIT 1
    `, [orderParam]);

    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    if (order.payment_mode !== 'cash_relais') {
      return res.status(422).json({ error: 'Cette commande n\'est pas un paiement cash relais' });
    }

    if (order.payment_status !== 'paid') {
      return res.status(422).json({
        error: 'Le paiement client n\'a pas encore été confirmé (payment_status != paid)',
      });
    }

    // Idempotent — déjà clôturé
    if (order.cash_reverse_status === 'confirmed') {
      return res.status(409).json({
        error: 'Reversement déjà enregistré pour cette commande',
        confirmed_at: order.cash_reverse_confirmed_at,
      });
    }

    // Vérification appartenance relais
    if (req.user.role === 'agent_relais' && req.user.relais_id && order.relais_id !== req.user.relais_id) {
      return res.status(403).json({ error: 'Cette commande n\'appartient pas à votre point relais' });
    }

    // Tous les colis doivent être collected
    const { rows: parcels } = await db.query(
      `SELECT id, status FROM parcels WHERE order_id = $1`, [order_id]
    );
    const allCollected = parcels.length > 0 && parcels.every(p => p.status === 'collected');
    if (!allCollected && parcels.length > 0) {
      return res.status(422).json({
        error: 'Impossible de clôturer : au moins un colis n\'est pas encore collecté',
        parcels: parcels.map(p => ({ id: p.id, status: p.status })),
      });
    }

    const confirmedAt = new Date().toISOString();

    // Déclaration = confirmation — une seule étape
    await db.query(`
      UPDATE orders SET
        cash_reverse_status       = 'confirmed',
        cash_reverse_confirmed_at = NOW(),
        cash_reverse_confirmed_by = $2,
        cash_reverse_amount_kmf   = $3,
        cash_reverse_method       = $4,
        cash_reverse_notes        = $5,
        updated_at                = NOW()
      WHERE id = $1
    `, [order.id, req.user.id, amount_kmf, normalizedMethod, notes || null]);

    console.log(`[REVERSE] ✅ ${order.reference} — ${amount_kmf} KMF via ${normalizedMethod} — ${req.user.full_name} (${order.relais_name})`);

    res.json({
      success:      true,
      message:      'Reversement enregistré — cycle cash relais clôturé',
      order_ref:    order.reference,
      amount_kmf:   Number(amount_kmf),
      method,
      confirmed_at: confirmedAt,
      confirmed_by: req.user.full_name,
      commitment:   `${req.user.full_name} (${order.relais_name || 'relais'}) déclare avoir reversé ${amount_kmf} KMF via ${normalizedMethod} — commande ${order.reference}`,
    });

  } catch (err) { next(err); }
});


// ④ POST /api/relais/regenerate-code/:parcelRef — Admin régénère un code expiré
// ═══════════════════════════════════════════════════════════════════════════════
//
// Cas d'usage : le client met > 48h à venir, son code a expiré.
// L'admin peut régénérer un nouveau code → nouveau WhatsApp envoyé.
//
router.post('/regenerate-code/:parcelRef', authenticate, requireRole(['admin']), async (req, res, next) => {
  try {
    const { parcelRef } = req.params;

    const { rows: [parcel] } = await db.query(
      `SELECT p.id, p.reference, p.status, p.pickup_code, p.order_id,
              u.phone AS client_phone
       FROM parcels p
       LEFT JOIN orders o ON o.id = p.order_id
       LEFT JOIN users u  ON u.id = o.user_id
       WHERE p.reference = $1 OR p.id::text = $1`,
      [parcelRef]
    );

    if (!parcel) return res.status(404).json({ error: 'Colis introuvable' });

    if (parcel.status !== 'available') {
      return res.status(422).json({
        error: `Seuls les colis "available" peuvent avoir un code régénéré (statut actuel: ${parcel.status})`,
      });
    }

    const newCode = generatePickupCode();

    await db.query(`
      UPDATE parcels SET
        pickup_code          = $2,
        pickup_code_sent_at  = NOW(),
        pickup_confirmed_at  = NULL,
        updated_at           = NOW()
      WHERE id = $1
    `, [parcel.id, newCode]);

    // Renvoyer la notification WhatsApp avec le nouveau code
    try {
      const notif = require('../services/notification-service');
      notif.notifyParcelScan(parcel.id, parcel.reference, 'available')
        .catch(e => console.error('[REGEN-NOTIF]', e.message));
    } catch (_) {}

    console.log(`[PICKUP] 🔄 Code régénéré — colis ${parcel.reference}: ${newCode} — admin: ${req.user.full_name}`);

    res.json({
      success:    true,
      message:    'Nouveau code envoyé au client par WhatsApp',
      parcel_ref: parcel.reference,
      new_code:   newCode,  // affiché à l'admin pour double sécurité
      sent_at:    new Date().toISOString(),
    });

  } catch (err) { next(err); }
});


module.exports = router;
