/**
 * @komerce-arch
 * @role          admin-market-control-plane-api
 * @domain        market-control-plane
 * @layer         route
 * @criticality   medium
 * @inputs        central admin actor, canonical market code in path
 * @outputs       market list/control view, provisioning/reprovisioning/lifecycle mutations, central authority overview
 * @depends       db.js, middleware/auth.js, services/market-control-plane.js, services/central-authority.js
 * @used-by       bootstrap/api-routes.js, central admin workspace
 * @db-read       none
 * @db-write      none
 * @db-write-via:market-provisioning-service markets, market_operating_assignments, assignment_capability_ceiling, assignment_memberships, membership_capabilities, market_cash_control_policies, market_payment_providers, relais
 * @db-read-via:market-control-plane markets, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling, market_payment_providers, market_cash_control_policies, relais
 * @db-txn        explicit for mutation routes
 * @doctrine      control_plane_orchestrates_owned_writers, central_by_role_declared, no_second_authorization_engine
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
const { provisionMarket, reprovisionMarket, setMarketLifecycle } = require('../services/market-provisioning-service');

// Vue centrale par rôle (Q4 du chantier) : déclarée ici, jamais implicite.
const centralAdmin = [authenticate, requireRole(['admin'])];

async function withTransaction(work) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* preserve original */ }
    throw error;
  } finally {
    client.release();
  }
}

function sendKnownError(res, error) {
  if (!error || !error.code || !error.status) return false;
  res.status(error.status).json({ error: error.message, code: error.code });
  return true;
}

router.post('/', ...centralAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const result = await withTransaction(client => provisionMarket(client, {
      actorUserId: req.user.id,
      code: body.code,
      name: body.name,
      currency: body.currency,
      minorUnit: body.minor_unit,
      storefrontTexts: body.storefront_texts || {},
      centralReferentUserId: body.central_referent_user_id,
      financialLimits: body.financial_limits || {},
      lead: body.lead || {},
      paymentProvider: body.payment_provider || null,
      cashPolicy: body.cash_policy || null,
      initialRelais: body.initial_relais || null,
      correlationId: req.headers['x-correlation-id'] ? String(req.headers['x-correlation-id']).slice(0, 200) : null,
    }));
    res.status(201).json(result);
  } catch (error) {
    if (!sendKnownError(res, error)) next(error);
  }
});

router.post('/:marketCode/reprovision', ...centralAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const result = await withTransaction(client => reprovisionMarket(client, {
      actorUserId: req.user.id,
      marketCode: req.params.marketCode,
      centralReferentUserId: body.central_referent_user_id,
      financialLimits: body.financial_limits || {},
      lead: body.lead || {},
      paymentProvider: body.payment_provider || null,
      cashPolicy: body.cash_policy || null,
      initialRelais: body.initial_relais || null,
      correlationId: req.headers['x-correlation-id'] ? String(req.headers['x-correlation-id']).slice(0, 200) : null,
    }));
    res.status(201).json(result);
  } catch (error) {
    if (!sendKnownError(res, error)) next(error);
  }
});

router.post('/:marketCode/lifecycle', ...centralAdmin, async (req, res, next) => {
  try {
    const result = await withTransaction(client => setMarketLifecycle(client, {
      actorUserId: req.user.id,
      marketCode: req.params.marketCode,
      targetStatus: req.body && req.body.status,
      correlationId: req.headers['x-correlation-id'] ? String(req.headers['x-correlation-id']).slice(0, 200) : null,
    }));
    res.json(result);
  } catch (error) {
    if (!sendKnownError(res, error)) next(error);
  }
});

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
