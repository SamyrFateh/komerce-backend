const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const log = require('../utils/logger').child({ module: 'transit-dashboard' });

// ─────────────────────────────────────────────
// GET — colis prêts pour transit (shipped)
// ─────────────────────────────────────────────
router.get('/', async (req, res) => {
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
    await db.query(`
      UPDATE parcels
      SET status = 'in_transit',
          in_transit_at = NOW()
      WHERE reference = $1
    `, [ref]);

    res.json({ success: true });
  } catch (err) {
    log.error(err);
    res.status(500).json({ error: 'Erreur passage en transit' });
  }
});

module.exports = router;