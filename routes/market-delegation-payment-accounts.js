/**
 * @komerce-arch
 * @role          market-delegation-payment-accounts-api
 * @domain        market-delegation
 * @layer         route
 * @criticality   high
 * @inputs        authenticated user, canonical market code, optional from/to
 * @outputs       comptes de paiement du marché (lecture seule, sans référence de coffre)
 * @depends       middleware/auth.js, services/market-payment-account-service.js
 * @used-by       bootstrap/api-routes.js, market operator dashboard
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      payment_accounts_read_view_is_a_projection, client_market_id_never_authority
 * @impact-areas  market, delegation, payments, finance
 * @version       2026-10
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { listMarketPaymentAccounts } = require('../services/market-payment-account-service');

function sendKnownError(res, error) {
  if (!error || !error.code || !error.status) return false;
  res.status(error.status).json({ error: error.message, code: error.code });
  return true;
}

// Lecture seule : un opérateur ne modifie rien ici, la configuration des comptes reste centrale.
router.get('/markets/:marketCode/payment-accounts', authenticate, async (req, res, next) => {
  try {
    res.json(await listMarketPaymentAccounts(db, {
      marketCode: req.params.marketCode,
      actorUserId: req.user.id,
    }));
  } catch (error) {
    if (sendKnownError(res, error)) return;
    next(error);
  }
});

module.exports = router;
