/**
 * @komerce-arch
 * @role          mobile-money-provider-adapter
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        authoritative_amount, order_reference, return_urls, provider_webhook
 * @outputs       provider_transaction, payment_redirect, normalized_status, webhook_verification
 * @depends       KartaPay REST API
 * @used-by       services/payment-mobile-money.js, routes/payments-mobile-money.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      provider_adapter_no_business_mutation, secrets_env_only, fail_closed,
 *                webhook_signature_required, provider_status_rechecked_server_to_server
 * @impact-areas  payment, checkout
 * @version       2026-09
 */
'use strict';

const crypto = require('crypto');
const log = require('../../utils/logger').child({ module: 'kartapay-km' });

const STAGING_API_BASE = 'https://api-staging.kartapay.me';
const PROD_API_BASE = 'https://api.kartapay.me';
const STAGING_TOKEN_URL = 'https://auth.kartapay.me/staging/token';
const PROD_TOKEN_URL = 'https://auth.kartapay.me/prod/token';

const SUCCESS = new Set(['COMPLETED', 'CAPTURED', 'SUCCESS', 'SUCCESSFUL', 'PAID']);
const EXPIRED = new Set(['EXPIRED']);
const FAILED = new Set(['FAILED', 'CANCELLED', 'CANCELED', 'DECLINED', 'REJECTED']);

let tokenCache = null;

function runtimeEnvironment() {
  return String(process.env.KOMERCE_ENV || process.env.NODE_ENV || '').trim().toLowerCase();
}

function config() {
  const environment = String(process.env.KARTAPAY_ENV || '').trim().toLowerCase();
  const isProd = environment === 'production' || environment === 'prod';
  const isStaging = environment === 'staging';

  return {
    environment,
    clientId: String(process.env.KARTAPAY_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.KARTAPAY_CLIENT_SECRET || '').trim(),
    merchantId: String(process.env.KARTAPAY_MERCHANT_ID || '').trim(),
    webhookSecret: String(process.env.KARTAPAY_WEBHOOK_SECRET || '').trim(),
    apiBaseUrl: String(
      process.env.KARTAPAY_API_BASE_URL || (isProd ? PROD_API_BASE : isStaging ? STAGING_API_BASE : '')
    ).trim().replace(/\/+$/, ''),
    tokenUrl: String(
      process.env.KARTAPAY_TOKEN_URL || (isProd ? PROD_TOKEN_URL : isStaging ? STAGING_TOKEN_URL : '')
    ).trim(),
  };
}

function isConfigured() {
  const c = config();
  if (!['staging', 'production', 'prod'].includes(c.environment)) return false;
  if (!c.clientId || !c.clientSecret || !c.merchantId || !c.webhookSecret || !c.apiBaseUrl || !c.tokenUrl) {
    return false;
  }

  // Un credential de staging ne doit jamais rendre le rail disponible sur un
  // runtime métier de production, même si une variable Railway est mal copiée.
  if (runtimeEnvironment() === 'production' && c.environment === 'staging') return false;
  return true;
}

function publicConfig() {
  return {
    provider: 'kartapay',
    label: 'MVola via KartaPay',
    market_code: 'KM',
    requires_msisdn: false,
    configured: isConfigured(),
    flow: 'redirect',
  };
}

function unwrapPayment(body) {
  if (!body || typeof body !== 'object') return {};
  return body.data && typeof body.data === 'object' ? body.data : body;
}

function safePayment(payment) {
  const p = unwrapPayment(payment);
  const total = p?.purchase?.total || p?.total || {};
  const safe = {};
  for (const key of ['id', 'status', 'clientId', 'createdAt', 'submittedAt', 'completedAt', 'failedAt', 'canceledAt']) {
    if (p[key] !== undefined && p[key] !== null) safe[key] = p[key];
  }
  if (p.captured !== undefined && p.captured !== null) safe.captured = Boolean(p.captured);
  if (total.value !== undefined || total.currency !== undefined) {
    safe.total = {
      value: total.value == null ? null : String(total.value),
      currency: total.currency == null ? null : String(total.currency).toUpperCase(),
    };
  }
  const submitUrl = p?.billing?.submitUrl;
  if (submitUrl) safe.submit_url = String(submitUrl);
  return safe;
}

function normalizeStatus(raw) {
  const payment = unwrapPayment(raw);
  const value = String(payment?.status || '').trim().toUpperCase();
  if (SUCCESS.has(value)) return 'succeeded';
  if (EXPIRED.has(value)) return 'expired';
  if (FAILED.has(value)) return 'failed';
  return 'pending';
}

async function parseResponse(res) {
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; }
  catch (_) { body = { message: text.slice(0, 500) }; }

  if (!res.ok) {
    const err = new Error(`KartaPay HTTP ${res.status}`);
    err.code = 'kartapay_http_error';
    err.httpStatus = res.status;
    err.safeBody = body && typeof body === 'object'
      ? { status: body.status, title: body.title, detail: body.detail }
      : {};
    throw err;
  }
  return body;
}

async function getAccessToken(fetchImpl = global.fetch) {
  const c = config();
  if (!isConfigured()) {
    const err = new Error('KartaPay Comores non configuré');
    err.code = 'mobile_money_provider_not_configured';
    throw err;
  }

  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.value;

  const form = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: 'client_credentials',
  });
  const res = await fetchImpl(c.tokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const body = await parseResponse(res);
  if (!body.access_token) {
    const err = new Error('KartaPay: access_token absent');
    err.code = 'kartapay_token_invalid';
    throw err;
  }

  const ttlSeconds = Math.max(60, Number(body.expires_in) || 3600);
  tokenCache = { value: body.access_token, expiresAt: Date.now() + ttlSeconds * 1000 };
  return tokenCache.value;
}

