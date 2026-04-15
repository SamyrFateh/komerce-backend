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

    // Log scan event
    try {
      await db.query(`
        INSERT INTO scans (order_id, step, scanned_by, notes)
        VALUES ($1, 'ordered', $2, $3)
      `, [order.id, req.user.id, `Commandé au sourcing par ${req.user.full_name || 'hub'}`]);
    } catch(e) { console.warn('[HUB] scan log failed:', e.message); }

    // Log comment
    try {
      await db.query(`
        INSERT INTO order_comments (order_id, author_id, author_name, text)
        VALUES ($1, $2, 'Hub', 'Commandé au sourcing 🛒')
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
