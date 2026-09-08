/**
 * @komerce-arch
 * @role          paypal-sandbox-ops-probe
 * @domain        payment
 * @layer         tooling
 * @criticality   medium
 * @inputs        KOMERCE_ENV, PAYPAL_ENV, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, PUBLIC_BASE_URL
 * @outputs       process_exit_code, redacted_probe_log
 * @depends       middleware/require-non-production.js
 * @db-read       none
 * @db-write      none
 * @doctrine      staging_provider_probe_never_logs_credentials_or_tokens
 * @impact-areas  payment, operations
 * @version       2026-09
 */
'use strict';

const { resolveRuntimeEnvironment } = require('../middleware/require-non-production');

const PAYPAL_BASE = 'https://api-m.sandbox.paypal.com';
const REQUIRED_WEBHOOK_EVENTS = new Set([
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.DENIED',
  'PAYMENT.CAPTURE.REFUNDED',
  'CUSTOMER.DISPUTE.CREATED',
]);

function fail(message, exitCode = 3) {
  console.error(`[PAYPAL-PROBE] FAIL ${message}`);
  process.exitCode = exitCode;
}

async function getAccessToken(id, secret) {
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const startedAt = Date.now();
  const response = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const latencyMs = Date.now() - startedAt;

  if (!response.ok) {
    let providerError = 'unknown';
    try {
      const body = await response.json();
      providerError = body?.error || providerError;
    } catch {
      // Ne jamais imprimer le body brut : le probe reste volontairement minimal.
    }
    fail(`step=oauth env=sandbox http=${response.status} error=${providerError} latency_ms=${latencyMs}`);
    return null;
  }

  const body = await response.json();
  if (!body?.access_token) {
    fail(`step=oauth env=sandbox http=${response.status} error=missing_access_token latency_ms=${latencyMs}`);
    return null;
  }

  console.log(`[PAYPAL-PROBE] OK step=oauth env=sandbox http=${response.status} latency_ms=${latencyMs}`);
  return body.access_token;
}

async function probeCreateOrder(token) {
  const startedAt = Date.now();
  const reference = `KOMERCE-STAGING-PROBE-${Date.now()}`;
  const response = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': reference,
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: reference,
        description: 'Komerce staging PayPal probe',
        amount: { currency_code: 'EUR', value: '1.00' },
      }],
      application_context: {
        brand_name: 'Komerce',
        locale: 'fr-FR',
        landing_page: 'BILLING',
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
      },
    }),
  });
  const latencyMs = Date.now() - startedAt;

  if (!response.ok) {
    let providerError = 'unknown';
    try {
      const body = await response.json();
      providerError = body?.name || body?.error || providerError;
    } catch {}
    fail(`step=create_order env=sandbox http=${response.status} error=${providerError} latency_ms=${latencyMs}`);
    return false;
  }

  const body = await response.json();
  if (!body?.id || !['CREATED', 'APPROVED'].includes(body.status)) {
    fail(`step=create_order env=sandbox http=${response.status} error=unexpected_response latency_ms=${latencyMs}`);
    return false;
  }

  console.log(`[PAYPAL-PROBE] OK step=create_order env=sandbox http=${response.status} status=${body.status} latency_ms=${latencyMs}`);
  return true;
}

async function probeWebhook(token, webhookId) {
  const startedAt = Date.now();
  const response = await fetch(`${PAYPAL_BASE}/v1/notifications/webhooks/${encodeURIComponent(webhookId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const latencyMs = Date.now() - startedAt;

  if (!response.ok) {
    fail(`step=webhook_lookup env=sandbox http=${response.status} error=webhook_not_found_or_not_owned latency_ms=${latencyMs}`);
    return false;
  }

  const body = await response.json();
  const actualUrl = String(body?.url || '').replace(/\/$/, '');
  const publicBase = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const expectedUrl = publicBase ? `${publicBase}/api/payments/paypal/webhook` : '';

  if (expectedUrl && actualUrl !== expectedUrl) {
    fail(`step=webhook_url env=sandbox expected=${expectedUrl} actual=${actualUrl || '(missing)'}`);
    return false;
  }

  const eventNames = new Set((body?.event_types || []).map(event => event?.name).filter(Boolean));
  const subscribesAll = eventNames.has('*');
  const missingEvents = subscribesAll
    ? []
    : [...REQUIRED_WEBHOOK_EVENTS].filter(eventName => !eventNames.has(eventName));

  if (missingEvents.length) {
    fail(`step=webhook_events env=sandbox missing=${missingEvents.join(',')}`);
    return false;
  }

  console.log(`[PAYPAL-PROBE] OK step=webhook env=sandbox http=${response.status} url=${actualUrl || '(missing)'} events=${subscribesAll ? '*' : eventNames.size} latency_ms=${latencyMs}`);
  return true;
}

async function main() {
  const { env: runtimeEnv } = resolveRuntimeEnvironment();

  if (runtimeEnv === 'production') {
    fail('step=guard runtime=production', 2);
    return;
  }

  if (process.env.PAYPAL_ENV !== 'sandbox') {
    fail(`step=guard PAYPAL_ENV=${process.env.PAYPAL_ENV || '(absent)'} expected=sandbox`, 2);
    return;
  }

  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!id || !secret) {
    fail('step=guard missing=PAYPAL_CLIENT_ID_OR_SECRET', 2);
    return;
  }
  if (!webhookId) {
    fail('step=guard missing=PAYPAL_WEBHOOK_ID', 2);
    return;
  }

  try {
    const token = await getAccessToken(id, secret);
    if (!token) return;

    const orderOk = await probeCreateOrder(token);
    if (!orderOk) return;

    await probeWebhook(token, webhookId);
  } catch (error) {
    fail(`step=network env=sandbox type=${error?.name || 'Error'}`, 4);
  }
}

main();
