/**
 * @komerce-arch
 * @role          logistics-index
 * @domain        logistics
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
 * @impact-areas  logistics
 * @version       2026-06
 */

'use strict';

/**
 * routes/parcel-api-v2/index.js
 * Extrait de routes/parcel-api-v2.js — lot GOD-FILES-4 (2026-05-25)
 *
 * Monte : auth + relay-scope middleware, puis les sous-routers.
 * La façade routes/parcel-api-v2.js délègue ici.
 */

const express = require('express');
const router  = express.Router();
const { authenticate, requireRole } = require('../../middleware/auth');
const { relayAgentScopeMiddleware }  = require('./helpers');

// ── Auth : admin + agent_hub + agent_relais ───────────────────────────
router.use(authenticate, requireRole(['admin', 'agent_hub', 'agent_relais']));

// ── Relay-scope : strip pickup_code + scope guard ─────────────────────
router.use(relayAgentScopeMiddleware);

// ── Sous-routers ──────────────────────────────────────────────────────
router.use('/', require('./read'));
router.use('/', require('./scans'));

module.exports = router;
