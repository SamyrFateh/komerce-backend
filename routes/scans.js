/**
 * KOMERCE — Routes scan logistique — v8.2 MERGED
 *
 * POST /api/scans             → enregistrer un scan (agent hub ou relais)
 * POST /api/scans/collect     → scan de retrait destinataire (code à 6 chiffres)
 * POST /api/scans/hub/receive → réception hub via QR (délègue à purchasing)
 * GET  /api/scans/hub/pending → commandes en attente de réception hub
 * GET  /api/scans/:order_id   → historique des scans d'une commande (admin)
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
 * Le trigger PostgreSQL sync_order_status_from_scan() se charge
 * de mettre à jour le statut de la commande automatiquement après chaque scan.
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendSMS } = require('../utils/sms');

// Alias middleware (le fichier original utilisait requireAuth dans certains endroits)
const requireAuth = authenticate;

// Droits d'accès par étape de scan
const STEP_ROLES = {
  preparation:     ['admin', 'agent_hub'],
  hub_preparation: ['admin', 'agent_hub'],
  shipped:         ['admin', 'agent_hub'],
  relais_received: ['admin', 'agent_relais'],
  collected:       ['admin', 'agent_relais'],
};

// ──────────────────────────────────────────────────────────────
// triggerScan3 — v8.2
// Appelé depuis purchasing.js après vérification de complétude.
// Le statut 'preparation' est déjà positionné avant l'appel.
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
  try {
    await db.query(
      `INSERT INTO scans (order_id, step, scan_code, scanned_by, notes)
       VALUES ($1, 'preparation', 'AUTO-HUB-' || $1, $2, 'Auto-déclenché après complétude réception hub')`,
      [order_id, scanned_by]
    );
  } catch (logErr) {
    console.warn(`[SCAN3] Log non enregistré:`, logErr.message);
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
router.post('/', authenticate, async (req, res) => {
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

    const validSteps = ['preparation', 'hub_preparation', 'shipped', 'relais_received', 'collected'];
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

    // Insérer le scan — le trigger prend le relais pour le statut
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

    // Récupérer le nouveau statut (mis à jour par le trigger)
    const { rows: [order] } = await db.query(
      'SELECT status, reference FROM orders WHERE id = $1',
      [order_id]
    );

    // SMS déclenchés par certaines étapes
    let sms_triggered = false;

    if (!is_anomaly) {
      if (step === 'shipped') {
        // SMS au commanditaire — non bloquant
        const { rows: [fullOrder] } = await db.query(
          `SELECT o.*, u.phone AS user_phone
           FROM orders o LEFT JOIN users u ON u.id = o.user_id
           WHERE o.id = $1`, [order_id]
        );
        if (fullOrder?.user_phone) {
          sendSMS(
            fullOrder.user_phone,
            `Komerce · Votre commande ${order.reference} est en route ! Délai estimé : 3 à 5 semaines.`,
            'shipped', order_id
          ).catch(err => console.error('SMS shipped error:', err.message));
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

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du scan' });
  }
});

// ── POST /api/scans/collect ───────────────────────────────────────────────────
// Retrait par le destinataire : l'agent relais saisit le code à 6 chiffres.
// Body : { pickup_code }
router.post('/collect', authenticate, requireRole(['admin', 'agent_relais']), async (req, res) => {
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
    await db.query(
      `INSERT INTO scans
         (order_id, step, scanned_by, location, scan_code, notes)
       VALUES ($1,'collected',$2,$3,$4,$5)`,
      [order.id, req.user.id, order.relais_name || '', pickup_code, 'Retrait destinataire — code valide']
    );

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

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du retrait' });
  }
});

// ── POST /api/scans/hub/receive ───────────────────────────────────────────────
// Réception hub via QR — délègue à POST /api/purchasing/:id/receive
// Body : { qr_code?, po_id? }
// [B7] receiveItem() n'existe pas → 501 explicite avec po_id résolu
router.post('/hub/receive', requireAuth, async (req, res) => {
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

  } catch (err) {
    console.error('[scans/hub/receive] Erreur:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/scans/hub/pending ────────────────────────────────────────────────
// Commandes en attente de réception hub
// [B1] po.qty (pas po.quantity) | [B4] JOIN via product_suppliers
// IMPORTANT : doit être AVANT /:order_id pour ne pas être capturé
router.get('/hub/pending', requireAuth, async (req, res) => {
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
       WHERE o.status IN ('confirmed', 'purchasing', 'partially_received')
         AND po.status != 'cancelled'
       GROUP BY o.id, o.reference, o.status, o.created_at
       ORDER BY o.created_at ASC`
    );

    res.json({
      count: result.rows.length,
      orders: result.rows
    });

  } catch (err) {
    console.error('[scans/hub/pending] Erreur:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/scans/:order_id ──────────────────────────────────────────────────
// Historique complet des scans d'une commande — admin uniquement
// IMPORTANT : doit rester EN DERNIER (route générique /:order_id)
router.get('/:order_id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT s.*, u.full_name AS scanned_by_name
       FROM scans s
       LEFT JOIN users u ON u.id = s.scanned_by
       WHERE s.order_id = $1
       ORDER BY s.created_at ASC`,
      [req.params.order_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Export router + triggerScan3 (utilisé par purchasing.js)
module.exports = router;
module.exports.triggerScan3 = triggerScan3;
