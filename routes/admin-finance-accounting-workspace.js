/**
 * @komerce-arch
 * @role          canonical-finance-accounting-workspace-route
 * @domain        admin-dashboard
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_operator, requested_market_code, accounting_action
 * @outputs       authorized_accounting_projection, authorized_cash_deposit_mutations
 * @depends       db, middleware/auth, middleware/require-market-scope, middleware/require-dashboard-global-authority, services/finance-accounting-workspace
 * @used-by       bootstrap/api-routes.js
 * @db-read       markets, operator_market_scopes, dashboard_global_access_grants
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_single_market_action_context, server_market_scope_is_authority, client_market_id_forbidden, workspace_role_least_privilege
 * @impact-areas  admin-dashboard, payment, accounting, market-authorization
 * @version       2026-08
 */

'use strict';

const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { attachAuthorizedMarkets, requireMarketScope } = require('../middleware/require-market-scope');
const { hasDashboardGlobalAuthority } = require('../middleware/require-dashboard-global-authority');
const workspace = require('../services/finance-accounting-workspace');
const log = require('../utils/logger').child({ module: 'admin-finance-accounting-workspace' });

const router = express.Router();
const MARKET_CODE = /^[A-Z]{2}$/;
const requireWorkspaceReadRole = requireRole(['admin', 'finance', 'agent_relais']);
const requireDepositAction = requireRole(['admin', 'agent_relais']);
const requireVerificationAction = requireRole(['admin']);

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

function rejectClientAgentAuthority(req, res, next) {
  const body = req.body || {};
  if (
    Object.prototype.hasOwnProperty.call(body, 'agent_id') ||
    Object.prototype.hasOwnProperty.call(body, 'agentId')
  ) {
    return res.status(400).json({
      error: 'agent_id client interdit — le déposant est toujours la session authentifiée',
      code: 'client_agent_id_forbidden',
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
  if (err instanceof workspace.FinanceAccountingWorkspaceError) {
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
    const payload = await workspace.buildWorkspace({
      market: req.workspaceMarket,
      from: req.query.from,
      to: req.query.to,
      hours: req.query.hours,
    });
    return res.json(payload);
  } catch (err) {
    log.error({ err, market: req.workspaceMarket && req.workspaceMarket.code }, '[finance-accounting-workspace] read failed');
    return sendWorkspaceError(err, res, next);
  }
});

router.post('/market/:marketCode/deposits', requireDepositAction, rejectClientAgentAuthority, async (req, res, next) => {
  try {
    const result = await workspace.createDeposit(req.body || {}, req.workspaceMarket, actionActor(req));
    return res.status(201).json({ ok: true, action: 'create_cash_deposit', result });
  } catch (err) {
    return sendWorkspaceError(err, res, next);
  }
});

router.post('/market/:marketCode/deposits/:depositRef/verify', requireVerificationAction, async (req, res, next) => {
  try {
    const result = await workspace.verifyDeposit(
      req.params.depositRef,
      req.body || {},
      req.workspaceMarket,
      actionActor(req)
    );
    return res.json({ ok: true, action: 'verify_cash_deposit', result });
  } catch (err) {
    return sendWorkspaceError(err, res, next);
  }
});

router.post('/market/:marketCode/deposits/:depositRef/dispute', requireVerificationAction, async (req, res, next) => {
  try {
    const result = await workspace.disputeDeposit(
      req.params.depositRef,
      req.body || {},
      req.workspaceMarket,
      actionActor(req)
    );
    return res.json({ ok: true, action: 'dispute_cash_deposit', result });
  } catch (err) {
    return sendWorkspaceError(err, res, next);
  }
});

module.exports = router;
module.exports._test = {
  rejectClientMarketAuthority,
  rejectClientAgentAuthority,
  resolveRequestedMarket,
  requireWorkspaceMarketAccess,
  actionActor,
  sendWorkspaceError,
};
