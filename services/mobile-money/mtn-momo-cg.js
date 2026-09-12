/**
 * @komerce-arch
 * @role          mobile-money-provider-adapter
 * @domain        payment
 * @layer         service
 * @criticality   critical
 * @inputs        authoritative_amount, msisdn, callback_url
 * @outputs       provider_transaction, normalized_status
 * @depends       MTN MoMo Collections API
 * @used-by       services/payment-mobile-money.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      provider_adapter_no_business_mutation, secrets_env_only, fail_closed
 * @impact-areas  payment, checkout
 * @version       2026-09
 */
'use strict';

const crypto = require('crypto');
const log = require('../../utils/logger').child({ module: 'mtn-momo-cg' });

const SUCCESS = new Set(['SUCCESSFUL', 'SUCCESS', 'COMPLETED', 'PAID']);
const FAILED  = new Set(['FAILED', 'REJECTED', 'CANCELLED', 'CANCELED', 'EXPIRED']);

// MTN impose EUR dans son environnement développeur Sandbox. Cette monnaie est
// uniquement un contrat de transport de test : la vérité métier du marché Congo
// reste XAF dans Komerce et ne doit jamais être réécrite pour satisfaire le Sandbox.
const SANDBOX_CURRENCY = 'EUR';
const SANDBOX_AMOUNT = 1000;

let tokenCache = null;

function trimSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function runtimeEnvironment() {
  return String(process.env.KOMERCE_ENV || process.env.NODE_ENV || '')
    .trim()
    .toLowerCase();
}

function config() {
  const baseUrl = trimSlash(process.env.MTN_MOMO_CG_BASE_URL);
  return {
    baseUrl,
    subscriptionKey: String(process.env.MTN_MOMO_CG_SUBSCRIPTION_KEY || '').trim(),
    apiUser:         String(process.env.MTN_MOMO_CG_API_USER || '').trim(),
    apiKey:          String(process.env.MTN_MOMO_CG_API_KEY || '').trim(),
    targetEnv:       String(process.env.MTN_MOMO_CG_TARGET_ENVIRONMENT || '').trim(),
    tokenUrl:        String(process.env.MTN_MOMO_CG_TOKEN_URL || (baseUrl ? `${baseUrl}/collection/token/` : '')).trim(),
    requestToPayUrl: String(process.env.MTN_MOMO_CG_REQUEST_TO_PAY_URL || (baseUrl ? `${baseUrl}/collection/v1_0/requesttopay` : '')).trim(),
  };
}

function isSandboxTransport(c = config()) {
  return runtimeEnvironment() !== 'production'
    && String(c.targetEnv || '').trim().toLowerCase() === 'sandbox';
}

function isConfigured() {
  const c = config();
  const complete = Boolean(
    c.baseUrl && c.subscriptionKey && c.apiUser && c.apiKey && c.targetEnv &&
    c.tokenUrl && c.requestToPayUrl
  );
  if (!complete) return false;

  // Un credential Sandbox ne doit jamais rendre MTN disponible sur un runtime
  // métier production. C'est un garde-fou runtime en plus du provisioning Railway.
  if (runtimeEnvironment() === 'production'
      && String(c.targetEnv).trim().toLowerCase() === 'sandbox') {
    return false;
  }
  return true;
}

function publicConfig() {
  return {
    provider: 'mtn_momo',
    label: 'MTN MoMo',
    market_code: 'CG',
    requires_msisdn: true,
    configured: isConfigured(),
    flow: 'approval',
  };
}

function normalizeMsisdn(value) {
  return String(value || '').replace(/\D/g, '');
}

function safeJson(value) {
  if (!value || typeof value !== 'object') return {};
  const safe = {};
  for (const key of ['status', 'reason', 'financialTransactionId', 'externalId', 'amount', 'currency']) {
    if (value[key] !== undefined && value[key] !== null) safe[key] = value[key];
  }
  return safe;
}

function normalizeStatus(raw) {
  const value = String(raw?.status || raw?.transactionStatus || '').trim().toUpperCase();
  if (SUCCESS.has(value)) return 'succeeded';
  if (FAILED.has(value)) return value === 'EXPIRED' ? 'expired' : 'failed';
  return 'pending';
}

async function parseResponse(res, { allowEmpty = false } = {}) {
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; }
  catch (_) { body = { reason: text.slice(0, 500) }; }

  if (!res.ok) {
    const err = new Error(`MTN MoMo HTTP ${res.status}`);
    err.code = 'mtn_momo_http_error';
    err.httpStatus = res.status;
    err.safeBody = safeJson(body);
    throw err;
  }
  if (!allowEmpty && !text) return {};
  return body;
}

async function getAccessToken(fetchImpl = global.fetch) {
  const c = config();
  if (!isConfigured()) {
    const err = new Error('MTN MoMo Congo non configuré');
    err.code = 'mobile_money_provider_not_configured';
    throw err;
  }

  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) {
    return tokenCache.value;
  }

  const basic = Buffer.from(`${c.apiUser}:${c.apiKey}`).toString('base64');
  const res = await fetchImpl(c.tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Ocp-Apim-Subscription-Key': c.subscriptionKey,
      Accept: 'application/json',
    },
  });
  const body = await parseResponse(res);
  if (!body.access_token) {
    const err = new Error('MTN MoMo: access_token absent');
    err.code = 'mtn_momo_token_invalid';
    throw err;
  }

  const ttlSeconds = Math.max(60, Number(body.expires_in) || 3600);
  tokenCache = {
    value: body.access_token,
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
  return tokenCache.value;
}

