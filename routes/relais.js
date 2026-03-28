/**
 * KOMERCE — Points relais
 *
 * GET /api/relais        → liste tous les relais actifs (public)
 * GET /api/relais/:id    → détail d'un relais
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/relais — liste publique des points relais actifs
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT id, name, agent_name, phone, address, zone, hours, island
      FROM relais
      WHERE is_active = TRUE
        AND (name ILIKE '%Mutsamudu%' OR zone ILIKE '%Mutsamudu%' OR island ILIKE '%Anjouan%')
      ORDER BY island, name
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur chargement relais' });
  }
});

// GET /api/relais/:id — détail d'un relais
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, agent_name, phone, address, zone, hours, island
       FROM relais WHERE id = $1 AND is_active = TRUE`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Relais introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
