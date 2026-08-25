/**
 * @komerce-arch
 * @role          canonical-order-360-route
 * @domain        admin-dashboard
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_admin, order_reference
 * @outputs       authorized_order_360_projection
 * @depends       middleware/auth, middleware/require-market-scope, middleware/require-dashboard-global-authority, services/order-360
 * @used-by       bootstrap/api-routes.js
 * @db-read       orders, operator_market_scopes, dashboard_global_access_grants
 * @db-write      none
 * @db-txn        none
 * @doctrine      entity_360_reunites_without_recomputing, server_market_scope_is_authority, fail_closed_unresolved_market
 * @impact-areas  admin-dashboard, orders, market-authorization
 * @version       2026-08
 */

'use strict';

const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { attachAuthorizedMarkets, requireMarketScope } = require('../middleware/require-market-scope');
const { hasDashboardGlobalAuthority } = require('../middleware/require-dashboard-global-authority');
const order360 = require('../services/order-360');
const log = require('../utils/logger').child({ module: 'admin-order-360' });

const router = express.Router();

async function resolveOrderReference(req, res, next) {
  try {
    const resolved = await order360.resolveOrder(req.params.orderReference);
    if (resolved.invalid) {
      return res.status(400).json({ error: 'Référence commande invalide', code: 'invalid_order_reference' });
    }
    if (!resolved.order) {
      return res.status(404).json({ error: 'Commande introuvable', code: 'order_not_found' });
    }
    req.order360Order = resolved.order;
    return next();
  } catch (err) {
    return next(err);
  }
}

function requireOrderMarketRead(req, res, next) {
  const targetMarketId = req.order360Order && req.order360Order.market_id;

  if (targetMarketId && req.authorizedMarkets && req.authorizedMarkets.has(targetMarketId)) {
    return requireMarketScope(() => targetMarketId)(req, res, next);
  }

  return hasDashboardGlobalAuthority(req.user && req.user.id)
    .then(globalAllowed => {
      if (globalAllowed) {
        req.dashboardGlobalAuthority = true;
        return next();
      }
      if (!targetMarketId) {
        return res.status(403).json({
          error: 'Accès refusé — marché de la commande non résolu',
          code: 'order_market_unresolved',
        });
      }
      return requireMarketScope(() => targetMarketId)(req, res, next);
    })
    .catch(next);
}

router.get(
  '/orders/:orderReference',
  authenticate,
  requireAdmin,
  resolveOrderReference,
  attachAuthorizedMarkets,
  requireOrderMarketRead,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const payload = await order360.loadOrder360(req.order360Order);
      return res.json(payload);
    } catch (err) {
      log.error({ err, orderReference: req.params.orderReference }, '[admin-order-360] read failed');
      return next(err);
    }
  }
);

module.exports = router;
module.exports._test = {
  resolveOrderReference,
  requireOrderMarketRead,
};
