#!/usr/bin/env node
'use strict';

/**
 * MTN MoMo Collections Sandbox P1 RequestToPay proof.
 *
 * MUTATES SANDBOX ONLY: creates one RequestToPay and reads back its exact status.
 * It refuses to run unless an operator explicitly supplies MTN_PROOF_SANDBOX_MSISDN.
 * It never writes Komerce DB state and never treats a callback as authoritative.
 */

const crypto = require('node:crypto');
const BASE = 'https://sandbox.momodeveloper.mtn.com';

function report(status, reason_code, extra = {}) {
  process.stdout.write(JSON.stringify({
    schema_version: 1,
    provider: 'mtn-momo-cg',
    environment: 'SANDBOX',
    operation: 'REQUEST_TO_PAY_AND_EXACT_STATUS_READBACK',
    status,
    reason_code,
    ...extra,
  }) + '\n');
  if (status !== 'PASS') process.exitCode = 1;
}

async function main({ env = process.env, fetchImpl = global.fetch } = {}) {
  const runtime = String(env.KOMERCE_ENV || env.NODE_ENV || '').trim().toLowerCase();
  if (runtime === 'production') return report('BLOCKED', 'RUNTIME_PRODUCTION_REFUSED');
  if (String(env.MTN_MOMO_CG_TARGET_ENVIRONMENT || '').trim().toLowerCase() !== 'sandbox') {
    return report('BLOCKED', 'MTN_SANDBOX_REQUIRED');
  }
  const base = String(env.MTN_MOMO_CG_BASE_URL || '').trim().replace(/\/+$/, '');
  if (base !== BASE) return report('BLOCKED', 'MTN_SANDBOX_BASE_URL_REQUIRED');

  const subscriptionKey = String(env.MTN_MOMO_CG_SUBSCRIPTION_KEY || '').trim();
  const apiUser = String(env.MTN_MOMO_CG_API_USER || '').trim();
  const apiKey = String(env.MTN_MOMO_CG_API_KEY || '').trim();
  const msisdn = String(env.MTN_PROOF_SANDBOX_MSISDN || '').replace(/\D/g, '');
  if (!subscriptionKey || !apiUser || !apiKey) return report('BLOCKED', 'MTN_CREDENTIALS_MISSING');
  if (!msisdn) return report('BLOCKED', 'MTN_OPERATOR_CONFIRMED_SANDBOX_MSISDN_REQUIRED');

  const tokenRes = await fetchImpl(BASE + '/collection/token/', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(apiUser + ':' + apiKey).toString('base64'),
      'Ocp-Apim-Subscription-Key': subscriptionKey,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(7000),
  });
  if (!tokenRes.ok) return report('BLOCKED', 'MTN_OAUTH_REJECTED', { http_status: tokenRes.status });
  const tokenPayload = await tokenRes.json();
  const token = tokenPayload && tokenPayload.access_token;
  if (!token || typeof token !== 'string') return report('BLOCKED', 'MTN_TOKEN_MISSING');

  const referenceId = crypto.randomUUID();
  const externalId = 'KOMERCE-P1-' + Date.now();
  const headers = {
    Authorization: 'Bearer ' + token,
    'Ocp-Apim-Subscription-Key': subscriptionKey,
    'X-Target-Environment': 'sandbox',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const post = await fetchImpl(BASE + '/collection/v1_0/requesttopay', {
    method: 'POST',
    headers: { ...headers, 'X-Reference-Id': referenceId },
    body: JSON.stringify({
      amount: '1000',
      currency: 'EUR',
      externalId,
      payer: { partyIdType: 'MSISDN', partyId: msisdn },
      payerMessage: 'Komerce contract proof',
      payeeNote: 'Komerce contract proof',
    }),
    signal: AbortSignal.timeout(7000),
  });
  if (post.status !== 202) {
    return report('BLOCKED', 'MTN_REQUEST_TO_PAY_NOT_ACCEPTED', { http_status: post.status });
  }

  let last = null;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, attempt === 1 ? 1500 : 1000));
    const get = await fetchImpl(BASE + '/collection/v1_0/requesttopay/' + encodeURIComponent(referenceId), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(7000),
    });
    if (!get.ok) return report('BLOCKED', 'MTN_STATUS_READBACK_REJECTED', { http_status: get.status });
    const body = await get.json();
    last = body;
    const status = String(body && body.status || '').toUpperCase();
    if (['SUCCESSFUL', 'FAILED'].includes(status)) break;
  }

  if (!last) return report('BLOCKED', 'MTN_STATUS_MISSING');
  if (String(last.externalId || '') && String(last.externalId) !== externalId) {
    return report('BLOCKED', 'MTN_EXTERNAL_ID_MISMATCH');
  }
  const amount = String(last.amount || '');
  const currency = String(last.currency || '').toUpperCase();
  if (amount !== '1000' || currency !== 'EUR') {
    return report('BLOCKED', 'MTN_SANDBOX_MONEY_READBACK_MISMATCH');
  }

  report('PASS', 'MTN_SANDBOX_REQUEST_TO_PAY_ACCEPTED_AND_STATUS_READBACK_PROVED', {
    request_http_status: 202,
    provider_status: String(last.status || 'UNKNOWN').toUpperCase(),
    readback_confirmed: true,
    callback_required_for_proof: false,
  });
}

if (require.main === module) {
  main().catch(() => report('BLOCKED', 'MTN_NETWORK_OR_RESPONSE_ERROR'));
}

module.exports = { main };
