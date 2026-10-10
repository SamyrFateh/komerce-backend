/**
 * @komerce-arch
 * @role          admin-market-payment-accounts-api
 * @domain        payment
 * @layer         route
 * @criticality   high
 * @inputs        central admin actor, canonical market code or account id in path
 * @outputs       payment accounts per market (central view), creation and status transitions
 * @depends       db.js, middleware/auth.js, services/market-payment-account-service.js
 * @used-by       bootstrap/api-routes.js, central admin workspace
 * @db-read       none
 * @db-write      none
 * @db-write-via:market-payment-account-service market_payment_accounts
 * @db-txn        explicit for mutation routes
 * @doctrine      payment_account_is_provider_agnostic, no_secret_stored_only_vault_reference, central_by_role_declared
 * @impact-areas  payments, market-delegation, finance
 * @version       2026-10
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const accounts = require('../services/market-payment-account-service');

const centralAdmin = [authenticate, requireRole(['admin'])];

async function withTransaction(work) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* preserve original */ }
    throw error;
  } finally {
    client.release();
  }
}

function sendKnownError(res, error) {
  if (!error || !error.code || !error.status) return false;
  res.status(error.status).json({ error: error.message, code: error.code });
  return true;
}

const correlation = req => (req.headers['x-correlation-id'] ? String(req.headers['x-correlation-id']).slice(0, 200) : null);

router.get('/markets/:marketCode', ...centralAdmin, async (req, res, next) => {
  try {
    res.json(await accounts.listPaymentAccounts(db, { marketCode: req.params.marketCode }));
  } catch (error) {
    if (!sendKnownError(res, error)) next(error);
  }
});

router.post('/markets/:marketCode', ...centralAdmin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const result = await withTransaction(client => accounts.createPaymentAccount(client, {
      actorUserId: req.user.id,
      marketCode: req.params.marketCode,
      provider: body.provider,
      adapter: body.adapter,
      currency: body.currency,
      accountHolder: body.account_holder,
      legalSeller: body.legal_seller,
      marketOperatorEntity: body.market_operator_entity,
      refundBearer: body.refund_bearer,
      externalAccountId: body.external_account_id,
      credentialsRef: body.credentials_ref,
      legalBasisRef: body.legal_basis_ref,
      correlationId: correlation(req),
    }));
    res.status(201).json(result);
  } catch (error) {
    if (!sendKnownError(res, error)) next(error);
  }
});

router.post('/:accountId/verify', ...centralAdmin, async (req, res, next) => {
  try {
    res.json(await withTransaction(client => accounts.verifyPaymentAccount(client, {
      actorUserId: req.user.id,
      accountId: req.params.accountId,
      verificationRef: req.body && req.body.verification_ref,
      correlationId: correlation(req),
    })));
  } catch (error) {
    if (!sendKnownError(res, error)) next(error);
  }
});

router.post('/:accountId/status', ...centralAdmin, async (req, res, next) => {
  try {
    res.json(await withTransaction(client => accounts.setPaymentAccountStatus(client, {
      actorUserId: req.user.id,
      accountId: req.params.accountId,
      targetStatus: req.body && req.body.status,
      correlationId: correlation(req),
    })));
  } catch (error) {
    if (!sendKnownError(res, error)) next(error);
  }
});

module.exports = router;