function authHeaders(c, token) {
  return {
    Authorization: `Bearer ${token}`,
    'Ocp-Apim-Subscription-Key': c.subscriptionKey,
    'X-Target-Environment': c.targetEnv,
    Accept: 'application/json',
  };
}

function providerMoney(c, amount, currency) {
  if (isSandboxTransport(c)) {
    return { amount: SANDBOX_AMOUNT, currency: SANDBOX_CURRENCY };
  }
  return { amount, currency: String(currency || '').toUpperCase() };
}

function assertSandboxStatusContract(body) {
  const providerAmount = Number(body?.amount);
  const providerCurrency = String(body?.currency || '').trim().toUpperCase();
  if (!Number.isFinite(providerAmount)
      || providerAmount !== SANDBOX_AMOUNT
      || providerCurrency !== SANDBOX_CURRENCY) {
    const err = new Error('MTN MoMo Sandbox: montant/devise de transport incohérents');
    err.code = 'mtn_momo_sandbox_contract_mismatch';
    err.safeBody = safeJson(body);
    throw err;
  }
}

async function initiate({ orderReference, amount, currency, msisdn, callbackUrl, fetchImpl = global.fetch }) {
  const c = config();
  const payer = normalizeMsisdn(msisdn);
  if (!payer) {
    const err = new Error('Numéro MTN MoMo requis');
    err.code = 'mobile_money_msisdn_required';
    throw err;
  }

  const token = await getAccessToken(fetchImpl);
  const externalTransactionId = crypto.randomUUID();
  const money = providerMoney(c, amount, currency);
  const sandbox = isSandboxTransport(c);
  const res = await fetchImpl(c.requestToPayUrl, {
    method: 'POST',
    headers: {
      ...authHeaders(c, token),
      'Content-Type': 'application/json',
      'X-Reference-Id': externalTransactionId,
      'X-Callback-Url': callbackUrl,
    },
    body: JSON.stringify({
      amount: String(money.amount),
      currency: money.currency,
      externalId: orderReference,
      payer: {
        partyIdType: 'MSISDN',
        partyId: payer,
      },
      payerMessage: `Komerce ${orderReference}`,
      payeeNote: `Komerce ${orderReference}`,
    }),
  });

  // RequestToPay est asynchrone : 202 + body vide est le nominal.
  await parseResponse(res, { allowEmpty: true });
  if (res.status !== 202) {
    const err = new Error(`MTN MoMo: RequestToPay attendu 202, reçu ${res.status}`);
    err.code = 'mtn_momo_request_not_accepted';
    throw err;
  }

  log.info({
    order_reference: orderReference,
    reference_id: externalTransactionId,
    sandbox_transport: sandbox,
  }, '[MTN-MOMO-CG] RequestToPay accepté');

  return {
    externalTransactionId,
    status: 'pending',
    providerStatus: 'PENDING',
    safePayload: sandbox
      ? { sandbox_transport: true, amount: SANDBOX_AMOUNT, currency: SANDBOX_CURRENCY }
      : {},
    clientAction: {
      type: 'approval',
      message: sandbox
        ? 'Test MTN Sandbox en cours — aucune validation réelle sur téléphone n’est requise.'
        : 'Validez la demande de paiement MTN MoMo sur votre téléphone.',
    },
  };
}

async function getStatus({ externalTransactionId, fetchImpl = global.fetch }) {
  const c = config();
  const token = await getAccessToken(fetchImpl);
  const url = `${c.requestToPayUrl}/${encodeURIComponent(externalTransactionId)}`;
  const res = await fetchImpl(url, {
    method: 'GET',
    headers: authHeaders(c, token),
  });
  const body = await parseResponse(res);
  const sandbox = isSandboxTransport(c);

  if (sandbox) {
    // Le provider Sandbox ne peut pas refléter le montant XAF métier : il impose
    // son contrat synthétique EUR. On vérifie strictement CE contrat ici puis on
    // laisse la couche métier conserver son snapshot XAF autoritatif.
    assertSandboxStatusContract(body);
  }

  return {
    status: normalizeStatus(body),
    providerStatus: String(body.status || 'UNKNOWN'),
    // En Sandbox, l'EUR/1000 est uniquement un transport de test et ne doit pas
    // être comparé ni persisté comme vérité économique de la commande Congo.
    amount: sandbox ? null : (body.amount == null ? null : Number(body.amount)),
    currency: sandbox ? null : (body.currency ? String(body.currency).toUpperCase() : null),
    safePayload: {
      ...safeJson(body),
      ...(sandbox ? { sandbox_transport: true } : {}),
    },
  };
}

function _resetTokenCacheForTests() {
  tokenCache = null;
}

module.exports = {
  name: 'mtn_momo',
  marketCode: 'CG',
  label: 'MTN MoMo',
  requiresMsisdn: true,
  isConfigured,
  publicConfig,
  normalizeMsisdn,
  normalizeStatus,
  initiate,
  getStatus,
  _resetTokenCacheForTests,
};
