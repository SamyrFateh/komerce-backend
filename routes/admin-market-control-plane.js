/**
 * @komerce-arch
 * @role          admin-market-control-plane-api
 * @domain        market-control-plane
 * @layer         route
 * @criticality   medium
 * @inputs        central admin actor, canonical market code in path
 * @outputs       read-only market list, per-market control view with gap report, and active central authority overview
 * @depends       db.js, middleware/auth.js, services/market-control-plane.js, services/central-authority.js
 * @used-by       bootstrap/api-routes.js, central admin workspace
 * @db-read       none
 * @db-write      none
 * @db-read-via:market-control-plane markets, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling, market_payment_providers, market_cash_control_policies, relais
 * @db-txn        none
 * @doctrine      control_plane_is_read_only, central_by_role_declared, no_second_authorization_engine
 * @impact-areas  market-delegation, market, authorization
 * @version       2026-10-v1
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const controlPlane = require('../services/market-control-plane');
const centralAuthority = require('../services/central-authority');

// Vue centrale par rôle (Q4 du chantier) : déclarée ici, jamais implicite.
const centralAdmin = [authenticate, requireRole(['admin'])];

function sendKnownError(res, error) {
  if (!error || !error.code || !error.status) return false;
  res.status(error.status).json({ error: error.message, code: error.code });
  return true;
}

router.get('/', ...centralAdmin, async (req, res, next) => {
  try {
    res.json({ markets: await controlPlane.listMarkets(db) });
  } catch (error) {
    if (!sendKnownError(res, error)) next(error);
  }
});

// Autorité centrale (lecture seule) : qui détient une autorisation explicite active, par domaine.
router.get('/central-authority', ...centralAdmin, async (req, res, next) => {
  try {
    res.json(await centralAuthority.overview(db));
  } catch (error) {
    if (!sendKnownError(res, error)) next(error);
  }
});

router.get('/:marketCode/control-plane', ...centralAdmin, async (req, res, next) => {
  try {
    res.json(await controlPlane.getControlPlane(db, req.params.marketCode));
  } catch (error) {
    if (!sendKnownError(res, error)) next(error);
  }
});

module.exports = router;
