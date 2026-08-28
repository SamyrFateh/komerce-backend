/**
 * @komerce-arch
 * @role          canonical-client-index-route
 * @domain        admin-dashboard
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_admin, requested_market_code, client_search, client_sort, pagination
 * @outputs       authorized_client_index_projection
 * @depends       db, middleware/auth, middleware/require-market-scope, middleware/require-dashboard-global-authority, services/client-index
 * @used-by       bootstrap/api-routes.js
 * @db-read       markets, operator_market_scopes, dashboard_global_access_grants, orders, users, recipients
 * @db-write      none
 * @db-txn        none
 * @doctrine      server_market_scope_is_authority, server_global_context_explicit, client_index_finds_client_360
 * @impact-areas  admin-dashboard, clients, market-authorization
 * @version       2026-08
 */

'use strict';

const express = require('express');
const db = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { attachAuthorizedMarkets, requireMarketScope } = require('../middleware/require-market-scope');
const {
  hasDashboardGlobalAuthority,
  requireDashboardGlobalAuthority,
} = require('../middleware/require-dashboard-global-authority');
const clientIndex = require('../services/client-index');
const log = require('../utils/logger').child({ module: 'admin-client-index' });

const router = express.Router();
const MARKET_CODE = /^[A-Z]{2}$/;

function rejectClientMarketIdentity(req, res, next) {
  const query = req.query || {};
  if (Object.prototype.hasOwnProperty.call(query, 'market_id') ||
      Object.prototype.hasOwnProperty.call(query, 'marketId')) {
    return res.status(400).json({
      error: 'Identifiant marché client interdit — utilisez le code marché de la route',
      code: 'client_market_identity_forbidden',
    });
  }
  return next();
}

function queryFor(req) {
  return {
    search: req.query.search || '',
    sort: req.query.sort || 'recent',
    page: req.query.page || '1',
    page_size: req.query.page_size || '25',
  };
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
    req.clientIndexMarket = rows[0];
    return next();
  } catch (err) {
    return next(err);
  }
}

function requireClientIndexMarketRead(req, res, next) {
  const targetMarketId = req.clientIndexMarket && req.clientIndexMarket.id;
  const marketGuard = requireMarketScope(() => targetMarketId);

  if (req.authorizedMarkets && req.authorizedMarkets.has(targetMarketId)) {
    return marketGuard(req, res, next);
  }

  return hasDashboardGlobalAuthority(req.user && req.user.id)
    .then(globalAllowed => globalAllowed ? next() : marketGuard(req, res, next))
    .catch(next);
}

async function marketHandler(req, res, next) {
  try {
    res.set('Cache-Control', 'private, no-store');
    const payload = await clientIndex.listClients(queryFor(req), {
      marketIds: [req.clientIndexMarket.id],
      market: req.clientIndexMarket,
    });
    return res.json(payload);
  } catch (err) {
    log.error({ err, market: req.clientIndexMarket && req.clientIndexMarket.code }, '[admin-client-index] market read failed');
    return next(err);
  }
}

async function globalHandler(req, res, next) {
  try {
    res.set('Cache-Control', 'private, no-store');
    const payload = await clientIndex.listClients(queryFor(req), { marketIds: null });
    return res.json(payload);
  } catch (err) {
    log.error({ err }, '[admin-client-index] global read failed');
    return next(err);
  }
}

router.get('/clients/market/:marketCode', authenticate, requireAdmin, rejectClientMarketIdentity, resolveRequestedMarket, attachAuthorizedMarkets, requireClientIndexMarketRead, marketHandler);

router.get('/clients', authenticate, requireAdmin, rejectClientMarketIdentity, requireDashboardGlobalAuthority, globalHandler);

module.exports = router;
module.exports._test = {
  MARKET_CODE,
  rejectClientMarketIdentity,
  queryFor,
  resolveRequestedMarket,
  requireClientIndexMarketRead,
  marketHandler,
  globalHandler,
};
