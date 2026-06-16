/**
 * @komerce-arch
 * @role          dashboard-dashboard
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
const log = require('../../utils/logger').child({ module: 'admin/dashboard' });

const guard = [authenticate, requireRole(['admin'])];

// ── Redirections rétro-compatibles ─────────────────────
// NOTE: /dashboard et /margins renvoient vers routes distinctes (admin-dashboard.js
// et routes/dashboard-finance.js). Ce ne sont PAS des doublons — intentionnel.
// Vérifier CARTOGRAPHY_360.md §3 avant toute modification.
router.get('/dashboard', ...guard, (req, res) => {
  res.status(301).json({ error: 'Endpoint déplacé', redirect: '/api/dashboard/ops', message: 'Utilisez GET /api/dashboard/ops à la place' });
});
router.get('/margins', ...guard, (req, res) => {
  res.status(301).json({ error: 'Endpoint déplacé', redirect: '/api/dashboard/finance', message: 'Utilisez GET /api/dashboard/finance à la place' });
});
router.get('/alerts', ...guard, (req, res) => {
  res.status(301).json({ error: 'Endpoint déplacé', redirect: '/api/dashboard/ops', message: 'Les alertes sont maintenant dans GET /api/dashboard/ops (section alertes)' });
});

module.exports = router;
