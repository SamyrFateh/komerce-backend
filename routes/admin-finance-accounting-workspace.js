/**
 * @komerce-arch
 * @role          canonical-finance-accounting-workspace-route
 * @domain        admin-dashboard
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_operator, requested_market_code, accounting_action
 * @outputs       authorized_accounting_projection, authorized_cash_deposit_mutations
 * @depends       db, middleware/auth, middleware/require-market-delegated-capability, middleware/require-dashboard-global-authority, services/finance-accounting-workspace, services/financial-journal-reporting
 * @used-by       bootstrap/api-routes.js
 * @db-read       markets, users, relais, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling, dashboard_global_access_grants
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_single_market_action_context, capability_is_the_authority_not_role, relay_binding_is_server_authority, client_market_id_forbidden, workspace_role_least_privilege
 * @impact-areas  admin-dashboard, payment, accounting, market-authorization
 * @version       2026-10-d2
 */

'use strict';

const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { hasDashboardGlobalAuthority } = require('../middleware/require-dashboard-global-authority');
const { requireMarketDelegatedCapability } = require('../middleware/require-market-delegated-capability');
const workspace = require('../services/finance-accounting-workspace');
const log = require('../utils/logger').child({ module: 'admin-finance-accounting-workspace' });

const router = express.Router();
const MARKET_CODE = /^[A-Z]{2}$/;
// Responsable pays : lecture Finance de son seul Market ID.
// Dépôt terrain et validation comptable restent des gestes séparés et spécialisés.
const requireWorkspaceReadRole = requireRole(['admin', 'finance', 'agent_relais', 'market_operator']);
const requireDepositAction = requireRole(['admin', 'agent_relais', 'finance', 'market_operator']);
const requireCustodyAction = requireRole(['admin', 'agent_relais', 'finance', 'market_operator']);
// Le rôle ne suffit jamais : finance.act sur le marché exact (requireFinanceAct) reste l'autorité.
const requireVerificationAction = requireRole(['admin', 'market_operator']);

// D2 Market Control Plane : operator_market_scopes n'est plus une autorité
// Finance / Comptabilité. Lecture : finance.read, sauf autorité dashboard
// globale explicite. agent_relais est borné par son relais serveur ; users.role
// ne choisit jamais le marché. Les mutations comptables de validation/contestation
// exigent finance.act, même pour admin.
const requireFinanceRead = requireMarketDelegatedCapability('finance.read', { audit: false });
const requireFinanceAct = requireMarketDelegatedCapability('finance.act');
// Garde : recevoir, refuser et déclarer une remise de garde exigent l'habilitation du Market
// (le relais est borné par son rattachement serveur) ; le contrôle final exige finance.act.
const requireCustodyReceive = requireMarketDelegatedCapability('cash.custody.receive');

async function requireRelayMarketBinding(req, res, next) {
  try {
    const binding = await workspace.resolveActorRelaisInMarket(
      req.user && req.user.id,
      req.workspaceMarket && req.workspaceMarket.id
    );
    req.relayMarketAuthority = binding;
    return next();
  } catch (err) {
    return sendWorkspaceError(err, res, next);
  }
}

function requireWorkspaceReadAccess(req, res, next) {
  if (req.user && req.user.role === 'agent_relais') {
    return requireRelayMarketBinding(req, res, next);
  }
  return hasDashboardGlobalAuthority(req.user && req.user.id)
    .then(globalAllowed => {
      if (globalAllowed) {
        req.workspaceGlobalAuthority = true;
        return next();
      }
      return requireFinanceRead(req, res, next);
    })
    .catch(next);
}

// Le journal financier (coûts, paiements fournisseurs, rapprochements) n'est jamais exposé à un agent relais :
// son périmètre est le cash de son relais, servi par le workspace « Cash & dépôts ».
function requireJournalReadAccess(req, res, next) {
  if (req.user && req.user.role === 'agent_relais') {
    return res.status(403).json({ error: 'Le journal financier n’est pas accessible à ce rôle.' });
  }
  return requireWorkspaceReadAccess(req, res, next);
}

function requireDepositMarketAccess(req, res, next) {
  if (req.user && req.user.role === 'agent_relais') {
    return requireRelayMarketBinding(req, res, next);
  }
  return requireCustodyReceive(req, res, next);
}

