/**
 * @komerce-arch
 * @role          market-operator-admin-provisioning
 * @domain        market
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_admin, partner_identity, user_id, market_code, viewer_or_manager
 * @outputs       market_operator_list, provision_grant_or_revoke_result
 * @depends       db.js, bcryptjs, middleware/auth.js, services/market-operator-access-service.js
 * @used-by       admin composition root
 * @db-read       users, markets, operator_market_scopes
 * @db-write-via:market-operator-access-service operator_market_scopes
 * @db-write-via:user-mutation-service users
 * @db-txn        service-owned
 * @doctrine      central_admin_provisions_country_access, identity_owner_service, revoke_never_delete
 * @impact-areas  market, auth-identity, admin-authorization, partner-access
 * @version       2026-09
 */
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
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

function validatePassword(password) {
  return typeof password === 'string'
    && password.length >= 8
    && /[A-Z]/.test(password)
    && /[0-9]/.test(password);
}

router.get('/', ...guard, async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json({ operators: await access.listOperators(db) });
  } catch (error) { handleError(error, res, next); }
});

// Création one-shot d'un partenaire pays : identité via auth-identity, puis
// grant Market dans la même transaction métier. Le navigateur fournit un code
// pays public (CM/CG...), jamais un market_id interne.
router.post('/', ...guard, async (req, res, next) => {
  try {
    const {
      full_name,
      email,
      phone = null,
      password,
      market_code,
      role = 'manager',
    } = req.body || {};

    if (!validatePassword(password)) {
      return res.status(400).json({
        error: 'Le mot de passe doit contenir au moins 8 caractères, 1 majuscule et 1 chiffre',
        code: 'WEAK_PASSWORD',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await access.provisionOperator(db, {
      fullName: full_name,
      email,
      phone,
      passwordHash,
      marketCode: market_code,
      role,
      actorId: req.user.id,
    });
    return res.status(201).json({ ok: true, action: 'provision_market_operator', result });
  } catch (error) { return handleError(error, res, next); }
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
