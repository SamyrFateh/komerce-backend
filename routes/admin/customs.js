/**
 * @komerce-arch
 * @role          dashboard-customs
 * @domain        dashboard
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate, requireRole } = require('../../middleware/auth');
const log = require('../../utils/logger').child({ module: 'admin/customs' });

const guard = [authenticate, requireRole(['admin'])];

// ─── GET /api/admin/customs ────────────────────────────────────────
router.get('/customs', ...guard, async (req, res, next) => {
  try {
    // customs_history table may not exist yet
    res.json({ history: [], by_category: [], anomalies: [], period_days: 90, note: 'customs_history non implémenté' });
  } catch(err) { next(err); }
});

module.exports = router;
