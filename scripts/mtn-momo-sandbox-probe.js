'use strict';

/**
 * Safe MTN MoMo Sandbox probe for Komerce staging.
 *
 * Verifies, without logging credentials or bearer tokens:
 *   1. runtime is non-production and MTN target is sandbox;
 *   2. Collections OAuth credentials are accepted;
 *   3. RequestToPay is accepted (HTTP 202);
 *   4. the transaction status endpoint is readable (HTTP 200).
 *
 * This probe deliberately uses EUR because MTN's developer sandbox uses EUR.
 * It does not mutate Komerce orders or the database.
 */

const crypto = require('crypto');

const SANDBOX_BASE_URL = 'https://sandbox.momodeveloper.mtn.com';
const REQUIRED = [
  'MTN_MOMO_CG_SUBSCRIPTION_KEY',
  'MTN_MOMO_CG_API_USER',
  'MTN_MOMO_CG_API_KEY',
];

function fail(message) {
  console.error(`[MTN-PROBE] FAIL ${message}`);
  process.exitCode = 1;
}

function safeReason(body) {
  if (!body || typeof body !== 'object') return '';
  return String(body.code || body.reason || body.message || '').slice(0, 160);
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch (_) { return {}; }
}

async function main() {
  const runtime = String(process.env.KOMERCE_ENV || process.env.NODE_ENV || '')
    .trim()
    .toLowerCase();
  const target = String(process.env.MTN_MOMO_CG_TARGET_ENVIRONMENT || '')
    .trim()
    .toLowerCase();
  const baseUrl = String(process.env.MTN_MOMO_CG_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');

  if (runtime === 'production') {
    throw new Error('refus d’exécuter le probe sur le runtime métier production');
  }
  if (target !== 'sandbox') {
    throw new Error(`MTN_MOMO_CG_TARGET_ENVIRONMENT doit être sandbox (reçu: ${target || 'vide'})`);
  }
  if (baseUrl !== SANDBOX_BASE_URL) {
    throw new Error('MTN_MOMO_CG_BASE_URL ne pointe pas vers le Sandbox MTN attendu');
  }
  for (const key of REQUIRED) {
    if (!String(process.env[key] || '').trim()) {
      throw new Error(`${key} absent`);
    }
  }

  const subscriptionKey = process.env.MTN_MOMO_CG_SUBSCRIPTION_KEY;
  const apiUser = process.env.MTN_MOMO_CG_API_USER;
  const apiKey = process.env.MTN_MOMO_CG_API_KEY;
  const basic = Buffer.from(`${apiUser}:${apiKey}`).toString('base64');

  let res = await fetch(`${baseUrl}/collection/token/`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Ocp-Apim-Subscription-Key': subscriptionKey,
      Accept: 'application/json',
    },
  });
  let body = await readJson(res);
  if (!res.ok || !body.access_token) {
    throw new Error(`OAuth Sandbox refusé: HTTP ${res.status} ${safeReason(body)}`.trim());
  }
  const accessToken = body.access_token;
  console.log('[MTN-PROBE] OAuth Sandbox OK');

  const referenceId = crypto.randomUUID();
  res = await fetch(`${baseUrl}/collection/v1_0/requesttopay`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Ocp-Apim-Subscription-Key': subscriptionKey,
      'X-Target-Environment': 'sandbox',
      'X-Reference-Id': referenceId,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      amount: '1',
      currency: 'EUR',
      externalId: `KOMERCE-STAGING-PROBE-${Date.now()}`,
      payer: {
        partyIdType: 'MSISDN',
        // MTN Sandbox test number documented as an ongoing RequestToPay.
        partyId: '46733123453',
      },
      payerMessage: 'Komerce staging probe',
      payeeNote: 'Komerce staging probe',
    }),
  });
  body = await readJson(res);
  if (res.status !== 202) {
    throw new Error(`RequestToPay refusé: HTTP ${res.status} ${safeReason(body)}`.trim());
  }
  console.log('[MTN-PROBE] RequestToPay 202 Accepted');

  await new Promise(resolve => setTimeout(resolve, 1500));
  res = await fetch(`${baseUrl}/collection/v1_0/requesttopay/${encodeURIComponent(referenceId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Ocp-Apim-Subscription-Key': subscriptionKey,
      'X-Target-Environment': 'sandbox',
      Accept: 'application/json',
    },
  });
  body = await readJson(res);
  if (!res.ok) {
    throw new Error(`Lecture statut refusée: HTTP ${res.status} ${safeReason(body)}`.trim());
  }
  console.log(`[MTN-PROBE] Status read OK: ${String(body.status || 'UNKNOWN')}`);
  console.log('[MTN-PROBE] PASS OAuth + RequestToPay + status');
}

main().catch(err => fail(err.message));
