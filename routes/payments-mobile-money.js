/**
 * @komerce-arch
 * @role          route-payment-mobile-money
 * @domain        payment
 * @layer         route
 * @criticality   critical
 * @inputs        market_code, order_reference, msisdn, provider_callback
 * @outputs       availability, mobile_money_transaction
 * @depends       db.js, middleware/auth-guest.js, services/payment-mobile-money.js
 * @used-by       bootstrap/api-routes.js, boutique checkout, providers
 * @db-read       orders, markets, mobile_money_transactions
 * @db-write      none
 * @db-txn        delegated_to_payment_mobile_money
 * @doctrine      route_auth_ownership_facade, callback_reconciles_server_to_server
 * @impact-areas  payment, checkout
 * @version       2026-09
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const log = require('../utils/logger').child({ module: 'payments-mobile-money' });
const { authenticateOrCreateGuest } = require('../middleware/auth-guest');
const {
  MobileMoneyError,
  getAvailability,
  loadOrderForPayment,
  initiateMobileMoney,
  reconcileMobileMoneyTransaction,
  getTransaction,
} = require('../services/payment-mobile-money');

const MARKET_CODE_RE = /^[A-Z]{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDERS = new Set(['orange_money', 'mtn_momo']);
const PRIVILEGED_ROLES = new Set(['admin', 'agent_hub', 'agent_relais']);

function handleError(res, next, err) {
  if (err instanceof MobileMoneyError || err?.name === 'MobileMoneyError') {
    return res.status(err.statusCode || 400).json({
      error: err.message,
      code: err.code,
      details: err.details || undefined,
    });
  }
  return next(err);
}

function ownsOrder(user, order) {
  if (!user || !order) return false;
  if (PRIVILEGED_ROLES.has(user.role)) return true;
  return String(order.user_id || '') === String(user.id || '');
}

router.get('/availability', async (req, res, next) => {
  const marketCode = String(req.query.market_code || '').trim().toUpperCase();
  if (!MARKET_CODE_RE.test(marketCode)) {
    return res.status(400).json({ error: 'market_code invalide', code: 'invalid_market_code' });
  }
  try {
    return res.json(await getAvailability(marketCode));
  } catch (err) { return handleError(res, next, err); }
});

router.post('/initiate', authenticateOrCreateGuest, async (req, res, next) => {
  const orderReference = String(req.body?.order_reference || '').trim();
  const msisdn = req.body?.msisdn == null ? null : String(req.body.msisdn).trim();
  if (!orderReference || orderReference.length > 80) {
    return res.status(400).json({ error: 'order_reference requis', code: 'order_reference_required' });
  }
  if (msisdn && !/^\+?[0-9\s().-]{6,24}$/.test(msisdn)) {
    return res.status(400).json({ error: 'Numéro Mobile Money invalide', code: 'invalid_msisdn' });
  }

  try {
    const order = await loadOrderForPayment(orderReference);
    if (!order) return res.status(404).json({ error: 'Commande introuvable', code: 'order_not_found' });
    if (!ownsOrder(req.user, order)) {
      return res.status(403).json({ error: 'Accès refusé à cette commande', code: 'order_forbidden' });
    }
    const result = await initiateMobileMoney({ orderReference, msisdn });
    return res.status(result.reused ? 200 : 201).json(result);
  } catch (err) { return handleError(res, next, err); }
});

router.post('/transactions/:transactionId/refresh', authenticateOrCreateGuest, async (req, res, next) => {
  const { transactionId } = req.params;
  if (!UUID_RE.test(transactionId || '')) {
    return res.status(400).json({ error: 'transactionId invalide', code: 'invalid_transaction_id' });
  }
  try {
    const current = await getTransaction(transactionId);
    if (!ownsOrder(req.user, current.raw)) {
      return res.status(403).json({ error: 'Accès refusé', code: 'transaction_forbidden' });
    }
    return res.json(await reconcileMobileMoneyTransaction(transactionId));
  } catch (err) { return handleError(res, next, err); }
});

router.get('/transactions/:transactionId', authenticateOrCreateGuest, async (req, res, next) => {
  const { transactionId } = req.params;
  if (!UUID_RE.test(transactionId || '')) {
    return res.status(400).json({ error: 'transactionId invalide', code: 'invalid_transaction_id' });
  }
  try {
    const current = await getTransaction(transactionId);
    if (!ownsOrder(req.user, current.raw)) {
      return res.status(403).json({ error: 'Accès refusé', code: 'transaction_forbidden' });
    }
    return res.json({ transaction: current.public });
  } catch (err) { return handleError(res, next, err); }
});

// Callback opérateur volontairement sans auth utilisateur : le body n'est
// jamais une preuve, le statut est relu directement auprès du provider.
router.post('/callback/:provider/:transactionId', async (req, res) => {
  const provider = String(req.params.provider || '').trim();
  const transactionId = String(req.params.transactionId || '').trim();
  if (!PROVIDERS.has(provider) || !UUID_RE.test(transactionId)) {
    return res.status(400).json({ received: false });
  }

  try {
    const result = await reconcileMobileMoneyTransaction(transactionId, { expectedProvider: provider });
    return res.json({ received: true, status: result.transaction?.status || 'unknown' });
  } catch (err) {
    log.error({ err, provider, transaction_id: transactionId }, '[MOBILE-MONEY] callback reconciliation failed');
    const status = err instanceof MobileMoneyError ? (err.statusCode || 500) : 500;
    return res.status(status >= 500 ? 500 : status).json({ received: false, code: err.code || 'reconciliation_failed' });
  }
});

router.get('/admin/pending', authenticateOrCreateGuest, async (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin uniquement' });
  try {
    const { rows } = await db.query(
      `SELECT t.id, o.reference AS order_reference, m.code AS market_code,
              t.provider, t.status, t.provider_status, t.currency,
              t.amount_minor, t.minor_unit, t.created_at, t.updated_at
         FROM mobile_money_transactions t
         JOIN orders o ON o.id=t.order_id
         JOIN markets m ON m.id=t.market_id
        WHERE t.status IN ('initiated','pending')
        ORDER BY t.created_at ASC
        LIMIT 100`
    );
    return res.json({ transactions: rows });
  } catch (err) { return next(err); }
});

module.exports = router;