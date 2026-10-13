/**
 * @komerce-arch
 * @role          canonical-order-360-route
 * @domain        admin-dashboard
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_admin, order_reference
 * @outputs       authorized_order_360_projection, purchasing_projection_only_when_admin_guard_matches
 * @depends       middleware/auth, middleware/require-market-delegated-role, middleware/require-market-delegated-capability, middleware/require-dashboard-global-authority, services/order-360, services/golden-upstream-evidence
 * @used-by       bootstrap/api-routes.js
 * @db-read       orders, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling, dashboard_global_access_grants
 * @db-write      none
 * @db-txn        none
 * @doctrine      entity_360_reunites_without_recomputing, capability_is_the_authority_not_role, fail_closed_unresolved_market
 * @impact-areas  admin-dashboard, orders, purchasing, market-authorization
 * @version       2026-10-d6
 */

'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { attachMarketDelegatedRoleFor } = require('../middleware/require-market-delegated-role');
const { attachAuthorizedMarketsForCapability } = require('../middleware/require-market-delegated-capability');
const { hasDashboardGlobalAuthority } = require('../middleware/require-dashboard-global-authority');
const order360 = require('../services/order-360');
const { projectGoldenEvidence } = require('../services/golden-e2e-cockpit');
const { projectUpstreamEvidence } = require('../services/golden-upstream-evidence');
const { advanceGoldenJourney } = require('../tests/helpers/goldenJourney');
const { createGoldenJourney } = require('../tests/helpers/goldenJourneySetup');
const db = require('../db');
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
      // Parité stricte avec routes/purchasing.js : le drill Achats n'est projeté
      // que pour un acteur déjà admis par le guard requireRole(['admin']).
      const payload = await order360.loadOrder360(req.order360Order, {
        includePurchasing: Boolean(req.user && req.user.role === 'admin'),
      });
      return res.json(payload);
    } catch (err) {
      log.error({ err, orderReference: req.params.orderReference }, '[admin-order-360] read failed');
      return next(err);
    }
  }
);

router.get(
  '/golden-upstream',
  authenticate,
  attachMarketDelegatedRoleFor(['admin']),
  requireRole(['admin']),
  async (req, res, next) => {
    try {
      // Les portes amont lisent Sourcing, Catalogue et la boutique : autorité centrale explicite, fail-closed.
      if (!(await hasDashboardGlobalAuthority(req.user && req.user.id))) {
        return res.status(403).json({
          error: 'Accès refusé — autorité dashboard globale requise pour les preuves amont',
          code: 'golden_upstream_global_authority_required',
        });
      }
      res.set('Cache-Control', 'private, no-store');
      return res.json(await projectUpstreamEvidence(db, {
        productId: req.query.product_id ? String(req.query.product_id) : null,
        marketCode: req.query.market ? String(req.query.market) : null,
        orderReference: req.query.order_reference ? String(req.query.order_reference) : null,
        storefrontBaseUrl: process.env.STOREFRONT_BASE_URL || process.env.PUBLIC_BASE_URL || null,
      }));
    } catch (err) { return next(err); }
  }
);

router.get(
  '/orders/:orderReference/golden-evidence',
  authenticate,
  attachMarketDelegatedRoleFor(['admin']),
  requireRole(['admin']),
  resolveOrderReference,
  attachOrder360Authority,
  requireOrderMarketRead,
  async (req, res, next) => {
    try {
      if (!/^K-GOLDEN-/i.test(req.order360Order.reference || '')) {
        return res.status(400).json({ error:'Commande non Golden', code:'not_golden_order' });
      }
      res.set('Cache-Control', 'private, no-store');
      return res.json(await projectGoldenEvidence(db, req.order360Order));
    } catch (err) { return next(err); }
  }
);


router.post(
  '/orders/:orderReference/golden-advance',
  authenticate,
  attachMarketDelegatedRoleFor(['admin']),
  requireRole(['admin']),
  resolveOrderReference,
  attachOrder360Authority,
  requireOrderMarketRead,
  async (req, res, next) => {
    try {
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error:'Golden advance interdit en production', code:'golden_advance_production_forbidden' });
      }
      if (!/^K-GOLDEN-/i.test(req.order360Order.reference || '')) {
        return res.status(400).json({ error:'Commande non Golden', code:'not_golden_order' });
      }
      res.set('Cache-Control', 'private, no-store');
      return res.json(await advanceGoldenJourney(db, req.order360Order.reference));
    } catch (err) { return next(err); }
  }
);

router.post(
  '/golden-create',
  authenticate,
  attachMarketDelegatedRoleFor(['admin']),
  requireRole(['admin']),
  async (req, res, next) => {
    try {
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error:'Golden create interdit en production', code:'golden_create_production_forbidden' });
      }
      res.set('Cache-Control', 'private, no-store');
      const marketCode = String((req.body && req.body.marketCode) || 'KM').toUpperCase();
      if (!['KM','CM','CG'].includes(marketCode)) {
        return res.status(400).json({ error:'Market Golden non supporté', code:'golden_market_unsupported' });
      }
      return res.status(201).json(await createGoldenJourney(db, { marketCode }));
    } catch (err) { return next(err); }
  }
);

module.exports = router;
module.exports._test = {
  resolveOrderReference,
  attachOrder360Authority,
  requireOrderMarketRead,
};
