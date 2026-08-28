/**
 * @komerce-arch
 * @role          loyalty-admin-rewards
 * @domain        loyalty
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       loyalty_rewards, orders, users
 * @db-write      loyalty_rewards
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  loyalty, dashboard, admin-dashboard
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — routes/admin-loyalty.js
 * ═══════════════════════════════════════════════════════════════════════
 * Gestion des clients éligibles au cadeau de fidélité (Control Tower)
 *
 * GET  /api/admin/loyalty/pending         → liste des clients éligibles non récompensés
 * POST /api/admin/loyalty/reward/:id      → marquer un cadeau comme accordé
 * POST /api/admin/loyalty/skip/:id        → ignorer (ex: client parti ailleurs)
 * GET  /api/admin/loyalty/history         → historique des récompenses accordées
 * GET  /api/admin/loyalty/stats           → KPIs fidélité
 * ═══════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const log = require('../utils/logger').child({ module: 'admin-loyalty' });

const adminOnly = [authenticate, requireAdmin];

// ── GET liste des cadeaux pending ────────────────────────────────────────────
router.get('/pending', adminOnly, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT
        lr.id,
        lr.user_id,
        lr.basket_count_at_trigger,
        lr.created_at,
        lr.triggered_by_order_id,

        u.full_name,
        u.phone,
        u.phone_payer,
        u.email,
        u.big_basket_count AS current_count,

        o.reference AS triggering_order_ref,
        o.total_kmf AS triggering_order_total,

        -- Statistiques globales du user
        (SELECT COALESCE(SUM(total_kmf), 0) FROM orders
         WHERE user_id = lr.user_id AND status = 'collected') AS total_lifetime_kmf,
        (SELECT COUNT(*) FROM orders
         WHERE user_id = lr.user_id AND status = 'collected') AS total_lifetime_orders

      FROM loyalty_rewards lr
      LEFT JOIN users u ON u.id = lr.user_id
      LEFT JOIN orders o ON o.id = lr.triggered_by_order_id
      WHERE lr.status = 'pending'
      ORDER BY lr.created_at DESC
      LIMIT 100
    `);

    res.json({
      count: rows.length,
      pending: rows.map(r => ({
        reward_id: r.id,
        user: {
          id: r.user_id,
          full_name: r.full_name,
          phone: r.phone || r.phone_payer,
          email: r.email,
          current_big_basket_count: Number(r.current_count),
        },
        trigger: {
          basket_count: Number(r.basket_count_at_trigger),
          order_ref:    r.triggering_order_ref,
          order_total:  Number(r.triggering_order_total || 0),
          detected_at:  r.created_at,
        },
        stats: {
          lifetime_orders: Number(r.total_lifetime_orders || 0),
          lifetime_kmf:    Number(r.total_lifetime_kmf || 0),
        },
      })),
    });
  } catch (err) { next(err); }
});

// ── POST marquer cadeau accordé ──────────────────────────────────────────────
router.post('/reward/:id', adminOnly, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { gift_description, notes } = req.body || {};

    if (!gift_description || String(gift_description).trim().length < 2) {
      return res.status(400).json({ error: 'gift_description requis (minimum 2 caractères)' });
    }

    const { rows: [existing] } = await db.query(
      'SELECT id, status, user_id FROM loyalty_rewards WHERE id = $1',
      [id]
    );

    if (!existing) {
      return res.status(404).json({ error: 'Récompense introuvable' });
    }

    if (existing.status !== 'pending') {
      return res.status(409).json({
        error: 'Récompense déjà traitée',
        current_status: existing.status,
      });
    }

    const { rows: [updated] } = await db.query(`
      UPDATE loyalty_rewards
      SET status = 'granted',
          gift_description = $1,
          notes = $2,
          granted_at = NOW(),
          granted_by = $3
      WHERE id = $4
      RETURNING *
    `, [gift_description.trim(), notes || null, req.user.id, id]);

    log.info(`[loyalty] 🎁 Cadeau accordé user=${existing.user_id} by admin=${req.user.id}: ${gift_description}`);

    res.json({
      success: true,
      reward: updated,
    });
  } catch (err) { next(err); }
});

// ── POST ignorer (skipped) ───────────────────────────────────────────────────
router.post('/skip/:id', adminOnly, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    const { rows: [existing] } = await db.query(
      'SELECT id, status FROM loyalty_rewards WHERE id = $1',
      [id]
    );

    if (!existing) return res.status(404).json({ error: 'Récompense introuvable' });
    if (existing.status !== 'pending') {
      return res.status(409).json({ error: 'Récompense déjà traitée' });
    }

    const { rows: [updated] } = await db.query(`
      UPDATE loyalty_rewards
      SET status = 'skipped',
          notes = $1,
          granted_at = NOW(),
          granted_by = $2
      WHERE id = $3
      RETURNING *
    `, [reason || 'Skipped by admin', req.user.id, id]);

    res.json({ success: true, reward: updated });
  } catch (err) { next(err); }
});

// ── GET historique ───────────────────────────────────────────────────────────
router.get('/history', adminOnly, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    const { rows } = await db.query(`
      SELECT
        lr.id,
        lr.user_id,
        lr.basket_count_at_trigger,
        lr.status,
        lr.gift_description,
        lr.notes,
        lr.created_at,
        lr.granted_at,

        u.full_name, u.phone
      FROM loyalty_rewards lr
      LEFT JOIN users u ON u.id = lr.user_id
      WHERE lr.status IN ('granted', 'skipped')
      ORDER BY lr.granted_at DESC
      LIMIT $1
    `, [limit]);

    res.json({ count: rows.length, history: rows });
  } catch (err) { next(err); }
});

// ── GET stats fidélité ───────────────────────────────────────────────────────
router.get('/stats', adminOnly, async (req, res, next) => {
  try {
    const { rows: [counts] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'granted') AS granted,
        COUNT(*) FILTER (WHERE status = 'skipped') AS skipped
      FROM loyalty_rewards
    `);

    const { rows: [bigBaskets] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE big_basket_count > 0) AS users_with_baskets,
        COALESCE(SUM(big_basket_count), 0) AS total_baskets,
        COALESCE(MAX(big_basket_count), 0) AS max_baskets
      FROM users
      WHERE role = 'client'
    `);

    res.json({
      rewards: {
        pending: Number(counts.pending),
        granted: Number(counts.granted),
        skipped: Number(counts.skipped),
      },
      users: {
        with_big_baskets: Number(bigBaskets.users_with_baskets),
        total_big_baskets: Number(bigBaskets.total_baskets),
        max_baskets_single_user: Number(bigBaskets.max_baskets),
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
