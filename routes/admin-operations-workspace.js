/**
 * @komerce-arch
 * @role          canonical-operations-workspace-route
 * @domain        admin-dashboard
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_operator, requested_market_code, workspace_action
 * @outputs       authorized_operations_workspace_projection, authorized_domain_mutations
 * @depends       db, middleware/auth, middleware/require-market-execution-capability, middleware/require-market-delegated-capability, middleware/require-dashboard-global-authority, services/operations-workspace
 * @used-by       bootstrap/api-routes.js
 * @db-read       markets, users, relais, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling, dashboard_global_access_grants
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_single_market_action_context, capability_is_market_authority, relay_binding_is_server_authority, client_market_id_forbidden, workspace_role_least_privilege
 * @impact-areas  admin-dashboard, logistics, inventory, orders, payments, market-authorization
 * @version       2026-10-d3
 */

'use strict';

const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { attachMarketExecutionRoleFor } = require('../middleware/require-market-execution-capability');
const { requireMarketDelegatedCapability } = require('../middleware/require-market-delegated-capability');
const { hasDashboardGlobalAuthority } = require('../middleware/require-dashboard-global-authority');
const workspace = require('../services/operations-workspace');
const log = require('../utils/logger').child({ module: 'admin-operations-workspace' });

const router = express.Router();
const MARKET_CODE = /^[A-Z]{2}$/;
// D3 : la capability borne la surface et le Market ID. La lecture est portée
// par operations.read ou par l'autorité dashboard globale explicite ; un
// agent_relais peut lire son propre marché via son rattachement relais serveur.
// users.role n'accorde aucun droit marché : les execution.* projettent ensuite
// un rôle de compatibilité request-local pour les moteurs historiques.
const requireHubWorkspaceAction = requireRole(['admin', 'agent_hub']);
const requireRelayWorkspaceAction = requireRole(['admin', 'agent_relais']);

function attachHubExecutionCapability(capability) {
  return attachMarketExecutionRoleFor({
    capability,
    compatibilityRole: 'agent_hub',
    forceCapability: true,
  });
}

function attachRelayExecutionCapability(capability) {
  return attachMarketExecutionRoleFor({
    capability,
    compatibilityRole: 'agent_relais',
    forceCapability: true,
  });
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
      return res.status(404).json({
        error: 'Marché introuvable ou inactif',
        code: 'market_not_found',
      });
    }
    req.workspaceMarket = rows[0];
    return next();
  } catch (err) {
    return next(err);
  }
}

async function requireRelayMarketBinding(req, res, next) {
  try {
    const actorId = req.user && req.user.id;
    const marketId = req.workspaceMarket && req.workspaceMarket.id;
    const { rows } = await db.query(
      `SELECT u.id AS user_id, r.id AS relais_id, r.market_id
         FROM users u
         JOIN relais r ON r.id = u.relais_id
        WHERE u.id = $1
          AND r.market_id = $2
        LIMIT 1`,
      [actorId, marketId]
    );
    if (!rows.length) {
      return res.status(403).json({
        error: 'Le relais de l’agent ne correspond pas au marché sélectionné.',
        code: 'relay_actor_market_mismatch',
      });
    }
    req.relayMarketAuthority = rows[0];
    return next();
  } catch (err) {
    return next(err);
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
      return requireMarketDelegatedCapability('operations.read', { audit: false })(req, res, next);
    })
    .catch(next);
}

function requireRelayPhysicalMarket(req, res, next) {
  const persistedRole = req.user && (req.user.persisted_role || req.user.role);
  if (persistedRole !== 'agent_relais') return next();
  return requireRelayMarketBinding(req, res, next);
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
  if (err instanceof workspace.OperationsWorkspaceError) {
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
  rejectClientMarketAuthority,
  resolveRequestedMarket
);

// Les requireRole restent volontairement visibles dans les chaînes de routes :
// Security360 peut ainsi prouver statiquement la frontière admin/terrain, tandis
// que le middleware execution placé juste avant peut fournir le rôle compatible
// uniquement après preuve de la capability exacte.
router.get(
  '/market/:marketCode',
  requireWorkspaceReadAccess,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const payload = await workspace.buildWorkspace({ market: req.workspaceMarket });
      return res.json(payload);
    } catch (err) {
      log.error({ err, market: req.workspaceMarket && req.workspaceMarket.code }, '[operations-workspace] read failed');
      return sendWorkspaceError(err, res, next);
    }
  }
);

