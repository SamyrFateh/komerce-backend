/**
 * @komerce-arch
 * @role          canonical-order-360-route
 * @domain        admin-dashboard
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_admin, order_reference
 * @outputs       authorized_order_360_projection
 * @depends       middleware/auth, middleware/require-market-delegated-role, middleware/require-market-delegated-capability, middleware/require-dashboard-global-authority, services/order-360
 * @used-by       bootstrap/api-routes.js
 * @db-read       orders, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling, dashboard_global_access_grants
 * @db-write      none
 * @db-txn        none
 * @doctrine      entity_360_reunites_without_recomputing, capability_is_the_authority_not_role, fail_closed_unresolved_market
 * @impact-areas  admin-dashboard, orders, market-authorization
 * @version       2026-10-d6
 */

'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { attachMarketDelegatedRoleFor } = require('../middleware/require-market-delegated-role');
const { attachAuthorizedMarketsForCapability } = require('../middleware/require-market-delegated-capability');
const { hasDashboardGlobalAuthority } = require('../middleware/require-dashboard-global-authority');
const order360 = require('../services/order-360');
const log = require('../utils/logger').child({ module: 'admin-order-360' });

const router = express.Router();
const attachOperationsReadMarkets = attachAuthorizedMarketsForCapability('operations.read', { audit: false });

async function attachOrder360Authority(req, res, next) {
  try {
    const globalAllowed = await hasDashboardGlobalAuthority(req.user && req.user.id);
    if (globalAllowed) {
      req.dashboardGlobalAuthority = true;
      return next();
    }
    return attachOperationsReadMarkets(req, res, next);
  } catch (err) {
    return next(err);
  }
}


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
  if (req.dashboardGlobalAuthority === true) return next();
  if (!targetMarketId) {
    return res.status(403).json({
      error: 'Accès refusé — marché de la commande non résolu',
      code: 'order_market_unresolved',
    });
  }
  if (!req.authorizedMarkets || !req.authorizedMarkets.has(targetMarketId)) {
    return res.status(403).json({
      error: 'Accès refusé — capability operations.read requise sur le marché de la commande',
      code: 'MARKET_CAPABILITY_REQUIRED',
    });
  }
  return next();
}

router.get(
  '/orders/:orderReference',
  authenticate,
  attachMarketDelegatedRoleFor(['admin', 'market_operator']),
  requireRole(['admin', 'market_operator']),
  resolveOrderReference,
  attachOrder360Authority,
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
  attachOrder360Authority,
  requireOrderMarketRead,
};
