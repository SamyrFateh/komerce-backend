/**
 * @komerce-arch
 * @role          canonical-providers-capabilities-route
 * @domain        admin-dashboard
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_admin
 * @outputs       provider_capability_matrix_with_runtime_decision
 * @depends       middleware/auth, services/provider-certification-overview
 * @used-by       bootstrap/api-routes.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      activation_is_not_authorization, provider_secrets_never_exposed, read_only_projection
 * @impact-areas  admin-dashboard, supplier-connectivity
 * @version       2026-10
 */
'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const overview = require('../services/provider-certification-overview');

const router = express.Router();

router.get('/capabilities', authenticate, requireRole(['admin']), (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json(overview.buildProviderCertificationOverview());
  } catch (error) {
    next(error);
  }
});

module.exports = router;
