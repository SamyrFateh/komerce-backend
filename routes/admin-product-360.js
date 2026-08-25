/**
 * @komerce-arch
 * @role          canonical-product-360-route
 * @domain        admin-dashboard
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_admin, product_ref
 * @outputs       authorized_product_360_projection
 * @depends       middleware/auth, middleware/require-market-scope, middleware/require-dashboard-global-authority, services/product-360
 * @used-by       bootstrap/api-routes.js
 * @db-read       operator_market_scopes, dashboard_global_access_grants, products
 * @db-write      none
 * @db-txn        none
 * @doctrine      entity_360_reunites_without_recomputing, server_market_scope_is_authority, product_ref_is_business_identity
 * @impact-areas  admin-dashboard, catalog, commerce, sourcing, economic-engine, market-authorization
 * @version       2026-08
 */

'use strict';

const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { attachAuthorizedMarkets } = require('../middleware/require-market-scope');
const { hasDashboardGlobalAuthority } = require('../middleware/require-dashboard-global-authority');
const product360 = require('../services/product-360');
const log = require('../utils/logger').child({ module: 'admin-product-360' });

const router = express.Router();

async function resolveProductAccess(req, res, next) {
  try {
    const productRef = product360.normalizeProductRef(req.params.productRef);
    if (!productRef) {
      return res.status(400).json({
        error: 'Référence produit invalide',
        code: 'invalid_product_ref',
      });
    }

    const globalAllowed = await hasDashboardGlobalAuthority(req.user && req.user.id);
    const marketIds = globalAllowed ? null : Array.from(req.authorizedMarkets || []);

    if (!globalAllowed && marketIds.length === 0) {
      return res.status(403).json({
        error: 'Accès refusé — aucun marché autorisé',
        code: 'product_market_scope_required',
      });
    }

    const resolved = await product360.resolveProduct(productRef);
    if (!resolved.product) {
      return res.status(404).json({
        error: 'Produit introuvable',
        code: 'product_not_found',
      });
    }

    req.product360Product = resolved.product;
    req.product360Access = Object.freeze({
      mode: globalAllowed ? 'global' : 'market',
      marketIds,
      includeCentral: globalAllowed,
    });
    return next();
  } catch (err) {
    return next(err);
  }
}

router.get(
  '/products/:productRef',
  authenticate,
  requireAdmin,
  attachAuthorizedMarkets,
  resolveProductAccess,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const payload = await product360.loadProduct360(req.product360Product, {
        marketIds: req.product360Access.marketIds,
        includeCentral: req.product360Access.includeCentral,
      });
      return res.json(payload);
    } catch (err) {
      log.error({ err, productRef: req.params.productRef }, '[admin-product-360] read failed');
      return next(err);
    }
  }
);

module.exports = router;
module.exports._test = { resolveProductAccess };
