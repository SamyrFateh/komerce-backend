/**
 * @komerce-arch
 * @role          loyalty
 * @domain        unknown
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

// routes/loyalty.js — Komerce v8
// Fidélité client : paliers, remises, historique
const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const log = require('../utils/logger').child({ module: 'loyalty' });

// ── GET /api/loyalty/tiers — liste des paliers (public, pour affichage client) ──
router.get('/tiers', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, label, badge, min_orders, discount_pct FROM loyalty_tiers ORDER BY min_orders ASC'
    );
    res.json(rows);
  } catch(err) { next(err); }
});

// ── GET /api/loyalty/me — palier + progression du client connecté ──────────────
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM v_loyalty_summary WHERE id = $1`,
      [req.user.id]
    );
    if (!rows.length) return res.json({ orders_count: 0, tier_label: null, discount_pct: 0 });
    res.json(rows[0]);
  } catch(err) { next(err); }
});

// ── GET /api/loyalty/users — admin : tous les clients avec leur palier ──────────
router.get('/users', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM v_loyalty_summary');
    res.json(rows);
  } catch(err) { next(err); }
});

// ── GET /api/loyalty/stats — admin : KPIs fidélité (attendu par le frontend) ──
router.get('/stats', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows: tiers } = await db.query(
      'SELECT id, label, badge, min_orders, discount_pct FROM loyalty_tiers ORDER BY min_orders ASC'
    );
    const { rows: users } = await db.query('SELECT * FROM v_loyalty_summary');
    const total_clients = users.length;
    const tier_distribution = {};
    for (const u of users) {
      const t = u.tier_label || 'Aucun';
      tier_distribution[t] = (tier_distribution[t] || 0) + 1;
    }
    res.json({ tiers, total_clients, tier_distribution, users });
  } catch(err) { next(err); }
});

// ── PUT /api/loyalty/tiers/:id — admin : modifier un palier ────────────────────
router.put('/tiers/:id', authenticate, requireAdmin, async (req, res, next) => {
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
  } catch(err) { next(err); }
});

// ── POST /api/loyalty/recalculate/:user_id — admin : recalculer le palier ──────
router.post('/recalculate/:user_id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await db.query('SELECT recalculate_loyalty($1)', [req.params.user_id]);
    const { rows } = await db.query('SELECT * FROM v_loyalty_summary WHERE id = $1', [req.params.user_id]);
    res.json(rows[0] || {});
  } catch(err) { next(err); }
});

// ── POST /api/loyalty/recalculate-all — admin : recalculer tous les paliers ─────
router.post('/recalculate-all', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows: users } = await db.query(`SELECT id FROM users WHERE role = 'client'`);
    for (const u of users) {
      await db.query('SELECT recalculate_loyalty($1)', [u.id]);
    }
    res.json({ recalculated: users.length });
  } catch(err) { next(err); }
});

// ── FONCTIONS UTILITAIRES exportées (utilisées par orders.js) ──────────────────

/**
 * getLoyaltyDiscount(db, userId)
 * Retourne { discountPct, discountLabel } pour un client donné.
 * discountPct  = 0 si aucun palier actif
 * discountLabel = label du palier (ex: "Bronze", "Silver") ou null
 */
async function getLoyaltyDiscount(db, userId) {
  try {
    const { rows } = await db.query(
      `SELECT discount_pct, tier_label FROM v_loyalty_summary WHERE id = $1`,
      [userId]
    );
    if (!rows.length) return { discountPct: 0, discountLabel: null };
    return {
      discountPct:   parseFloat(rows[0].discount_pct)  || 0,
      discountLabel: rows[0].tier_label || null
    };
  } catch (err) {
    // En cas d'erreur DB, on ne bloque pas la commande — remise = 0
    log.error({ err }, '[LOYALTY] getLoyaltyDiscount error:');
    return { discountPct: 0, discountLabel: null };
  }
}

/**
 * recalculateLoyalty(db, userId)
 * Recalcule le palier d'un client après une commande.
 * Fire-and-forget : les erreurs sont loguées mais n'interrompent pas le flux.
 */
async function recalculateLoyalty(db, userId) {
  try {
    await db.query('SELECT recalculate_loyalty($1)', [userId]);
  } catch (err) {
    log.error({ err }, '[LOYALTY] recalculateLoyalty error:');
  }
}

module.exports = router;
module.exports.getLoyaltyDiscount  = getLoyaltyDiscount;
module.exports.recalculateLoyalty  = recalculateLoyalty;
