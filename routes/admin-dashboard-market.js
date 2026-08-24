/**
 * @komerce-arch
 * @role          dashboard-market-scoped-route
 * @domain        admin-dashboard
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_admin, requested_market_code, dashboard_filters
 * @outputs       authorized_market_pilotage_projection, authorized_market_commerce_projection, authorized_market_operations_projection, global_dashboard_gate, canonical_admin_context
 * @depends       db, middleware/auth, middleware/require-market-scope, middleware/require-dashboard-global-authority, services/dashboard-pilotage-market, services/dashboard-commerce, services/dashboard-operations, services/dashboard-admin-context
 * @used-by       bootstrap/api-routes.js
 * @db-read       markets, operator_market_scopes, dashboard_global_access_grants
 * @db-write      none
 * @db-txn        none
 * @doctrine      server_market_scope_is_authority, server_global_context_explicit
 * @impact-areas  dashboard, admin-dashboard, market-authorization
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
const {
  DashboardAccessDeniedError,
  resolveDashboardAdminContext,
} = require('../services/dashboard-admin-context');
const pilotage = require('../services/dashboard-pilotage-market');
const commerce = require('../services/dashboard-commerce');
const operations = require('../services/dashboard-operations');
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
    // Autorité : injectée depuis la ressource marché résolue côté serveur.
    market_id: req.dashboardMarket.id,
  };
}

function requireDashboardMarketRead(req, res, next) {
  const targetMarketId = req.dashboardMarket && req.dashboardMarket.id;
  const marketGuard = requireMarketScope(() => targetMarketId);

  if (req.authorizedMarkets && req.authorizedMarkets.has(targetMarketId)) {
    return marketGuard(req, res, next);
  }

  return hasDashboardGlobalAuthority(req.user && req.user.id)
    .then(globalAllowed => {
      if (globalAllowed) {
        req.dashboardGlobalAuthority = true;
        return next();
      }
      return marketGuard(req, res, next);
    })
    .catch(next);
}

router.get(
  '/context',
  authenticate,
  requireAdmin,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const context = await resolveDashboardAdminContext(req.user);
      res.json(context);
    } catch (err) {
      if (err instanceof DashboardAccessDeniedError || err.code === 'dashboard_access_denied') {
        return res.status(403).json({
          error: 'Accès refusé — aucun contexte dashboard autorisé',
          code: 'dashboard_access_denied',
        });
      }
      next(err);
    }
  }
);

router.get(
  '/unified/market/:marketCode',
  authenticate,
  requireAdmin,
  rejectClientMarketId,
  resolveRequestedMarket,
  attachAuthorizedMarkets,
  requireDashboardMarketRead,
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

router.get(
  '/commerce/market/:marketCode',
  authenticate,
  requireAdmin,
  rejectClientMarketId,
  resolveRequestedMarket,
  attachAuthorizedMarkets,
  requireDashboardMarketRead,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const payload = await commerce.buildCommerce(req.query, { market: req.dashboardMarket });
      res.json(payload);
    } catch (err) {
      log.error({ err, market: req.dashboardMarket && req.dashboardMarket.code }, '[admin-dashboard-market] commerce market error');
      next(err);
    }
  }
);

router.get(
  '/operations/market/:marketCode',
  authenticate,
  requireAdmin,
  rejectClientMarketId,
  resolveRequestedMarket,
  attachAuthorizedMarkets,
  requireDashboardMarketRead,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const payload = await operations.buildOperations({ market: req.dashboardMarket });
      res.json(payload);
    } catch (err) {
      log.error({ err, market: req.dashboardMarket && req.dashboardMarket.code }, '[admin-dashboard-market] operations market error');
      next(err);
    }
  }
);

// IMPORTANT : ce router est monté AVANT routes/admin-dashboard.js dans
// bootstrap/api-routes.js. Tout chemin global non consommé ci-dessus doit
// franchir ce verrou. Le rôle admin ne suffit jamais : seul un grant actif
// dashboard_global_access_grants autorise la vue multi-market.
router.use(
  authenticate,
  requireAdmin,
  requireDashboardGlobalAuthority
);

router.get(
  '/commerce',
  rejectClientMarketId,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const payload = await commerce.buildCommerce(req.query);
      res.json(payload);
    } catch (err) {
      log.error({ err }, '[admin-dashboard-market] commerce global error');
      next(err);
    }
  }
);

router.get(
  '/operations',
  rejectClientMarketId,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const payload = await operations.buildOperations();
      res.json(payload);
    } catch (err) {
      log.error({ err }, '[admin-dashboard-market] operations global error');
      next(err);
    }
  }
);

module.exports = router;
module.exports._test = {
  rejectClientMarketId,
  resolveRequestedMarket,
  parseFilters,
  requireDashboardMarketRead,
};
