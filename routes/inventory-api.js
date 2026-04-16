/**
 * ═══════════════════════════════════════════════════════════════
 * INVENTORY API — Hub article management endpoints
 * Mounted at /api/hub/inventory
 * ═══════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const inventory = require('../services/inventory-service');

const guard = [authenticate, requireRole(['admin', 'agent_hub'])];

// ── POST /receive — Receive an article at the Hub ──
router.post('/receive', ...guard, async (req, res, next) => {
  try {
    const { order_item_id, quantity, notes } = req.body;
    if (!order_item_id) return res.status(400).json({ error: 'order_item_id requis' });

    const item = await inventory.receiveItem({
      order_item_id,
      quantity: quantity || 1,
      received_by: req.user.id,
      notes,
    });

    res.json({ success: true, item });
  } catch (err) {
    if (err.message.includes('introuvable')) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// ── POST /:id/assign — Assign inventory item to a parcel ──
router.post('/:id/assign', ...guard, async (req, res, next) => {
  try {
    const result = await inventory.assignItemToParcel(req.params.id);
    res.json(result);
  } catch (err) {
    if (err.message.includes('introuvable')) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// ── POST /:id/buffer — Explicitly buffer an item ──
router.post('/:id/buffer', ...guard, async (req, res, next) => {
  try {
    const { reason, hours } = req.body;
    if (!reason) return res.status(400).json({ error: 'reason requis' });

    const result = await inventory.bufferItem(req.params.id, reason, hours || 12);
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /buffer — List all buffered items ──
router.get('/buffer', ...guard, async (req, res, next) => {
  try {
    const items = await inventory.getBufferItems();
    res.json({ items, count: items.length });
  } catch (err) { next(err); }
});

// ── GET /stats — Hub KPIs ──
router.get('/stats', ...guard, async (req, res, next) => {
  try {
    const stats = await inventory.getHubStats();
    res.json(stats);
  } catch (err) { next(err); }
});

// ── GET /order/:orderId/completion — Order completion info ──
router.get('/order/:orderId/completion', ...guard, async (req, res, next) => {
  try {
    const result = await inventory.updateOrderCompletion(req.params.orderId);
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /order/:orderId/dispatch — Should dispatch? ──
router.get('/order/:orderId/dispatch', ...guard, async (req, res, next) => {
  try {
    const result = await inventory.shouldDispatchOrder(req.params.orderId);
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET / — List all inventory items (with filters) ──
router.get('/', ...guard, async (req, res, next) => {
  try {
    const { status, order_id, limit = 100, offset = 0 } = req.query;
    let conditions = [];
    let params = [];
    let idx = 1;

    if (status) { conditions.push(`ii.status = $${idx++}`); params.push(status); }
    if (order_id) { conditions.push(`ii.order_id = $${idx++}`); params.push(order_id); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await db.query(`
      SELECT ii.*, 
             o.reference AS order_ref, o.destination_island,
             p.name AS product_name,
             pcl.reference AS parcel_ref
      FROM inventory_items ii
      LEFT JOIN orders o ON o.id = ii.order_id
      LEFT JOIN products p ON p.id = ii.product_id
      LEFT JOIN parcels pcl ON pcl.id = ii.parcel_id
      ${where}
      ORDER BY ii.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, parseInt(limit), parseInt(offset)]);

    res.json({ items: rows, count: rows.length });
  } catch (err) { next(err); }
});

const db = require('../db');

module.exports = router;
