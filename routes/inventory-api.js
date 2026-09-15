/**
 * @komerce-arch
 * @role          inventory-inventory-api
 * @domain        inventory
 * @layer         route
 * @criticality   critical
 * @inputs        authenticated hub physical receipt / scan / split / repack request
 * @outputs       inventory physical allocation response
 * @depends       middleware/auth.js, services/inventory-service.js, services/hub-packing-service.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       none
 * @db-write      none
 * @db-txn        service_owned
 * @doctrine      HUB-001_PHYSICAL_IDENTITY_ALLOCATION_CUSTODY
 * @impact-areas  inventory, logistics
 * @version       2026-09
 */

'use strict';
const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const inv = require('../services/inventory-service');
const packing = require('../services/hub-packing-service');

router.use(authenticate, requireRole(['admin', 'agent_hub']));

function errorStatus(err) {
  if (!err || !err.code) return 400;
  if (
    err.code === 'HUB_ORDER_ITEM_NOT_FOUND' ||
    err.code === 'HUB_PARCEL_NOT_FOUND' ||
    err.code === 'HUB_SPLIT_SOURCE_NOT_FOUND'
  ) return 404;
  if (
    err.code.includes('REASSIGNMENT') ||
    err.code.includes('CONFLICT') ||
    err.code.includes('AMBIGUOUS') ||
    err.code.includes('UNPROVEN') ||
    err.code.includes('INCOMPLETE') ||
    err.code.includes('OVER_PURCHASE') ||
    err.code.includes('SPLIT_') ||
    err.code.includes('REPACK_') ||
    err.code === 'HUB_EXPLICIT_SPLIT_REQUIRED'
  ) return 409;
  return 400;
}

function sendError(res, err, fallbackCode) {
  return res.status(errorStatus(err)).json({
    error: err.message,
    code: err.code || fallbackCode,
    details: err.details || undefined,
  });
}

router.post('/receive', async (req, res) => {
  try {
    const result = await inv.receiveItem({
      ...req.body,
      received_by: req.user && req.user.id || null,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    sendError(res, e, 'HUB_RECEIVE_FAILED');
  }
});

router.post('/scan-assign', async (req, res) => {
  try {
    const { inventory_item_id, parcel_id } = req.body;
    if (!inventory_item_id || !parcel_id) {
      return res.status(400).json({ error: 'inventory_item_id + parcel_id requis' });
    }
    const result = await inv.scanIntoParcel(inventory_item_id, parcel_id, {
      scanned_by: req.user && req.user.id || null,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    sendError(res, e, 'HUB_ASSIGN_FAILED');
  }
});

// Split physique explicite : crée une allocation enfant avec lineage, ne
// change jamais order/order_item/PO/Market/Relais.
router.post('/split', async (req, res) => {
  try {
    const { inventory_item_id, to_parcel_id, quantity } = req.body || {};
    if (!inventory_item_id || !to_parcel_id || quantity == null) {
      return res.status(400).json({ error: 'inventory_item_id + to_parcel_id + quantity requis' });
    }
    const result = await packing.splitPhysicalAllocation({
      inventory_item_id,
      to_parcel_id,
      quantity,
      actor_id: req.user && req.user.id || null,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    sendError(res, e, 'HUB_SPLIT_FAILED');
  }
});

// Repack explicite : déplace le contenant physique seulement, vers un colis
// compatible de même Market/Relais ; aucune identité upstream n'est modifiée.
router.post('/repack', async (req, res) => {
  try {
    const { inventory_item_id, to_parcel_id } = req.body || {};
    if (!inventory_item_id || !to_parcel_id) {
      return res.status(400).json({ error: 'inventory_item_id + to_parcel_id requis' });
    }
    const result = await packing.repackPhysicalAllocation({
      inventory_item_id,
      to_parcel_id,
      actor_id: req.user && req.user.id || null,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    sendError(res, e, 'HUB_REPACK_FAILED');
  }
});

router.post('/propose-all', async (req, res, next) => {
  try {
    const result = await inv.proposeAll();
    res.json({ ok: true, ...result });
  } catch (e) {
    next(e);
  }
});

router.get('/proposals', async (req, res, next) => {
  try {
    const items = await inv.listProposals();
    res.json({ ok: true, items });
  } catch (e) {
    next(e);
  }
});

router.get('/open-parcels', async (req, res, next) => {
  try {
    const parcels = await inv.listOpenParcels();
    res.json({ ok: true, parcels });
  } catch (e) {
    next(e);
  }
});

router.get('/buffer', async (req, res, next) => {
  try {
    const items = await inv.listProposals();
    res.json({ ok: true, items: items.filter((i) => i.status === 'buffered') });
  } catch (e) {
    next(e);
  }
});

router.get('/stats', async (req, res, next) => {
  try {
    const stats = await inv.getStats();
    res.json({ ok: true, ...stats });
  } catch (e) {
    next(e);
  }
});

router.get('/order/:id/dispatch', async (req, res) => {
  try {
    const result = await inv.shouldDispatch(req.params.id);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