function stableClientId(orderReference) {
  // KartaPay demande un clientId unique par paiement. Une commande Komerce ne
  // porte qu'un paiement KartaPay logique : l'ID déterministe reste donc stable
  // en cas de retry réseau et permet le rapprochement sans exposer la référence.
  return crypto.createHash('sha256').update(`komerce:kartapay:${orderReference}`).digest('hex').slice(0, 32);
}

function assertKmfAmount(amount, currency) {
  if (String(currency || '').toUpperCase() !== 'KMF') {
    const err = new Error('KartaPay Comores exige KMF');
    err.code = 'kartapay_currency_invalid';
    throw err;
  }
  const numeric = Number(amount);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    const err = new Error('KartaPay exige un montant KMF entier positif');
    err.code = 'kartapay_amount_invalid';
    throw err;
  }
  return numeric;
}

async function initiate({ orderReference, amount, currency, returnUrl, cancelUrl, fetchImpl = global.fetch }) {
  const c = config();
  const token = await getAccessToken(fetchImpl);
  const numericAmount = assertKmfAmount(amount, currency);
  const clientId = stableClientId(orderReference);

  const payload = {
    purchase: { total: { value: String(numericAmount), currency: 'KMF' } },
    clientId,
    type: 'instant',
    cancelUrl,
    successUrl: returnUrl,
  };

  const res = await fetchImpl(`${c.apiBaseUrl}/v1/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Accept-Language': 'fr',
    },
    body: JSON.stringify(payload),
  });
  const body = await parseResponse(res);
  const payment = unwrapPayment(body);
  const externalTransactionId = String(payment.id || '').trim();
  const paymentUrl = String(payment?.billing?.submitUrl || body.next || '').trim();
  if (!externalTransactionId || !paymentUrl) {
    const err = new Error('KartaPay: réponse initiation incomplète');
    err.code = 'kartapay_initiation_invalid';
    err.safeBody = safePayment(body);
    throw err;
  }

  log.info({ order_reference: orderReference, kartapay_id: externalTransactionId }, '[KARTAPAY-KM] paiement initié');
  return {
    externalTransactionId,
    status: normalizeStatus(payment),
    providerStatus: String(payment.status || 'pending'),
    safePayload: {
      ...safePayment(payment),
      client_id: clientId,
      environment: c.environment,
    },
    clientAction: { type: 'redirect', url: paymentUrl },
  };
}

async function getStatus({ externalTransactionId, fetchImpl = global.fetch }) {
  const c = config();
  const token = await getAccessToken(fetchImpl);
  const id = encodeURIComponent(String(externalTransactionId || '').trim());
  if (!id) {
    const err = new Error('KartaPay payment id absent');
    err.code = 'kartapay_payment_id_missing';
    throw err;
  }

  const res = await fetchImpl(`${c.apiBaseUrl}/v1/payments/${id}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Accept-Language': 'fr',
    },
  });
  const body = await parseResponse(res);
  const payment = unwrapPayment(body);
  const total = payment?.purchase?.total || payment?.total || {};

  return {
    status: normalizeStatus(payment),
    providerStatus: String(payment.status || 'UNKNOWN'),
    amount: total.value == null ? null : Number(total.value),
    currency: total.currency ? String(total.currency).toUpperCase() : null,
    safePayload: safePayment(payment),
  };
}

function getWebhookReference(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  return {
    externalTransactionId: String(data.id || '').trim(),
    clientId: String(data.clientId || '').trim(),
  };
}

function verifyWebhook({ payload, signature, expectedClientId = null, expectedExternalTransactionId = null }) {
  const c = config();
  if (!isConfigured()) return false;

  const data = payload?.data && typeof payload.data === 'object' ? payload.data : null;
  if (!data) return false;

  const id = String(data.id || '').trim();
  const clientId = String(data.clientId || '').trim();
  const value = data?.total?.value == null ? '' : String(data.total.value);
  const currency = String(data?.total?.currency || '').trim().toUpperCase();
  const submittedAt = String(data.submittedAt || '').trim();
  const status = String(data.status || '').trim();
  const supplied = String(signature || '').trim().toLowerCase();

  if (!id || !clientId || !value || !currency || !submittedAt || !status || !/^[0-9a-f]{64}$/.test(supplied)) {
    return false;
  }
  if (expectedExternalTransactionId && id !== String(expectedExternalTransactionId)) return false;
  if (expectedClientId && clientId !== String(expectedClientId)) return false;

  const message = [id, c.merchantId, clientId, value, currency, submittedAt, status].join(',');
  const expected = crypto.createHmac('sha256', c.webhookSecret).update(message).digest('hex');

  const suppliedBuffer = Buffer.from(supplied, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return suppliedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function _resetTokenCacheForTests() {
  tokenCache = null;
}

module.exports = {
  name: 'kartapay',
  marketCode: 'KM',
  label: 'MVola via KartaPay',
  requiresMsisdn: false,
  isConfigured,
  publicConfig,
  normalizeStatus,
  initiate,
  getStatus,
  getWebhookReference,
  verifyWebhook,
  _resetTokenCacheForTests,
  _stableClientIdForTests: stableClientId,
};
