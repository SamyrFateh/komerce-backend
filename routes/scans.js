/**
 * KOMERCE — Routes scan logistique — v8.5 PARCEL SOURCE OF TRUTH
 *
 * POST /api/scans             → enregistrer un scan (agent hub ou relais)
 * POST /api/scans/collect     → scan de retrait destinataire (code à 6 chiffres)
 * POST /api/scans/hub/receive → réception hub via QR (délègue à purchasing)
 * GET  /api/scans/hub/pending → commandes en attente de réception hub
 * GET  /api/scans/:order_id   → historique des scans d'une commande (admin)
 *
 * SÉCURITÉ v8.3 :
 *   [S1] 'collected' retiré du endpoint générique POST /api/scans
 *        → retrait DOIT passer par /scans/collect ou /scans/verify-qr
 *   [S2] verify-qr : order_id optionnel, recherche par token seul
 *        → corrige le bug frontend qui n'envoyait pas order_id
 *
 * PHASE 3 PARCEL-CENTRIC v8.5 :
 *   [P3-1] safeSyncScanToParcels() est maintenant awaité (plus fire-and-forget)
 *   [P3-2] Le trigger legacy trg_scan_sync_status est DÉSACTIVÉ
 *          → parcelSync.js est la SOURCE DE VÉRITÉ pour orders.status
 *   [P3-3] Passage de scanned_by/notes à parcelSync pour order_status_history
 *   [P3-4] verify-qr : skipHistory=true (historique géré dans la transaction)
 *
 * PHASE 2 (conservé) :
 *   [P2-1] Import safeSyncScanToParcels() depuis utils/parcelSync.js
 *   [P2-2] Appel dans les 4 endpoints (POST /api/scans, /collect, /verify-qr, triggerScan3)
 *
 * BUGS CORRIGÉS v8.2 :
 *   [B1] po.quantity → po.qty         (vraie colonne purchase_orders)
 *   [B4] JOIN products via product_supplier_id → product_suppliers → products
 *   [B7] receiveItem() non défini → route hub/receive inline (501 → purchasing)
 *   [B8] u.first_name → u.full_name AS first_name
 *   [B9] scan_logs → scans (vraie table)
 *   [B10] scanned_at supprimé (created_at est automatique)
 *   [B11] scan_code NOT NULL → ajouté dans INSERT
 *   [B12] scanned_by → paramètre optionnel ajouté
 *   [B13] Commentaires -- SQL → // JS
 *
 * [P3-2] Le trigger PostgreSQL est DÉSACTIVÉ. parcelSync.js gère tout.
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendSMS } = require('../utils/sms');
const { validate } = require('../middleware/validate');
const { scans } = require('../validators');

// [P2-1] Parcel sync — [P3-2] maintenant SOURCE DE VÉRITÉ (trigger désactivé)
const { safeSyncScanToParcels } = require('../utils/parcelSync');

// Alias middleware (le fichier original utilisait requireAuth dans certains endroits)
const requireAuth = authenticate;

// Droits d'accès par étape de scan
const STEP_ROLES = {
  preparation:     ['admin', 'agent_hub'],
  hub_preparation: ['admin', 'agent_hub'],
  shipped:         ['admin', 'agent_hub'],
  in_transit:      ['admin'],                  // confirmation embarquement transitaire
  relais_received: ['admin', 'agent_relais'],
  collected:       ['admin', 'agent_relais'],
};

// ──────────────────────────────────────────────────────────────
// triggerScan3 — v8.5
// Appelé depuis purchasing.js après vérification de complétude.
// Le statut 'preparation' est déjà positionné avant l'appel.
// [P3-1] await safeSyncScanToParcels() — source de vérité
// [P3-3] Passage scanned_by + notes pour order_status_history
// ──────────────────────────────────────────────────────────────

async function triggerScan3(order_id, scanned_by = null) {
  const orderRes = await db.query(
    `SELECT o.*, u.phone AS client_phone, u.full_name AS first_name
     FROM orders o
     JOIN users u ON u.id = o.user_id
     WHERE o.id = $1`,
    [order_id]
  );

  if (!orderRes.rows.length) {
    throw new Error(`triggerScan3 : commande ${order_id} introuvable`);
  }

  const order = orderRes.rows[0];

  // Garde : si la commande n'est pas en 'preparation', ne rien faire
  if (order.status !== 'preparation') {
    console.warn(`[SCAN3] Commande ${order_id} ignorée — statut: ${order.status} (attendu: preparation)`);
    return { skipped: true, reason: `statut_invalide: ${order.status}` };
  }

  // SMS client
  const smsClient = `Bonjour ${order.first_name}, votre commande Komerce ref ${order.reference} est en cours de préparation à Dubai. Vous serez notifié(e) dès l'expédition. 🛍️`;

  try {
    await sendSMS(order.client_phone, smsClient);
  } catch (smsErr) {
    console.error(`[SCAN3] SMS client échoué (order ${order_id}):`, smsErr.message);
  }

  // [B9] scans (pas scan_logs) | [B10] created_at auto | [B11] scan_code NOT NULL | [B12] scanned_by optionnel
  let scan_id = null;
  try {
    const { rows: [scanRow] } = await db.query(
      `INSERT INTO scans (order_id, step, scan_code, scanned_by, notes)
       VALUES ($1, 'preparation', 'AUTO-HUB-' || $1, $2, 'Auto-déclenché après complétude réception hub')
       RETURNING id`,
      [order_id, scanned_by]
    );
    scan_id = scanRow?.id;
  } catch (logErr) {
    console.warn(`[SCAN3] Log non enregistré:`, logErr.message);
  }

  // [P3-1] Parcel sync — awaité, source de vérité
  // [P3-3] Passage scanned_by + notes pour order_status_history
  if (scan_id) {
    await safeSyncScanToParcels({
      order_id,
      step: 'preparation',
      scan_id,
      scanned_by,
      notes: 'Auto-déclenché après complétude réception hub',
    });
  }

  console.log(`[SCAN3] ✅ Commande ${order.reference} en préparation — SMS client envoyé`);
  return { success: true, order_id, reference: order.reference };
}

// ── POST /api/scans ───────────────────────────────────────────────────────────
// Enregistre un scan sur la chaîne logistique.
// Body : { scan_code, step, location, notes, is_anomaly }
//
// scan_code peut être :
//   - un code article  : KOM-ITEM-XXXX  (order_item)
//   - une référence    : KOM-2026-XXXX  (order entière)
router.post('/', authenticate, validate(scans.create), async (req, res, next) => {
  try {
    const {
      scan_code,
      step,
      location   = '',
      notes      = '',
      is_anomaly = false,
      latitude,
      longitude,
    } = req.body;

    // Validation
    if (!scan_code || !step) {
      return res.status(400).json({ error: 'scan_code et step sont requis' });
    }

    const validSteps = ['preparation', 'shipped', 'in_transit', 'relais_received'];
    // 🔒 SÉCURITÉ : 'collected' retiré — le retrait client doit passer par
    // POST /api/scans/collect (code 6 chiffres) ou POST /api/scans/verify-qr (QR token)
    // pour garantir la double vérification agent relais + client.
    if (!validSteps.includes(step)) {
      return res.status(400).json({ error: `step invalide. Valeurs acceptées : ${validSteps.join(', ')}` });
    }

    // Vérifier que l'agent a le droit de scanner cette étape
    const allowedRoles = STEP_ROLES[step];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Étape "${step}" non autorisée pour le rôle "${req.user.role}"` });
    }

    // Résoudre le scan_code → order_id ou order_item_id
    let order_id      = null;
    let order_item_id = null;

    if (scan_code.startsWith('KOM-ITEM-')) {
      // Code article individuel
      const { rows } = await db.query(
        'SELECT id, order_id FROM order_items WHERE scan_code = $1',
        [scan_code]
      );
      if (!rows.length) return res.status(404).json({ error: 'Article introuvable avec ce code' });
      order_item_id = rows[0].id;
      order_id      = rows[0].order_id;
    } else {
      // Référence commande complète (KOM-2026-XXXX)
      const { rows } = await db.query(
        'SELECT id FROM orders WHERE reference = $1',
        [scan_code]
      );
      if (!rows.length) return res.status(404).json({ error: 'Commande introuvable avec cette référence' });
      order_id = rows[0].id;
    }

    // Insérer le scan
    // [P3-2] Le trigger est désactivé — parcelSync gère le statut
    const { rows: [scan] } = await db.query(
      `INSERT INTO scans
         (order_id, order_item_id, step, scanned_by, location,
          device_id, latitude, longitude, scan_code, notes, is_anomaly)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [order_id, order_item_id, step, req.user.id, location,
       req.headers['x-device-id'] || null, latitude || null, longitude || null,
       scan_code, notes, is_anomaly]
    );

    // [P3-1] Parcel sync — awaité, source de vérité pour orders.status
    // [P3-3] Passage scanned_by + notes pour order_status_history
    await safeSyncScanToParcels({
      order_id,
      step,
      scan_id: scan.id,
      order_item_id,
      scanned_by: req.user.id,
      notes,
    });

    // [P3-2] Récupérer le statut — maintenant mis à jour par parcelSync (plus par le trigger)
    const { rows: [order] } = await db.query(
      'SELECT status, reference FROM orders WHERE id = $1',
      [order_id]
    );

    // SMS déclenchés par certaines étapes
    let sms_triggered = false;

    if (!is_anomaly) {
      if (step === 'shipped') {
        // SMS au commanditaire — colis remis au transitaire
        const { rows: [fullOrder] } = await db.query(
          `SELECT o.*, u.phone AS user_phone
           FROM orders o LEFT JOIN users u ON u.id = o.user_id
           WHERE o.id = $1`, [order_id]
        );
        if (fullOrder?.user_phone) {
          sendSMS(
            fullOrder.user_phone,
            `Komerce · Votre commande ${order.reference} est prête, remise au transitaire à Dubai.`,
            'shipped', order_id
          ).catch(err => console.error('SMS shipped error:', err.message));
          sms_triggered = true;
        }
      }

      if (step === 'in_transit') {
        // SMS au commanditaire — confirmation embarquement bateau
        const { rows: [fullOrder] } = await db.query(
          `SELECT o.*, u.phone AS user_phone
           FROM orders o LEFT JOIN users u ON u.id = o.user_id
           WHERE o.id = $1`, [order_id]
        );
        if (fullOrder?.user_phone) {
          sendSMS(
            fullOrder.user_phone,
            `Komerce · Votre commande ${order.reference} est embarquée sur le bateau ! 🚢 Arrivée estimée 3–5 semaines.`,
            'in_transit', order_id
          ).catch(err => console.error('SMS in_transit error:', err.message));
          sms_triggered = true;
        }
      }

      if (step === 'relais_received') {
        // SMS au destinataire — non bloquant
        const { rows: [fullOrder] } = await db.query(
          `SELECT o.pickup_code, rc.phone AS recipient_phone, rc.full_name,
                  r.name AS relais_name, r.address AS relais_address
           FROM orders o
           LEFT JOIN recipients rc ON rc.id = o.recipient_id
           LEFT JOIN relais     r  ON r.id  = o.relais_id
           WHERE o.id = $1`, [order_id]
        );
        if (fullOrder?.recipient_phone) {
          sendSMS(
            fullOrder.recipient_phone,
            `Komerce · Bonjour ${fullOrder.full_name}, votre colis est disponible au ${fullOrder.relais_name} (${fullOrder.relais_address}). Code de retrait : ${fullOrder.pickup_code}`,
            'available', order_id
          ).catch(err => console.error('SMS relais error:', err.message));
          sms_triggered = true;
        }
      }
    } else {
      // Anomalie → alerte admin par SMS — non bloquant
      const { rows: adminUsers } = await db.query(
        `SELECT phone FROM users WHERE role = 'admin' AND phone IS NOT NULL`
      );
      Promise.all(
        adminUsers.map(a => sendSMS(
          a.phone,
          `Komerce · Anomalie scan sur ${order.reference} à l'étape "${step}". Notes : ${notes || 'aucune'}`,
          'anomaly_alert', order_id
        ))
      ).catch(err => console.error('SMS anomaly error:', err.message));
    }

    res.status(201).json({
      scan_id:       scan.id,
      order_id,
      order_reference: order.reference,
      new_status:    order.status,
      step,
      sms_triggered,
      is_anomaly,
    });

  } catch(err) { next(err); }
});

// ── POST /api/scans/collect ───────────────────────────────────────────────────
// Retrait par le destinataire : l'agent relais saisit le code à 6 chiffres.
// Body : { pickup_code }
// [P3-1] await safeSyncScanToParcels — source de vérité
router.post('/collect', authenticate, requireRole(['admin', 'agent_relais']), validate(scans.collect), async (req, res, next) => {
  try {
    const { pickup_code } = req.body;
    if (!pickup_code) return res.status(400).json({ error: 'pickup_code requis' });

    // Retrouver la commande par pickup_code
    const { rows } = await db.query(
      `SELECT o.*, r.name AS relais_name, rc.full_name AS recipient_name
       FROM orders o
       LEFT JOIN relais     r  ON r.id  = o.relais_id
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       WHERE o.pickup_code = $1 AND o.status = 'available'`,
      [pickup_code]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Code invalide ou commande déjà retirée' });
    }

    const order = rows[0];

    // [B9] scans (pas scan_logs) | [B10] created_at auto | [B11] scan_code NOT NULL
    const { rows: [scanRow] } = await db.query(
      `INSERT INTO scans
         (order_id, step, scanned_by, location, scan_code, notes)
       VALUES ($1,'collected',$2,$3,$4,$5)
       RETURNING id`,
      [order.id, req.user.id, order.relais_name || '', pickup_code, 'Retrait destinataire — code valide']
    );

    // [P3-1] Parcel sync — awaité, source de vérité
    // [P3-3] Passage scanned_by + notes pour order_status_history
    await safeSyncScanToParcels({
      order_id: order.id,
      step: 'collected',
      scan_id: scanRow?.id,
      scanned_by: req.user.id,
      notes: 'Retrait destinataire — code valide',
    });

    // SMS confirmation au commanditaire
    const { rows: [fullOrder] } = await db.query(
      `SELECT u.phone AS user_phone FROM orders o
       LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
      [order.id]
    );
    if (fullOrder?.user_phone) {
      sendSMS(
        fullOrder.user_phone,
        `Komerce · Votre colis ${order.reference} a bien été récupéré par ${order.recipient_name}. Merci pour votre confiance !`,
        'collected', order.id
      ).catch(err => console.error('SMS collect error:', err.message));
    }

    res.json({
      message:    'Retrait enregistré',
      reference:  order.reference,
      recipient:  order.recipient_name,
      relais:     order.relais_name,
      collected_at: new Date().toISOString(),
    });

  } catch(err) { next(err); }
});

// ── POST /api/scans/hub/receive ───────────────────────────────────────────────
// Réception hub via QR — délègue à POST /api/purchasing/:id/receive
// Body : { qr_code?, po_id? }
// [B7] receiveItem() n'existe pas → 501 explicite avec po_id résolu
router.post('/hub/receive', requireAuth, requireRole(['admin', 'agent_hub']), validate(scans.hubReceive), async (req, res, next) => {
  const { qr_code, po_id } = req.body;

  try {
    let purchase_order_id = po_id;

    // Si scan QR → résoudre l'ID du PO
    if (qr_code && !po_id) {
      const poRes = await db.query(
        `SELECT id FROM purchase_orders WHERE supplier_order_id = $1 AND status != 'cancelled'`,
        [qr_code]
      );
      if (!poRes.rows.length) {
        return res.status(404).json({ error: `QR code non reconnu : ${qr_code}` });
      }
      purchase_order_id = poRes.rows[0].id;
    }

    if (!purchase_order_id) {
      return res.status(400).json({ error: 'po_id ou qr_code requis' });
    }

    // Délègue à la route purchasing — le frontend peut appeler directement
    return res.status(501).json({
      error: 'Utilisez POST /api/purchasing/:po_id/receive directement',
      po_id: purchase_order_id
    });

  } catch(err) { next(err); }
});

// ── GET /api/scans/hub/pending ────────────────────────────────────────────────
// Commandes en attente de réception hub
// [B1] po.qty (pas po.quantity) | [B4] JOIN via product_suppliers
// IMPORTANT : doit être AVANT /:order_id pour ne pas être capturé
router.get('/hub/pending', requireAuth, requireRole(['admin', 'agent_hub']), async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT
         o.id            AS order_id,
         o.reference,
         o.status,
         o.created_at,
         COUNT(po.id)    AS total_pos,
         SUM(CASE WHEN po.received_qty >= po.qty THEN 1 ELSE 0 END)  AS pos_recus,
         SUM(po.qty - po.received_qty) FILTER (
           WHERE po.status != 'cancelled' AND po.received_qty < po.qty
         )               AS qty_manquante,
         ARRAY_AGG(
           p.name || ' (' || po.received_qty || '/' || po.qty || ')'
           ORDER BY p.name
         )               AS articles
       FROM orders o
       JOIN purchase_orders po ON po.order_id = o.id
       JOIN product_suppliers ps ON ps.id = po.product_supplier_id
       JOIN products p ON p.id = ps.product_id
       -- [Phase 5.1] Simplified: orders stay 'ordered'/'confirmed' until preparation
      WHERE o.status IN ('ordered', 'confirmed')
         AND po.status != 'cancelled'
       GROUP BY o.id, o.reference, o.status, o.created_at
       ORDER BY o.created_at ASC`
    );

    res.json({
      count: result.rows.length,
      orders: result.rows
    });

  } catch(err) { next(err); }
});

// ── GET /api/scans/:order_id ──────────────────────────────────────────────────
// Historique complet des scans d'une commande — admin uniquement
// IMPORTANT : doit rester EN DERNIER (route générique /:order_id)

// ─── POST /api/scans/verify-qr ─────────────────────────────────────────────
// [P3-1] await safeSyncScanToParcels APRÈS le commit
// [P3-4] skipHistory=true — verify-qr gère l'historique dans sa transaction
router.post('/verify-qr', authenticate, requireRole(['admin', 'agent_relais']), validate(scans.verifyQr), async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { token, order_id } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'token est requis' });
    }

    // 🔒 Chercher la commande par token seul OU token + order_id
    // Le token est unique et lié à une seule commande
    let queryText, queryParams;
    if (order_id) {
      queryText = `SELECT o.*,
              rc.full_name  AS recipient_name,
              rc.phone      AS recipient_phone,
              r.name        AS relais_name,
              u.phone       AS user_phone
       FROM orders o
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       LEFT JOIN relais     r  ON r.id  = o.relais_id
       LEFT JOIN users      u  ON u.id  = o.user_id
       WHERE o.id = $1 AND o.qr_token = $2`;
      queryParams = [order_id, token];
    } else {
      queryText = `SELECT o.*,
              rc.full_name  AS recipient_name,
              rc.phone      AS recipient_phone,
              r.name        AS relais_name,
              u.phone       AS user_phone
       FROM orders o
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       LEFT JOIN relais     r  ON r.id  = o.relais_id
       LEFT JOIN users      u  ON u.id  = o.user_id
       WHERE o.qr_token = $1`;
      queryParams = [token];
    }

    const { rows: [order] } = await client.query(queryText, queryParams);

    if (!order) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    // Vérifications
    if (order.status !== 'available') {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: order.status === 'collected'
          ? 'Ce colis a déjà été remis au client'
          : `Statut incompatible : ${order.status}`,
        current_status: order.status,
      });
    }

    if (!order.qr_token) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Aucun QR code généré pour cette commande' });
    }

    if (order.qr_token !== token) {
      await client.query('ROLLBACK');
      console.warn(`[VERIFY-QR] Token invalide pour ${order.reference} — fourni: ${token.slice(0, 8)}... attendu: ${order.qr_token.slice(0, 8)}...`);
      return res.status(400).json({ error: 'QR code invalide' });
    }

    if (order.qr_expires_at && new Date(order.qr_expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'QR code expiré — veuillez en générer un nouveau',
        expired_at: order.qr_expires_at,
      });
    }

    // ✅ Token valide — marquer comme collecté et invalider le token
    // [P3-2] On garde le UPDATE direct ici pour l'atomicité de la transaction QR.
    // parcelSync recalculera après le COMMIT (résultat identique ou agrégé multi-parcel).
    await client.query(
      `UPDATE orders
       SET status       = 'collected',
           collected_at = NOW(),
           qr_token     = NULL,       -- usage unique : invalider immédiatement
           qr_expires_at = NULL,
           updated_at   = NOW()
       WHERE id = $1`,
      [order.id]
    );

    // Historiser le changement de statut (dans la transaction)
    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, 'collected', 'Remise client via QR Code', $2)`,
      [order.id, req.user.id]
    );

    // Enregistrer le scan
    const { rows: [scanRow] } = await client.query(
      `INSERT INTO scans
         (order_id, step, scanned_by, location, scan_code, notes)
       VALUES ($1, 'collected', $2, $3, $4, 'Retrait client via QR Code — token validé')
       RETURNING id`,
      [
        order.id,
        req.user.id,
        order.relais_name || '',
        `QR-${token.slice(0, 8)}`,
      ]
    );

    await client.query('COMMIT');

    // [P3-1] Parcel sync — APRÈS le commit (met à jour les parcels)
    // [P3-4] skipHistory=true — l'historique est déjà inséré dans la transaction ci-dessus
    await safeSyncScanToParcels({
      order_id: order.id,
      step: 'collected',
      scan_id: scanRow?.id,
      scanned_by: req.user.id,
      notes: 'Retrait client via QR Code — token validé',
      skipHistory: true,
    });

    console.log(`[VERIFY-QR] ✅ ${order.reference} remis à ${order.recipient_name} via QR`);

    // SMS confirmation au commanditaire (non bloquant)
    if (order.user_phone) {
      sendSMS(
        order.user_phone,
        `Komerce · Votre colis ${order.reference} a bien été récupéré par ${order.recipient_name || 'le destinataire'}. Merci pour votre confiance ! 🎉`,
        'collected',
        order.id
      ).catch(err => console.error('SMS QR collect error:', err.message));
    }

    // Recalculer fidélité (non bloquant)
    if (order.user_id) {
      const { recalculateLoyalty } = require('./loyalty');
      recalculateLoyalty(db, order.user_id)
        .catch(e => console.error('[LOYALTY] recalculate error:', e.message));
    }

    res.json({
      success:      true,
      message:      'Remise enregistrée avec succès',
      reference:    order.reference,
      recipient:    order.recipient_name,
      relais:       order.relais_name,
      collected_at: new Date().toISOString(),
    });

  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

router.get('/:order_id', authenticate, requireRole(['admin']), async (req, res, next) => {
  try {
    // Valider le format UUID pour éviter un crash PostgreSQL
    // si le paramètre est un mot (ex: "prepare", "collect")
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(req.params.order_id)) {
      return res.status(400).json({ error: 'order_id invalide — UUID attendu' });
    }

    const { rows } = await db.query(
      `SELECT s.*, u.full_name AS scanned_by_name
       FROM scans s
       LEFT JOIN users u ON u.id = s.scanned_by
       WHERE s.order_id = $1
       ORDER BY s.created_at ASC`,
      [req.params.order_id]
    );
    res.json(rows);
  } catch(err) { next(err); }
});

// Export router + triggerScan3 (utilisé par purchasing.js)
module.exports = router;
module.exports.triggerScan3 = triggerScan3;
