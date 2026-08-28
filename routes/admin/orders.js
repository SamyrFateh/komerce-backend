/**
 * @komerce-arch
 * @role          orders-orders
 * @domain        orders
 * @layer         route
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       markets, order_items, orders, products, recipients, relais, users
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout, admin-dashboard
 * @version       2026-06
 */

'use strict';

const crypto = require('crypto');
const express = require('express');
const router  = express.Router();
const db      = require('../../db');
const { authenticate, requireRole } = require('../../middleware/auth');
const log = require('../../utils/logger').child({ module: 'admin/orders' });
const { deleteOrderCascade } = require('./delete-order-cascade');
const { refundCancelledOrder } = require('../../services/admin-order-refund');

const guard = [authenticate, requireRole(['admin'])];

// ─── GET /api/admin/orders ─────────────────────────────────────────
router.get('/orders', ...guard, async (req, res, next) => {
  try {
    const {
      status, payment_mode, confection_type, from_date, to_date,
      search, margin_alert, limit = 50, offset = 0,
    } = req.query;

    const conditions = ['1=1'];
    const params     = [];
    let   pi         = 1;

    if (status)           { conditions.push(`o.status = $${pi++}`); params.push(status); }
    if (payment_mode)     { conditions.push(`o.payment_mode = $${pi++}`); params.push(payment_mode); }
    if (confection_type)  { conditions.push(`o.confection_type = $${pi++}`); params.push(confection_type); }
    if (from_date)        { conditions.push(`o.created_at >= $${pi++}`); params.push(from_date); }
    if (to_date)          { conditions.push(`o.created_at <= $${pi++}`); params.push(to_date); }
    if (margin_alert === 'true') { conditions.push('o.margin_alert = TRUE'); }
    if (search) {
      conditions.push(`(o.reference ILIKE $${pi} OR u.full_name ILIKE $${pi} OR u.phone ILIKE $${pi})`);
      params.push(`%${search}%`);
      pi++;
    }

    const where = conditions.join(' AND ');
    const { rows } = await db.query(
      `SELECT DISTINCT ON (o.id)
         o.id, o.reference, o.status, o.total_kmf,
         o.cost_estimated_kmf, o.cost_real_kmf, o.cost_delta_pct,
         o.margin_estimated_pct, o.margin_real_pct, o.margin_alert, o.sourcing_blocked,
         o.payment_mode, o.payment_status,
         o.confection_type, o.confection_instructions, o.confection_delay_days,
         rc.full_name AS recipient_name, rc.phone AS recipient_phone,
         o.created_at, o.ordered_at, o.purchasing_at, o.preparation_at,
         o.shipped_at, o.available_at, o.collected_at, o.cash_paid_at,
         (SELECT p2.name FROM order_items oi2 JOIN products p2 ON p2.id = oi2.product_id WHERE oi2.order_id = o.id LIMIT 1) AS product_name,
         (SELECT p2.category FROM order_items oi2 JOIN products p2 ON p2.id = oi2.product_id WHERE oi2.order_id = o.id LIMIT 1) AS category,
         u.full_name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
         r.name AS relais_name, r.zone AS relais_zone,
         r.island AS relais_island,
         m.code AS market_code,
         o.destination_island
       FROM orders o
       LEFT JOIN users    u ON u.id = o.user_id
       LEFT JOIN relais   r ON r.id = o.relais_id
       LEFT JOIN markets  m ON m.id = o.market_id
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       WHERE ${where}
       ORDER BY o.id, o.created_at DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, Number(limit), Number(offset)]
    );

    const { rows: [{ count }] } = await db.query(
      `SELECT COUNT(*) FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE ${where}`,
      params
    );

    res.json({ orders: rows, total: Number(count) });
  } catch(err) { next(err); }
});

// ─── DELETE /api/admin/orders/:id ──────────────────────────────────
router.delete('/orders/:id', ...guard, async (req, res, next) => {
  const { id } = req.params;
  try {
    const { rows: [order] } = await db.query('SELECT id, reference, status FROM orders WHERE id = $1::uuid', [id]);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    await deleteOrderCascade(db, id);

    log.info(`🗑️ Admin deleted order ${order.reference} (${id}) by ${req.user.email}`);
    res.json({
      success: true,
      message: `Commande ${order.reference} supprimée`,
      deleted: { id, reference: order.reference, status: order.status },
    });
  } catch(err) { next(err); }
});

// ─── POST /api/admin/orders/:id/refund ─────────────────────────────
// AUD-05 — extrait de middleware/auth.js (god-middleware)
router.post('/orders/:id/refund', ...guard, async (req, res, next) => {
  try {
    const result = await refundCancelledOrder({
      orderId: req.params.id,
      user: req.user,
      dryRun: req.body?.dry_run !== false,
      reason: req.body?.reason || null,
      cashMode: req.body?.cash_mode || 'manual',
    });
    return res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

module.exports = router;
