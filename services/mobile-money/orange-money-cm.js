/**
 * @komerce-arch
 * @role          mobile-money-provider-adapter
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        authoritative_amount, order_reference, callback_url
 * @outputs       provider_transaction, payment_redirect, normalized_status
 * @depends       Orange Money Web Payment API
 * @used-by       services/payment-mobile-money.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      provider_adapter_no_business_mutation, secrets_env_only, fail_closed
 * @impact-areas  payment, checkout
 * @version       2026-09
 */
'use strict';

const log = require('../../utils/logger').child({ module: 'orange-money-cm' });

const DEFAULT_TOKEN_URL = 'https://api.orange.com/oauth/v3/token';
const SUCCESS = new Set(['SUCCESS', 'SUCCESSFUL', 'PAID', 'COMPLETED']);
const FAILED  = new Set(['FAILED', 'CANCELLED', 'CANCELED', 'EXPIRED', 'REJECTED']);

let tokenCache = null;

function config() {
  return {
    clientId:      String(process.env.ORANGE_MONEY_CM_CLIENT_ID || '').trim(),
    clientSecret:  String(process.env.ORANGE_MONEY_CM_CLIENT_SECRET || '').trim(),
    merchantKey:   String(process.env.ORANGE_MONEY_CM_MERCHANT_KEY || '').trim(),
    tokenUrl:      String(process.env.ORANGE_MONEY_CM_TOKEN_URL || DEFAULT_TOKEN_URL).trim(),
    paymentUrl:    String(process.env.ORANGE_MONEY_CM_PAYMENT_URL || '').trim(),
    statusUrl:     String(process.env.ORANGE_MONEY_CM_STATUS_URL || '').trim(),
  };
}

function isConfigured() {
  const c = config();
  return Boolean(
    c.clientId && c.clientSecret && c.merchantKey &&
    c.tokenUrl && c.paymentUrl && c.statusUrl
  );
}

function publicConfig() {
  return {
    provider: 'orange_money',
    label: 'Orange Money',
    market_code: 'CM',
    requires_msisdn: false,
    configured: isConfigured(),
    flow: 'redirect',
  };
}

function safeJson(value) {
  if (!value || typeof value !== 'object') return {};
  const safe = {};
  for (const key of ['status', 'message', 'payment_url', 'order_id', 'amount', 'currency']) {
    if (value[key] !== undefined && value[key] !== null) safe[key] = value[key];
  }
  return safe;
}

function normalizeStatus(raw) {
  const value = String(
    raw?.status || raw?.payment_status || raw?.transaction_status || raw?.message || ''
  ).trim().toUpperCase();

  if (SUCCESS.has(value)) return 'succeeded';
  if (FAILED.has(value)) return value === 'EXPIRED' ? 'expired' : 'failed';
  return 'pending';
}

async function parseResponse(res) {
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; }
  catch (_) { body = { message: text.slice(0, 500) }; }

  if (!res.ok) {
    const err = new Error(`Orange Money HTTP ${res.status}`);
    err.code = 'orange_money_http_error';
    err.httpStatus = res.status;
    err.safeBody = safeJson(body);
    throw err;
  }
  return body;
}

async function getAccessToken(fetchImpl = global.fetch) {
  const c = config();
  if (!isConfigured()) {
    const err = new Error('Orange Money Cameroun non configuré');
    err.code = 'mobile_money_provider_not_configured';
    throw err;
  }

  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) {
    return tokenCache.value;
  }

  const basic = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64');
  const res = await fetchImpl(c.tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const body = await parseResponse(res);
  if (!body.access_token) {
    const err = new Error('Orange Money: access_token absent');
    err.code = 'orange_money_token_invalid';
    throw err;
  }

  const ttlSeconds = Math.max(60, Number(body.expires_in) || 3600);
  tokenCache = {
    value: body.access_token,
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
  return tokenCache.value;
}

/**
 * Le contrat Web Payment exact (URL/version) est fourni lors de l'onboarding
 * marchand Orange et reste donc configuré par environnement. Le payload est
 * le contrat Web Payment marchand : aucun montant/msisdn venant du frontend.
 */
async function initiate({ orderReference, amount, currency, callbackUrl, returnUrl, cancelUrl, fetchImpl = global.fetch }) {
  const c = config();
  const token = await getAccessToken(fetchImpl);

  const payload = {
    merchant_key: c.merchantKey,
    currency,
    order_id: orderReference,
    amount,
    return_url: returnUrl,
    cancel_url: cancelUrl,
    notif_url: callbackUrl,
    lang: 'fr',
    reference: `Komerce ${orderReference}`,
  };

  const res = await fetchImpl(c.paymentUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await parseResponse(res);

  const externalTransactionId = String(body.pay_token || body.transaction_id || '').trim();
  const paymentUrl = String(body.payment_url || '').trim();
  if (!externalTransactionId || !paymentUrl) {
    const err = new Error('Orange Money: réponse initiation incomplète');
    err.code = 'orange_money_initiation_invalid';
    err.safeBody = safeJson(body);
    throw err;
  }

  log.info({ order_reference: orderReference }, '[ORANGE-MONEY-CM] paiement initié');
  return {
    externalTransactionId,
    status: 'pending',
    providerStatus: String(body.status || body.message || 'PENDING'),
    safePayload: safeJson({ ...body, payment_url: paymentUrl }),
    clientAction: { type: 'redirect', url: paymentUrl },
  };
}

async function getStatus({ externalTransactionId, orderReference, amount, fetchImpl = global.fetch }) {
  const c = config();
  const token = await getAccessToken(fetchImpl);

  const res = await fetchImpl(c.statusUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      order_id: orderReference,
      amount,
      pay_token: externalTransactionId,
    }),
  });
  const body = await parseResponse(res);
  return {
    status: normalizeStatus(body),
    providerStatus: String(body.status || body.payment_status || body.message || 'UNKNOWN'),
    amount: body.amount == null ? null : Number(body.amount),
    currency: body.currency ? String(body.currency).toUpperCase() : null,
    safePayload: safeJson(body),
  };
}

function _resetTokenCacheForTests() {
  tokenCache = null;
}

module.exports = {
  name: 'orange_money',
  marketCode: 'CM',
  label: 'Orange Money',
  requiresMsisdn: false,
  isConfigured,
  publicConfig,
  normalizeStatus,
  initiate,
  getStatus,
  _resetTokenCacheForTests,
};
