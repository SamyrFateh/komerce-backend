/**
 * @komerce-arch
 * @role          market-operator-admin-provisioning
 * @domain        market
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_admin, user_id, market_code, viewer_or_manager
 * @outputs       market_operator_list, grant_or_revoke_result
 * @depends       db.js, middleware/auth.js, services/market-operator-access-service.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       users, markets, operator_market_scopes
 * @db-write-via:market-operator-access-service operator_market_scopes
 * @db-txn        service-owned
 * @doctrine      central_admin_provisions_country_access, revoke_never_delete
 * @impact-areas  market, admin-authorization, partner-access
 * @version       2026-09
 */
'use strict';

const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const access = require('../services/market-operator-access-service');

const router = express.Router();
const guard = [authenticate, requireRole(['admin'])];

function handleError(error, res, next) {
  if (error && error.status) {
    return res.status(error.status).json({ error: error.message, code: error.code || null });
  }
  return next(error);
}

router.get('/', ...guard, async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json({ operators: await access.listOperators(db) });
  } catch (error) { handleError(error, res, next); }
});

router.put('/:userId/markets/:marketCode', ...guard, async (req, res, next) => {
  try {
    const result = await access.grantScope(db, {
      userId: req.params.userId,
      marketCode: req.params.marketCode,
      role: req.body && req.body.role,
      actorId: req.user.id,
    });
    res.json({ ok: true, action: 'grant_market_operator_scope', result });
  } catch (error) { handleError(error, res, next); }
});

router.delete('/:userId/markets/:marketCode', ...guard, async (req, res, next) => {
  try {
    const result = await access.revokeScope(db, {
      userId: req.params.userId,
      marketCode: req.params.marketCode,
      actorId: req.user.id,
    });
    res.json({ ok: true, action: 'revoke_market_operator_scope', result });
  } catch (error) { handleError(error, res, next); }
});

module.exports = router;
