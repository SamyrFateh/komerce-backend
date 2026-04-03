// routes/loyalty.js — Komerce v8
// Fidélité client : paliers, remises, historique
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// ── GET /api/loyalty/tiers — liste des paliers (public, pour affichage client) ──
router.get('/tiers', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, label, badge, min_orders, discount_pct FROM loyalty_tiers ORDER BY min_orders ASC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/loyalty/me — palier + progression du client connecté ──────────────
router.get('/me', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM v_loyalty_summary WHERE id = $1`,
      [req.user.id]
    );
    if (!rows.length) return res.json({ orders_count: 0, tier_label: null, discount_pct: 0 });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/loyalty/users — admin : tous les clients avec leur palier ──────────
router.get('/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM v_loyalty_summary');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/loyalty/tiers/:id — admin : modifier un palier ────────────────────
router.put('/tiers/:id', authenticate, requireAdmin, async (req, res) => {
  const { label, badge, min_orders, discount_pct } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE loyalty_tiers
       SET label = COALESCE($1, label),
           badge = COALESCE($2, badge),
           min_orders   = COALESCE($3, min_orders),
           discount_pct = COALESCE($4, discount_pct)
       WHERE id = $5
       RETURNING *`,
      [label, badge, min_orders, discount_pct, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Palier introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/loyalty/recalculate/:user_id — admin : recalculer le palier ──────
router.post('/recalculate/:user_id', authenticate, requireAdmin, async (req, res) => {
  try {
    await db.query('SELECT recalculate_loyalty($1)', [req.params.user_id]);
    const { rows } = await db.query('SELECT * FROM v_loyalty_summary WHERE id = $1', [req.params.user_id]);
    res.json(rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/loyalty/recalculate-all — admin : recalculer tous les paliers ─────
router.post('/recalculate-all', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rows: users } = await db.query(`SELECT id FROM users WHERE role = 'client'`);
    for (const u of users) {
      await db.query('SELECT recalculate_loyalty($1)', [u.id]);
    }
    res.json({ recalculated: users.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
