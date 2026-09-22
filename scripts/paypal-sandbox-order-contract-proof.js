#!/usr/bin/env node
'use strict';

/**
 * PayPal Sandbox P1 proof: create one idempotent Order, then GET the exact Order.
 * NO payer approval, capture, refund, webhook simulation, DB write, or Komerce order mutation.
 */

const crypto = require('node:crypto');

const BASE = 'https://api-m.sandbox.paypal.com';

function fail(reason, extra = {}) {
  process.stdout.write(JSON.stringify({
    schema_version: 1,
    provider: 'paypal',
    environment: 'SANDBOX',
    operation: 'ORDER_CREATE_AND_EXACT_READBACK',
    status: 'BLOCKED',
    reason_code: reason,
    ...extra,
  }) + '\n');
  process.exitCode = 1;
}

function ok(extra = {}) {
  process.stdout.write(JSON.stringify({
    schema_version: 1,
    provider: 'paypal',
    environment: 'SANDBOX',
    operation: 'ORDER_CREATE_AND_EXACT_READBACK',
    status: 'PASS',
    reason_code: 'PAYPAL_SANDBOX_ORDER_CREATE_AND_EXACT_READBACK_PROVED',
    ...extra,
  }) + '\n');
}

async function main({ env = process.env, fetchImpl = global.fetch, now = Date.now } = {}) {
  const runtime = String(env.KOMERCE_ENV || env.NODE_ENV || '').trim().toLowerCase();
  if (runtime === 'production') return fail('RUNTIME_PRODUCTION_REFUSED');
  if (String(env.PAYPAL_ENV || '').trim().toLowerCase() !== 'sandbox') {
    return fail('PAYPAL_SANDBOX_REQUIRED');
  }
  const id = String(env.PAYPAL_CLIENT_ID || '').trim();
  const secret = String(env.PAYPAL_CLIENT_SECRET || '').trim();
  if (!id || !secret) return fail('PAYPAL_CREDENTIALS_MISSING');

  const basic = Buffer.from(id + ':' + secret).toString('base64');
  const oauth = await fetchImpl(BASE + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + basic,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(7000),
  });
  if (!oauth.ok) return fail('PAYPAL_OAUTH_REJECTED', { http_status: oauth.status });
  const tokenBody = await oauth.json();
  const token = tokenBody && tokenBody.access_token;
  if (!token || typeof token !== 'string') return fail('PAYPAL_TOKEN_MISSING');

  const nonce = crypto.randomUUID();
  const reference = 'KOMERCE-P1-' + now();
  const requestId = 'komerce-p1-create-' + nonce;

  const create = await fetchImpl(BASE + '/v2/checkout/orders', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': requestId,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: reference,
        amount: { currency_code: 'EUR', value: '1.00' },
      }],
      application_context: {
        brand_name: 'Komerce Contract Proof',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
      },
    }),
    signal: AbortSignal.timeout(7000),
  });

  if (!create.ok) return fail('PAYPAL_ORDER_CREATE_REJECTED', { http_status: create.status });
  const created = await create.json();
  const orderId = String(created && created.id || '');
  if (!orderId) return fail('PAYPAL_ORDER_ID_MISSING');
  if (!['CREATED', 'PAYER_ACTION_REQUIRED'].includes(String(created.status || '').toUpperCase())) {
    return fail('PAYPAL_ORDER_CREATE_STATUS_UNEXPECTED');
  }

  const read = await fetchImpl(BASE + '/v2/checkout/orders/' + encodeURIComponent(orderId), {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(7000),
  });
  if (!read.ok) return fail('PAYPAL_ORDER_READBACK_REJECTED', { http_status: read.status });
  const exact = await read.json();
  if (String(exact && exact.id || '') !== orderId) return fail('PAYPAL_ORDER_ID_MISMATCH');

  const unit = Array.isArray(exact.purchase_units) ? exact.purchase_units[0] : null;
  if (!unit || String(unit.reference_id || '') !== reference) return fail('PAYPAL_REFERENCE_ID_MISMATCH');
  const amount = unit.amount || {};
  if (String(amount.currency_code || '') !== 'EUR' || String(amount.value || '') !== '1.00') {
    return fail('PAYPAL_ORDER_AMOUNT_MISMATCH');
  }

  ok({
    create_http_status: create.status,
    read_http_status: read.status,
    provider_status: String(exact.status || created.status || '').toUpperCase(),
    readback_confirmed: true,
    capture_attempted: false,
  });
}

if (require.main === module) {
  main().catch(() => fail('PAYPAL_NETWORK_OR_RESPONSE_ERROR'));
}

module.exports = { main };
