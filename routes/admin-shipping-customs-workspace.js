/**
 * @komerce-arch
 * @role          canonical-shipping-customs-workspace-route
 * @domain        admin-dashboard
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_operator, requested_market_code, workspace_action
 * @outputs       authorized_shipping_customs_projection, authorized_domain_mutations
 * @depends       db, middleware/auth, middleware/require-market-scope, middleware/require-dashboard-global-authority, services/shipping-customs-workspace
 * @used-by       bootstrap/api-routes.js
 * @db-read       markets, operator_market_scopes, dashboard_global_access_grants
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_single_market_action_context, server_market_scope_is_authority, client_market_id_forbidden, workspace_role_least_privilege
 * @impact-areas  admin-dashboard, logistics, customs, market-authorization
 * @version       2026-08
 */

'use strict';

const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { attachAuthorizedMarkets, requireMarketScope } = require('../middleware/require-market-scope');
const { hasDashboardGlobalAuthority } = require('../middleware/require-dashboard-global-authority');
const workspace = require('../services/shipping-customs-workspace');
const log = require('../utils/logger').child({ module: 'admin-shipping-customs-workspace' });

const router = express.Router();
const MARKET_CODE = /^[A-Z]{2}$/;
const requireWorkspaceReadRole = requireRole(['admin', 'agent_hub', 'agent_transitaire']);
const requireTransitAction = requireRole(['admin', 'agent_hub', 'agent_transitaire']);
const requireCustomsAction = requireRole(['admin']);

function rejectClientMarketAuthority(req, res, next) {
  const query = req.query || {};
  const body = req.body || {};
  if (
    Object.prototype.hasOwnProperty.call(query, 'market_id') ||
    Object.prototype.hasOwnProperty.call(query, 'marketId') ||
    Object.prototype.hasOwnProperty.call(body, 'market_id') ||
    Object.prototype.hasOwnProperty.call(body, 'marketId')
  ) {
    return res.status(400).json({
      error: 'market_id client interdit — le marché est résolu depuis la route et les grants serveur',
      code: 'client_market_id_forbidden',
    });
  }
  return next();
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
        WHERE code = $1
          AND is_active = TRUE
        LIMIT 1`,
      [code]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Marché introuvable ou inactif', code: 'market_not_found' });
    }
    req.workspaceMarket = rows[0];
    return next();
  } catch (err) {
    return next(err);
  }
}

function requireWorkspaceMarketAccess(req, res, next) {
  const targetMarketId = req.workspaceMarket && req.workspaceMarket.id;
  const marketGuard = requireMarketScope(() => targetMarketId);

  if (req.authorizedMarkets && req.authorizedMarkets.has(targetMarketId)) {
    return marketGuard(req, res, next);
  }

  return hasDashboardGlobalAuthority(req.user && req.user.id)
    .then(globalAllowed => {
      if (globalAllowed) {
        req.workspaceGlobalAuthority = true;
        return next();
      }
      return marketGuard(req, res, next);
    })
    .catch(next);
}

function actionActor(req) {
  return {
    id: req.user && req.user.id,
    role: req.user && req.user.role,
    full_name: req.user && req.user.full_name,
    email: req.user && req.user.email,
  };
}

function sendWorkspaceError(err, res, next) {
  if (err instanceof workspace.ShippingCustomsWorkspaceError) {
    return res.status(err.status || 400).json({ error: err.message, code: err.code });
  }
  if (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message, code: err.code || 'workspace_action_rejected' });
  }
  return next(err);
}

router.use(
  '/market/:marketCode',
  authenticate,
  requireWorkspaceReadRole,
  rejectClientMarketAuthority,
  resolveRequestedMarket,
  attachAuthorizedMarkets,
  requireWorkspaceMarketAccess
);

router.get('/market/:marketCode', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    const payload = await workspace.buildWorkspace({ market: req.workspaceMarket });
    return res.json(payload);
  } catch (err) {
    log.error({ err, market: req.workspaceMarket && req.workspaceMarket.code }, '[shipping-customs-workspace] read failed');
    return sendWorkspaceError(err, res, next);
  }
});

router.post('/market/:marketCode/parcels/:reference/confirm-transit', requireTransitAction, async (req, res, next) => {
  try {
    const result = await workspace.confirmTransit(
      req.params.reference,
      req.workspaceMarket,
      actionActor(req),
      req.body && req.body.notes
    );
    return res.json({ ok: true, action: 'confirm_transit', result });
  } catch (err) {
    return sendWorkspaceError(err, res, next);
  }
});

router.post('/market/:marketCode/customs/shipments', requireCustomsAction, async (req, res, next) => {
  try {
    const result = await workspace.createCustomsShipment(req.body || {}, req.workspaceMarket, actionActor(req));
    return res.status(201).json({ ok: true, action: 'create_customs_shipment', result });
  } catch (err) {
    return sendWorkspaceError(err, res, next);
  }
});

router.post('/market/:marketCode/customs/shipments/:reference/update', requireCustomsAction, async (req, res, next) => {
  try {
    const result = await workspace.updateCustomsShipment(req.params.reference, req.body || {}, req.workspaceMarket);
    return res.json({ ok: true, action: 'update_customs_shipment', result });
  } catch (err) {
    return sendWorkspaceError(err, res, next);
  }
});

router.post('/market/:marketCode/customs/shipments/:reference/declare', requireCustomsAction, async (req, res, next) => {
  try {
    const result = await workspace.declareCustomsShipment(
      req.params.reference,
      req.body || {},
      req.workspaceMarket,
      actionActor(req)
    );
    return res.json({ ok: true, action: 'declare_customs_shipment', result });
  } catch (err) {
    return sendWorkspaceError(err, res, next);
  }
});

router.post('/market/:marketCode/customs/shipments/:reference/deactivate', requireCustomsAction, async (req, res, next) => {
  try {
    const result = await workspace.deactivateCustomsShipment(req.params.reference, req.body || {}, req.workspaceMarket);
    return res.json({ ok: true, action: 'deactivate_customs_shipment', result });
  } catch (err) {
    return sendWorkspaceError(err, res, next);
  }
});

router.post('/market/:marketCode/customs/shipments/:reference/activate', requireCustomsAction, async (req, res, next) => {
  try {
    const result = await workspace.activateCustomsShipment(req.params.reference, req.body || {}, req.workspaceMarket);
    return res.json({ ok: true, action: 'activate_customs_shipment', result });
  } catch (err) {
    return sendWorkspaceError(err, res, next);
  }
});

module.exports = router;
module.exports._test = {
  rejectClientMarketAuthority,
  resolveRequestedMarket,
  requireWorkspaceMarketAccess,
  actionActor,
  sendWorkspaceError,
};
