/**
 * KOMERCE — Routes scan logistique
 *
 * POST /api/scans             → enregistrer un scan (agent hub ou relais)
 * POST /api/scans/collect     → scan de retrait destinataire (code à 6 chiffres)
 * GET  /api/scans/:order_id   → historique des scans d'une commande (admin)
 *
 * Le trigger PostgreSQL sync_order_status_from_scan() se charge
 * de mettre à jour le statut de la commande automatiquement après chaque scan.
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendSMS } = require('../utils/sms');

// Droits d'accès par étape de scan
const STEP_ROLES = {
  preparation:     ['admin', 'agent_hub'],
  hub_preparation: ['admin', 'agent_hub'],
  shipped:         ['admin', 'agent_hub'],
  relais_received: ['admin', 'agent_relais'],
  collected:       ['admin', 'agent_relais'],
};

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
        // SMS au commanditaire : commande en route
        const { rows: [fullOrder] } = await db.query(
          `SELECT o.*, u.phone AS user_phone
           FROM orders o LEFT JOIN users u ON u.id = o.user_id
           WHERE o.id = $1`, [order_id]
        );
        if (fullOrder?.user_phone) {
          await sendSMS(
            fullOrder.user_phone,
            `Komerce · Votre commande ${order.reference} est en route ! Délai estimé : 3 à 5 semaines.`,
            'shipped', order_id
          );
          sms_triggered = true;
        }
      }

      if (step === 'relais_received') {
        // SMS au destinataire : disponible au relais
        const { rows: [fullOrder] } = await db.query(
          `SELECT o.pickup_code, rc.phone AS recipient_phone, rc.full_name,
                  r.name AS relais_name, r.address AS relais_address
           FROM orders o
           LEFT JOIN recipients rc ON rc.id = o.recipient_id
           LEFT JOIN relais     r  ON r.id  = o.relais_id
           WHERE o.id = $1`, [order_id]
        );
        if (fullOrder?.recipient_phone) {
          await sendSMS(
            fullOrder.recipient_phone,
            `Komerce · Bonjour ${fullOrder.full_name}, votre colis est disponible au ${fullOrder.relais_name} (${fullOrder.relais_address}). Code de retrait : ${fullOrder.pickup_code}`,
            'available', order_id
          );
          sms_triggered = true;
        }
      }
    } else {
      // Anomalie → alerte admin par SMS
      const { rows: adminUsers } = await db.query(
        `SELECT phone FROM users WHERE role = 'admin' AND phone IS NOT NULL`
      );
      for (const admin of adminUsers) {
        await sendSMS(
          admin.phone,
          `⚠️ Komerce · Anomalie scan sur ${order.reference} à l'étape "${step}". Notes : ${notes || 'aucune'}`,
          'anomaly_alert', order_id
        );
      }
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

    // Enregistrer le scan collected via la route principale
    // (réutilise la logique du trigger)
    await db.query(
      `INSERT INTO scans
         (order_id, step, scanned_by, location, scan_code, notes)
       VALUES ($1,'collected',$2,$3,$4,$5)`,
      [order.id, req.user.id, order.relais_name || '', order.pickup_code || ('COLLECT-' + order.reference), 'Retrait destinataire — code valide']
    );

    // SMS confirmation au commanditaire
    const { rows: [fullOrder] } = await db.query(
      `SELECT u.phone AS user_phone FROM orders o
       LEFT JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
      [order.id]
    );
    if (fullOrder?.user_phone) {
      await sendSMS(
        fullOrder.user_phone,
        `Komerce · Votre colis ${order.reference} a bien été récupéré par ${order.recipient_name}. Merci pour votre confiance !`,
        'collected', order.id
      );
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

// ── GET /api/scans/:order_id ──────────────────────────────────────────────────
// Historique complet des scans d'une commande — admin uniquement
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

module.exports = router;
