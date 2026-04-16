/**
 * ═══════════════════════════════════════════════════════════════
 * INVENTORY API v2 — Hub article management + PROPOSITIONS
 * Mounted at /api/hub/inventory
 * ═══════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
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

// ════════════════════════════════════════════════════════════════
// PROPOSAL ENDPOINTS
// ════════════════════════════════════════════════════════════════

// ── GET /proposals — List all pending proposals (dashboard) ──
router.get('/proposals', ...guard, async (req, res, next) => {
  try {
    const proposals = await inventory.getProposals();
    res.json({ proposals, count: proposals.length });
  } catch (err) { next(err); }
});

// ── POST /proposals/confirm-all — Bulk confirm all proposals ──
router.post('/proposals/confirm-all', ...guard, async (req, res, next) => {
  try {
    const result = await inventory.confirmAllProposals();
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// ── POST /proposals/auto-confirm — Auto-confirm expired proposals ──
router.post('/proposals/auto-confirm', ...guard, async (req, res, next) => {
  try {
    const result = await inventory.autoConfirmExpired();
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// ── POST /proposals/repropose-all — Re-run engine on all unassigned items ──
router.post('/proposals/repropose-all', ...guard, async (req, res, next) => {
  try {
    const result = await inventory.proposeAll();
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// ── POST /:id/confirm — Confirm a single proposal ──
router.post('/:id/confirm', ...guard, async (req, res, next) => {
  try {
    const result = await inventory.confirmProposal(req.params.id);
    res.json(result);
  } catch (err) {
    if (err.message.includes('attente')) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ── POST /:id/reassign — Reassign item to different parcel ──
router.post('/:id/reassign', ...guard, async (req, res, next) => {
  try {
    const { parcel_id } = req.body;
    if (!parcel_id) return res.status(400).json({ error: 'parcel_id requis' });

    const result = await inventory.reassignItem(req.params.id, parcel_id);
    res.json(result);
  } catch (err) {
    if (err.message.includes('introuvable')) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// ── GET /:id/compatible-parcels — Get compatible parcels for reassign dropdown ──
router.get('/:id/compatible-parcels', ...guard, async (req, res, next) => {
  try {
    const parcels = await inventory.getCompatibleParcels(req.params.id);
    res.json({ parcels, count: parcels.length });
  } catch (err) {
    if (err.message.includes('introuvable')) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// ── POST /:id/assign — Direct assign (skip proposal) ──
router.post('/:id/assign', ...guard, async (req, res, next) => {
  try {
    const { parcel_id } = req.body;
    if (parcel_id) {
      const result = await inventory.reassignItem(req.params.id, parcel_id);
      return res.json(result);
    }
    const result = await inventory.proposeAssignment(req.params.id);
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
             pcl.reference AS parcel_ref,
             ppcl.reference AS proposed_parcel_ref
      FROM inventory_items ii
      LEFT JOIN orders o ON o.id = ii.order_id
      LEFT JOIN products p ON p.id = ii.product_id
      LEFT JOIN parcels pcl ON pcl.id = ii.parcel_id
      LEFT JOIN parcels ppcl ON ppcl.id = ii.proposed_parcel_id
      ${where}
      ORDER BY ii.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, parseInt(limit), parseInt(offset)]);

    res.json({ items: rows, count: rows.length });
  } catch (err) { next(err); }
});

module.exports = router;
