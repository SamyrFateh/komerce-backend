/**
 * @komerce-arch
 * @role          agent-action-center-routes
 * @domain        decision-signals
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_agent_user, limit, offset
 * @outputs       agent_scoped_action_center_projection
 * @depends       middleware/auth.js, services/action-center-agent-scope.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       signals, orders, parcels
 * @db-write      none
 * @db-txn        none
 * @doctrine      server_side_scope_is_authority, role_alone_is_not_enough, signal_ref_only, read_only_projection
 * @impact-areas  decision-signals, admin-dashboard, relay-network
 * @version       2026-10
 */

'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const scopeService = require('../services/action-center-agent-scope');

const router = express.Router();

// Le navigateur n'impose jamais le périmètre : rôle, propriétaire et relais viennent de la session serveur.
const FORBIDDEN_KEYS = new Set([
  'market_id', 'marketId', 'market_code', 'marketCode', 'relais_id', 'relaisId', 'relay_id',
  'owner_role', 'ownerRole', 'role', 'user_id', 'userId',
]);

function rejectBrowserAuthority(req, res, next) {
  const keys = Object.keys(req.query || {});
  if (keys.some(key => FORBIDDEN_KEYS.has(key))) {
    return res.status(400).json({ error: 'Le périmètre est résolu côté serveur', code: 'agent_action_center_browser_authority_rejected' });
  }
  return next();
}

router.get(
  '/',
  authenticate,
  requireRole(['agent_hub', 'agent_relais', 'agent_transitaire']),
  rejectBrowserAuthority,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json(await scopeService.listForAgent(req.user, req.query || {}));
    } catch (error) {
      if (error && error.status) return res.status(error.status).json({ error: error.message, code: error.code });
      return next(error);
    }
  }
);

module.exports = router;
