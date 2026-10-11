/**
 * @komerce-arch
 * @role          market-cash-control-policy-api
 * @domain        market-delegation
 * @layer         route
 * @criticality   critical
 * @inputs        authenticated user, canonical market code, cash policy payload
 * @outputs       market cash policy read/update
 * @depends       db.js, middleware/auth.js, services/market-cash-control-policy-service.js, services/cash-custody-service.js
 * @used-by       bootstrap/api-routes.js, market autonomy UI
 * @db-read       none
 * @db-write      none
 * @db-write-via:market-cash-control-policy-service market_cash_control_policies, market_delegation_audit
 * @db-write-via:cash-custody-service market_cash_destinations
 * @db-txn        explicit
 * @doctrine      market_code_route_is_context_not_authority, capability_authorizes_policy, no_client_market_id
 * @impact-areas  market-delegation, cash, payments, dashboard
 * @version       2026-09
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const {
  readMarketCashPolicy,
  updateMarketCashPolicy,
} = require('../services/market-cash-control-policy-service');
const custody = require('../services/cash-custody-service');

function correlationId(req) {
  const raw = req.headers['x-correlation-id'];
  return raw ? String(raw).slice(0, 200) : null;
}

function rejectClientMarketId(body) {
  if (body && (body.market_id != null || body.marketId != null)) {
    const error = new Error('market_id client interdit ; le marché est résolu depuis la route et la membership.');
    error.code = 'MARKET_ID_FORBIDDEN';
    error.status = 400;
    throw error;
  }
}

function sendKnownError(res, error) {
  if (!error || !error.code || !error.status) return false;
  res.status(error.status).json({ error: error.message, code: error.code });
  return true;
}

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

router.get('/markets/:marketCode/cash-control-policy', authenticate, async (req, res, next) => {
  try {
    const result = await readMarketCashPolicy(db, {
      userId: req.user.id,
      marketCode: req.params.marketCode,
    });
    res.json({
      market: {
        code: result.authz.market_code,
        name: result.authz.market_name,
        currency: result.authz.currency,
      },
      policy: result.policy,
      can_manage: result.authz.capabilities.includes('cash_control.policy.manage'),
    });
  } catch (error) {
    if (sendKnownError(res, error)) return;
    next(error);
  }
});

router.put('/markets/:marketCode/cash-control-policy', authenticate, async (req, res, next) => {
  try {
    rejectClientMarketId(req.body);
    const result = await withTransaction(client => updateMarketCashPolicy(client, {
      userId: req.user.id,
      marketCode: req.params.marketCode,
      payload: req.body || {},
      correlationId: correlationId(req),
    }));
    res.json({
      success: true,
      market: {
        code: result.authz.market_code,
        name: result.authz.market_name,
        currency: result.authz.currency,
      },
      policy: result.policy,
    });
  } catch (error) {
    if (sendKnownError(res, error)) return;
    next(error);
  }
});

// Garde des espèces (PR 4a) : habilités, destinations finales, limites effectives.
router.get('/markets/:marketCode/cash-custody', authenticate, async (req, res, next) => {
  try {
    const result = await custody.readCustody(db, { userId: req.user.id, marketCode: req.params.marketCode });
    res.json({
      market: { code: result.authz.market_code, name: result.authz.market_name, currency: result.authz.currency },
      limits: result.limits,
      recipients: result.recipients,
      destinations: result.destinations,
      can_manage: result.can_manage,
    });
  } catch (error) {
    if (sendKnownError(res, error)) return;
    next(error);
  }
});

router.post('/markets/:marketCode/cash-custody/destinations', authenticate, async (req, res, next) => {
  try {
    rejectClientMarketId(req.body);
    const destination = await withTransaction(client => custody.proposeDestination(client, {
      userId: req.user.id, marketCode: req.params.marketCode, payload: req.body || {}, correlationId: correlationId(req),
    }));
    res.status(201).json({ success: true, destination });
  } catch (error) {
    if (sendKnownError(res, error)) return;
    next(error);
  }
});

router.post('/markets/:marketCode/cash-custody/destinations/:destinationId/:verb', authenticate, async (req, res, next) => {
  try {
    rejectClientMarketId(req.body);
    const destination = await withTransaction(client => custody.transitionDestination(client, {
      userId: req.user.id,
      marketCode: req.params.marketCode,
      destinationId: req.params.destinationId,
      verb: req.params.verb,
      reason: req.body && req.body.reason,
      correlationId: correlationId(req),
    }));
    res.json({ success: true, destination });
  } catch (error) {
    if (sendKnownError(res, error)) return;
    next(error);
  }
});

module.exports = router;
