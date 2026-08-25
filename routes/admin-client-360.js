/**
 * @komerce-arch
 * @role          canonical-client-360-route
 * @domain        admin-dashboard
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_admin, client_phone
 * @outputs       authorized_client_360_projection
 * @depends       middleware/auth, middleware/require-market-scope, middleware/require-dashboard-global-authority, services/client-360
 * @used-by       bootstrap/api-routes.js
 * @db-read       orders, operator_market_scopes, dashboard_global_access_grants
 * @db-write      none
 * @db-txn        none
 * @doctrine      entity_360_reunites_without_recomputing, server_market_scope_is_authority, client_security_global_only
 * @impact-areas  admin-dashboard, clients, market-authorization, auth-passkey
 * @version       2026-08
 */

'use strict';

const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { attachAuthorizedMarkets } = require('../middleware/require-market-scope');
const { hasDashboardGlobalAuthority } = require('../middleware/require-dashboard-global-authority');
const client360 = require('../services/client-360');
const log = require('../utils/logger').child({ module: 'admin-client-360' });

const router = express.Router();

async function resolveClientAccess(req, res, next) {
  try {
    const phone = client360.normalizePhone(req.params.clientPhone);
    if (!phone) {
      return res.status(400).json({
        error: 'Téléphone client invalide',
        code: 'invalid_client_phone',
      });
    }

    const globalAllowed = await hasDashboardGlobalAuthority(req.user && req.user.id);
    const marketIds = globalAllowed
      ? null
      : Array.from(req.authorizedMarkets || []);

    if (!globalAllowed && marketIds.length === 0) {
      return res.status(403).json({
        error: 'Accès refusé — aucun marché autorisé',
        code: 'client_market_scope_required',
      });
    }

    const resolved = await client360.resolveClient(phone, { marketIds });
    if (!resolved.client) {
      return res.status(404).json({
        error: 'Client introuvable dans le périmètre autorisé',
        code: 'client_not_found',
      });
    }

    req.client360Client = resolved.client;
    req.client360Access = Object.freeze({
      mode: globalAllowed ? 'global' : 'market',
      marketIds,
      includeSecurity: globalAllowed,
    });
    return next();
  } catch (err) {
    return next(err);
  }
}

router.get(
  '/clients/:clientPhone',
  authenticate,
  requireAdmin,
  attachAuthorizedMarkets,
  resolveClientAccess,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const payload = await client360.loadClient360(req.client360Client, {
        marketIds: req.client360Access.marketIds,
        includeSecurity: req.client360Access.includeSecurity,
      });
      return res.json(payload);
    } catch (err) {
      log.error({ err, clientPhone: req.params.clientPhone }, '[admin-client-360] read failed');
      return next(err);
    }
  }
);

module.exports = router;
module.exports._test = { resolveClientAccess };