router.post(
  '/market/:marketCode/orders/:reference/mark-ordered',
  attachHubExecutionCapability('execution.order.mark_ordered'),
  requireHubWorkspaceAction,
  async (req, res, next) => {
    try {
      const result = await workspace.markOrdered(
        req.params.reference,
        req.workspaceMarket,
        actionActor(req)
      );
      return res.json({ ok: true, action: 'mark_ordered', result });
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  }
);

router.post(
  '/market/:marketCode/distribution/run',
  attachHubExecutionCapability('execution.distribution.run'),
  requireHubWorkspaceAction,
  async (req, res, next) => {
    try {
      const result = await workspace.runDistribution(req.workspaceMarket);
      return res.json({ ok: true, action: 'run_distribution', result });
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  }
);

router.post(
  '/market/:marketCode/parcels/:reference/ship',
  attachHubExecutionCapability('execution.parcel.ship'),
  requireHubWorkspaceAction,
  async (req, res, next) => {
    try {
      const result = await workspace.scanParcel(
        req.params.reference,
        'ship',
        req.workspaceMarket,
        actionActor(req)
      );
      return res.json({ ok: true, action: 'ship', result });
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  }
);

router.post(
  '/market/:marketCode/orders/:reference/confirm-cash',
  attachRelayExecutionCapability('execution.cash.confirm'),
  requireRelayWorkspaceAction,
  requireRelayPhysicalMarket,
  async (req, res, next) => {
    try {
      const result = await workspace.confirmCash(
        req.params.reference,
        req.workspaceMarket,
        actionActor(req)
      );
      return res.json({ ok: true, action: 'confirm_cash', result });
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  }
);

router.post(
  '/market/:marketCode/parcels/:reference/receive',
  attachRelayExecutionCapability('execution.parcel.receive'),
  requireRelayWorkspaceAction,
  requireRelayPhysicalMarket,
  async (req, res, next) => {
    try {
      const result = await workspace.scanParcel(
        req.params.reference,
        'receive',
        req.workspaceMarket,
        actionActor(req)
      );
      return res.json({ ok: true, action: 'receive', result });
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  }
);

router.post(
  '/market/:marketCode/parcels/:reference/collect',
  attachRelayExecutionCapability('execution.parcel.collect'),
  requireRelayWorkspaceAction,
  requireRelayPhysicalMarket,
  async (req, res, next) => {
    try {
      const result = await workspace.scanParcel(
        req.params.reference,
        'collect',
        req.workspaceMarket,
        actionActor(req)
      );
      return res.json({ ok: true, action: 'collect', result });
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  }
);

router.post(
  '/market/:marketCode/inventory/items/:itemId/assign',
  attachHubExecutionCapability('execution.inventory.assign'),
  requireHubWorkspaceAction,
  async (req, res, next) => {
    try {
      const parcelReference = req.body && req.body.parcel_ref;
      const result = await workspace.assignInventory(
        req.params.itemId,
        parcelReference,
        req.workspaceMarket
      );
      return res.json({ ok: true, action: 'assign_inventory', result });
    } catch (err) {
      return sendWorkspaceError(err, res, next);
    }
  }
);

module.exports = router;
module.exports._test = {
  rejectClientMarketAuthority,
  resolveRequestedMarket,
  requireRelayMarketBinding,
  requireWorkspaceReadAccess,
  requireRelayPhysicalMarket,
  actionActor,
  sendWorkspaceError,
};
