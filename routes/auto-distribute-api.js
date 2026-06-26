/**
 * @komerce-arch
 * @role          auto-distribute-api
 * @domain        logistics
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

/**
 * KOMERCE — Auto-Distribution API v3
 *
 * POST /api/hub/auto-distribute        — distribute all unassigned orders
 * GET  /api/hub/auto-distribute         — get distribution overview
 * POST /api/hub/auto-distribute/cleanup — delete ghost parcels
 */

'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const autoParcel = require('../services/auto-parcel');
const log = require('../utils/logger').child({ module: 'auto-distribute-api' });

const guard = [authenticate, requireRole(['admin', 'agent_hub'])];

// POST /auto-distribute — run distribution
router.post('/auto-distribute', ...guard, async (req, res, next) => {
  try {
    // First cleanup ghost parcels
    const cleanup = await autoParcel.cleanupGhostParcels();

    // Then distribute
    const result = await autoParcel.distributeAll();

    res.json({
      message: `${result.distributed} commande(s) répartie(s), ${result.queued} en file, ${cleanup.cancelled} colis fantômes annulés`,
      ...result,
      cleanup
    });
  } catch (e) {
    next(e);
  }
});

// GET /auto-distribute — overview for dashboard
router.get('/auto-distribute', ...guard, async (req, res, next) => {
  try {
    const data = await autoParcel.getDistribution();
    res.json(data);
  } catch (e) {
    next(e);
  }
});

// POST /auto-distribute/cleanup — manual ghost cleanup
router.post('/auto-distribute/cleanup', ...guard, async (req, res, next) => {
  try {
    const result = await autoParcel.cleanupGhostParcels();
    res.json({ message: `${result.cancelled} colis fantômes annulés`, ...result });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
