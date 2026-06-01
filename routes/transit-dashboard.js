const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const log = require('../utils/logger').child({ module: 'transit-dashboard' });
const { safeSyncScanToParcels } = require('../utils/parcelSync');

// ─────────────────────────────────────────────
// GET — colis prêts pour transit (shipped)
// ─────────────────────────────────────────────
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT reference, destination_island, destination_relais AS relais_name, weight_kg, created_at
      FROM parcels
      WHERE status = 'shipped'
      ORDER BY created_at ASC
    `);

    res.json({ parcels: result.rows });
  } catch (err) {
    log.error(err);
    res.status(500).json({ error: 'Erreur transit dashboard' });
  }
});

// ─────────────────────────────────────────────
// POST — passer en transit
// ─────────────────────────────────────────────
router.post('/:ref/transit', authenticate, requireAdmin, async (req, res) => {
  const { ref } = req.params;

  try {
    // Résoudre reference -> order_id
    const { rows } = await db.query(
      `SELECT id AS order_id FROM orders WHERE reference = $1 LIMIT 1`,
      [ref]
    );
    if (!rows.length) return res.status(404).json({ error: 'Commande introuvable' });

    const { order_id } = rows[0];

    // Créer le scan in_transit (source de vérité pour parcelSync)
    const { rows: [scan] } = await db.query(
      `INSERT INTO scans (order_id, step, scanned_by, notes)
       VALUES ($1, 'in_transit', $2, 'transit-dashboard')
       RETURNING id`,
      [order_id, req.user.id]
    );

    // Router via scan-engine (parcelSync) — seul chemin autorisé pour mettre à jour orders.status
    await safeSyncScanToParcels({
      order_id,
      step: 'in_transit',
      scan_id: scan.id,
      scanned_by: req.user.id,
      notes: 'transit-dashboard',
    });

    res.json({ success: true });
  } catch (err) {
    log.error(err);
    res.status(500).json({ error: 'Erreur passage en transit' });
  }
});

module.exports = router;