// Décision centrale (pertes, contre-écritures) : rôle admin ET autorité dashboard globale ;
// jamais une délégation de Market.
async function requireCentralAuthority(req, res, next) {
  try {
    if (!req.user || req.user.role !== 'admin' || !(await hasDashboardGlobalAuthority(req.user.id))) {
      return res.status(403).json({ error: 'Décision centrale requise', code: 'central_authority_required' });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

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
  resolveRequestedMarket
);

router.get('/market/:marketCode', requireWorkspaceReadAccess, async (req, res, next) => {
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

// Journal financier (Lot 5) : mêmes gardes de lecture que le workspace ; toujours borné au marché résolu côté serveur.
function journalScope(req) {
  return { marketId: req.workspaceMarket.id, from: req.query.from, to: req.query.to };
}

router.get('/market/:marketCode/journal/:view(summary|movements|documents|reconciliation)', requireJournalReadAccess, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    const scope = journalScope(req);
    const db = require('../db');
    const reporting = require('../services/financial-journal-reporting');
    if (req.params.view === 'summary') return res.json(await reporting.projection(db, scope));
    if (req.params.view === 'movements') {
      return res.json(await reporting.listMovements(db, { ...scope, state: req.query.state, direction: req.query.direction, limit: req.query.limit, offset: req.query.offset }));
    }
    if (req.params.view === 'documents') return res.json(await reporting.listDocuments(db, scope));
    return res.json(await reporting.reconcileWithSources(db, { marketId: scope.marketId }));
  } catch (err) {
    log.error({ err, market: req.workspaceMarket && req.workspaceMarket.code }, '[finance-accounting-workspace] journal read failed');
    return sendWorkspaceError(err, res, next);
  }
});

router.post('/market/:marketCode/deposits', requireDepositAction, rejectClientAgentAuthority, requireDepositMarketAccess, async (req, res, next) => {
  try {
    const result = await workspace.createDeposit(req.body || {}, req.workspaceMarket, actionActor(req));
    return res.status(201).json({ ok: true, action: 'create_cash_deposit', result });
  } catch (err) {
    return sendWorkspaceError(err, res, next);
  }
});

router.post('/market/:marketCode/deposits/:depositRef/verify', requireVerificationAction, requireFinanceAct, async (req, res, next) => {
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

router.post('/market/:marketCode/deposits/:depositRef/dispute', requireVerificationAction, requireFinanceAct, async (req, res, next) => {
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

function custodyHandler(action, run) {
  return async (req, res, next) => {
    try {
      const result = await run(req);
      return res.status(201).json({ ok: true, action, result });
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  };
}

router.post('/market/:marketCode/custody/:depositRef/receipt', requireCustodyAction, requireCustodyReceive, custodyHandler('record_custody_receipt',
  req => workspace.receiveTransfer(req.params.depositRef, req.body || {}, req.workspaceMarket, actionActor(req))));

router.post('/market/:marketCode/custody/:depositRef/control', requireVerificationAction, requireFinanceAct, custodyHandler('control_final_reception',
  req => workspace.controlFinal(req.params.depositRef, req.body || {}, req.workspaceMarket, actionActor(req))));

router.post('/market/:marketCode/custody/:depositRef/reversal', requireCentralAuthority, custodyHandler('reverse_custody_receipt',
  req => workspace.reverseReceipt(req.params.depositRef, req.body || {}, req.workspaceMarket, actionActor(req))));

router.post('/market/:marketCode/custody/losses', requireCentralAuthority, custodyHandler('decide_custody_loss',
  req => workspace.decideLoss(req.body || {}, req.workspaceMarket, actionActor(req))));

router.post('/market/:marketCode/custody/losses/:lossId/reversal', requireCentralAuthority, custodyHandler('reverse_custody_loss',
  req => workspace.reverseLoss(req.params.lossId, req.body || {}, req.workspaceMarket, actionActor(req))));

module.exports = router;
module.exports._test = {
  rejectClientMarketAuthority,
  rejectClientAgentAuthority,
  resolveRequestedMarket,
  requireRelayMarketBinding,
  requireWorkspaceReadAccess,
  requireDepositMarketAccess,
  requireCentralAuthority,
  actionActor,
  sendWorkspaceError,
};
