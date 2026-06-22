/**
 * @komerce-arch
 * @role          inventory-inventory-api
 * @domain        inventory
 * @layer         route
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  inventory
 * @version       2026-06
 */

/**
 * ═══════════════════════════════════════════════════════════════
 * INVENTORY API v3 — Scan-driven, proposals as guidance
 * Mounted at /api/hub/inventory
 * ═══════════════════════════════════════════════════════════════
 */
const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const inv = require('../services/inventory-service');

router.use(authenticate, requireRole(['admin', 'agent_hub']));

// ─── RECEIVE ──────────────────────────────────────────────────
router.post('/receive', async (req, res, next) => {
  try {
    const result = await inv.receiveItem(req.body);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── SCAN INTO PARCEL (the real action) ───────────────────────
router.post('/scan-assign', async (req, res, next) => {
  try {
    const { inventory_item_id, parcel_id } = req.body;
    if (!inventory_item_id || !parcel_id) return res.status(400).json({ error: 'inventory_item_id + parcel_id requis' });
    const result = await inv.scanIntoParcel(inventory_item_id, parcel_id);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── RECALCULATE ALL PROPOSALS ────────────────────────────────
router.post('/propose-all', async (req, res, next) => {
  try {
    const result = await inv.proposeAll();
    res.json({ ok: true, ...result });
  } catch (e) {
    next(e);
  }
});

// ─── LIST PROPOSALS + BUFFER ──────────────────────────────────
router.get('/proposals', async (req, res, next) => {
  try {
    const items = await inv.listProposals();
    res.json({ ok: true, items });
  } catch (e) {
    next(e);
  }
});

// ─── OPEN PARCELS (for UI dropdown) ───────────────────────────
router.get('/open-parcels', async (req, res, next) => {
  try {
    const parcels = await inv.listOpenParcels();
    res.json({ ok: true, parcels });
  } catch (e) {
    next(e);
  }
});

// ─── BUFFER ITEMS ─────────────────────────────────────────────
router.get('/buffer', async (req, res, next) => {
  try {
    const items = await inv.listProposals();
    res.json({ ok: true, items: items.filter(i => i.status === 'buffered') });
  } catch (e) {
    next(e);
  }
});

// ─── STATS / KPI ──────────────────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await inv.getStats();
    res.json({ ok: true, ...stats });
  } catch (e) {
    next(e);
  }
});

// ─── DISPATCH DECISION ────────────────────────────────────────
router.get('/order/:id/dispatch', async (req, res) => {
  try {
    const result = await inv.shouldDispatch(req.params.id);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
