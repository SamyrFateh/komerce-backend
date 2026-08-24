/**
 * @komerce-arch
 * @role          dashboard-market-scoped-route
 * @domain        admin-dashboard
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_admin, requested_market_code, dashboard_filters
 * @outputs       authorized_market_pilotage_projection
 * @depends       db, middleware/auth, middleware/require-market-scope, services/dashboard-pilotage-market
 * @used-by       bootstrap/api-routes.js
 * @db-read       markets, operator_market_scopes
 * @db-write      none
 * @db-txn        none
 * @doctrine      server_market_scope_is_authority
 * @impact-areas  dashboard, admin-dashboard, market-authorization
 * @version       2026-08
 */

'use strict';

const express = require('express');
const db = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { attachAuthorizedMarkets, requireMarketScope } = require('../middleware/require-market-scope');
const pilotage = require('../services/dashboard-pilotage-market');
const log = require('../utils/logger').child({ module: 'admin-dashboard-market' });

const router = express.Router();
const MARKET_CODE = /^[A-Z]{2}$/;

function rejectClientMarketId(req, res, next) {
  if (Object.prototype.hasOwnProperty.call(req.query || {}, 'market_id')) {
    return res.status(400).json({
      error: 'market_id client interdit — utilisez le code marché de la route',
      code: 'client_market_id_forbidden',
    });
  }
  next();
}

async function resolveRequestedMarket(req, res, next) {
  const code = String(req.params.marketCode || '').trim().toUpperCase();
  if (!MARKET_CODE.test(code)) {
    return res.status(400).json({ error: 'Code marché invalide', code: 'invalid_market_code' });
  }

  try {
    const { rows } = await db.query(
      `SELECT id, code, name, currency
       FROM markets
       WHERE code = $1 AND is_active = TRUE
       LIMIT 1`,
      [code]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Marché introuvable ou inactif', code: 'market_not_found' });
    }

    req.dashboardMarket = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

function parseFilters(req) {
  return {
    from: req.query.from || null,
    to: req.query.to || null,
    island: req.query.island || null,
    relais_id: req.query.relais_id || null,
    status: req.query.status || null,
    payment_status: req.query.payment_status || null,
    cost_status: req.query.cost_status || null,
    channel: req.query.channel || null,
    origin: req.query.origin || null,
    market_id: req.dashboardMarket.id,
  };
}

router.get(
  '/unified/market/:marketCode',
  authenticate,
  requireAdmin,
  rejectClientMarketId,
  resolveRequestedMarket,
  attachAuthorizedMarkets,
  requireMarketScope(req => req.dashboardMarket && req.dashboardMarket.id),
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const filters = parseFilters(req);
      const payload = await pilotage.buildMarketPilotage(filters, req.dashboardMarket);
      res.json(payload);
    } catch (err) {
      log.error({ err, market: req.dashboardMarket && req.dashboardMarket.code }, '[admin-dashboard-market] unified market error');
      next(err);
    }
  }
);

module.exports = router;
module.exports._test = {
  rejectClientMarketId,
  resolveRequestedMarket,
  parseFilters,
};
