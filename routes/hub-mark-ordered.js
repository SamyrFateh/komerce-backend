/**
 * @komerce-arch
 * @role          orders-hub-mark-ordered
 * @domain        orders
 * @layer         route
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       orders
 * @db-write      order_comments
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout
 * @version       2026-06
 */

/**
 * KOMERCE — Hub Mark Ordered Route
 * POST /api/hub/orders/mark-ordered
 * Transitions a confirmed order to ordered (Commander au sourcing)
 */
'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { transitionOrderStatus } = require('../services/order-status-machine');

const hubAuth = [authenticate, requireRole(['admin', 'agent_hub'])];

// POST /orders/mark-ordered — Commander au sourcing (confirmed → ordered)
router.post('/orders/mark-ordered', ...hubAuth, async (req, res, next) => {
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ error: 'reference requis' });

    const { rows } = await db.query(
      "SELECT id, status, reference FROM orders WHERE reference = $1",
      [reference]
    );
    if (!rows.length) return res.status(404).json({ error: 'Commande introuvable' });
    const order = rows[0];

    if (order.status !== 'confirmed') {
      return res.status(400).json({
        error: `Impossible — statut actuel: ${order.status}`,
        hint: 'La commande doit être confirmée (confirmed) pour être envoyée au sourcing'
      });
    }

    const result = await transitionOrderStatus({
      orderId: order.id,
      newStatus: 'ordered',
      actor: { id: req.user?.id || null, role: req.user?.role || 'system' },
      source: 'hub_mark_ordered',
    });
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Log comment (no scan — "ordered" is not a valid scan_step)
    try {
      await db.query(`
        INSERT INTO order_comments (order_id, author_id, author_name, text)
        VALUES ($1, $2, 'Hub', '🛒 Commandé au sourcing')
      `, [order.id, req.user.id]);
    } catch(e) { /* non-critical */ }

    res.json({
      message: `Commande ${order.reference} envoyée au sourcing`,
      status: 'ordered',
      reference: order.reference
    });
  } catch(e) { next(e); }
});

module.exports = router;
