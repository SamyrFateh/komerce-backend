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
 * @db-read       none
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */

'use strict';
/**
 * KOMERCE — Dashboard unifié v12.0 — Colis-Centric
 * =================================================
 * Point d'entrée : monte les 4 routers spécialisés.
 *
 * GET /api/dashboard/ops              → dashboard-ops
 * GET /api/dashboard/pilotage         → dashboard-ops
 * GET /api/dashboard/pipeline         → dashboard-ops
 * GET /api/dashboard/retards          → dashboard-ops
 * GET /api/dashboard/forecast         → dashboard-ops
 * GET /api/dashboard/stats            → dashboard-ops
 * GET /api/dashboard/global           → dashboard-ops
 * GET /api/dashboard/finance          → dashboard-finance
 * GET /api/dashboard/payments         → dashboard-finance
 * GET /api/dashboard/sales            → dashboard-finance
 * GET /api/dashboard/annulations-parcels → dashboard-finance
 * GET /api/dashboard/clients          → dashboard-clients
 * GET /api/dashboard/clients/list     → dashboard-clients
 * GET /api/dashboard/clients/detail   → dashboard-clients
 * GET /api/dashboard/history          → dashboard-clients
 * GET /api/dashboard/relais           → dashboard-clients
 * GET /api/dashboard/hub              → dashboard-hub (alias → hub-dubai)
 * GET /api/dashboard/hub-dubai        → dashboard-hub
 *
 * Auth : JWT (cookie httpOnly ou Bearer) + rôle admin — appliqué ici, une fois.
 * Rate limit : dashboardLimiter (60 req/min) — appliqué dans app.js.
 */

const express = require('express');
const router  = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');

// ── Auth : toutes les routes dashboard = admin only ──────────────────────────
router.use(authenticate, requireRole(['admin']));

// ── Sous-routers ─────────────────────────────────────────────────────────────
router.use('/', require('./dashboard-ops'));
router.use('/', require('./dashboard-finance'));
router.use('/', require('./dashboard-clients'));
router.use('/', require('./dashboard-hub'));

module.exports = router;
