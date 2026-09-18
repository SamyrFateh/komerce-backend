#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          stripe-golden-p4-proof
 * @domain        payment
 * @layer         script
 * @criticality   critical
 * @inputs        Stripe TEST credentials, Komerce DB, configured Stripe webhook
 * @outputs       bounded sanitized P4 proof JSON
 * @depends       stripe, db, services/payment-stripe.js
 * @used-by       operator-controlled Stripe external-provider P4 qualification
 * @db-read       markets, orders, products, stripe_events_processed, purchase_orders
 * @db-write      temporary P4-only relais/products/orders/order_items fixtures + cleanup
 * @db-txn        bounded_fixture_setup_and_cleanup
 * @doctrine      external-provider-contract-proof, test-only-provider-mutation, fail-closed
 * @impact-areas  payments, orders, stock, purchasing
 */
'use strict';

const crypto = require('crypto');

const ACK = 'STRIPE_TEST_P4_MUTATION';
const REQUIRED_EVENTS = Object.freeze([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
]);

function classifyStripeKey(value) {
  const key = String(value || '');
  if (/^(sk|rk)_test_/.test(key)) return 'TEST';
  if (/^(sk|rk)_live_/.test(key)) return 'LIVE';
  return 'UNKNOWN';
}

function resolveExpectedWebhookUrl(env = process.env) {
  if (env.STRIPE_WEBHOOK_URL) return String(env.STRIPE_WEBHOOK_URL).trim();

  const base = String(env.PUBLIC_BASE_URL || env.KOMERCE_API_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (base) return base + '/api/payments/stripe/webhook';

  const railwayDomain = String(env.RAILWAY_PUBLIC_DOMAIN || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  return railwayDomain
    ? 'https://' + railwayDomain + '/api/payments/stripe/webhook'
    : null;
}

function assertP4Environment(env = process.env) {
  const keyMode = classifyStripeKey(env.STRIPE_SECRET_KEY);
  if (keyMode !== 'TEST') {
    const err = new Error('STRIPE_P4_BLOCKED_TEST_KEY_REQUIRED');
    err.code = 'STRIPE_P4_BLOCKED_TEST_KEY_REQUIRED';
    throw err;
  }
  if (String(env.STRIPE_MODE || 'TEST').toUpperCase() !== 'TEST') {
    const err = new Error('STRIPE_P4_BLOCKED_TEST_MODE_REQUIRED');
    err.code = 'STRIPE_P4_BLOCKED_TEST_MODE_REQUIRED';
    throw err;
  }
  if (!env.STRIPE_WEBHOOK_SECRET) {
    const err = new Error('STRIPE_P4_BLOCKED_WEBHOOK_SECRET_REQUIRED');
    err.code = 'STRIPE_P4_BLOCKED_WEBHOOK_SECRET_REQUIRED';
    throw err;
  }
  if (env.STRIPE_GOLDEN_P4_ACK !== ACK) {
    const err = new Error('STRIPE_P4_BLOCKED_EXPLICIT_ACK_REQUIRED');
    err.code = 'STRIPE_P4_BLOCKED_EXPLICIT_ACK_REQUIRED';
    throw err;
  }
  if (!env.DATABASE_URL && !env.STRIPE_P4_DATABASE_URL) {
    const err = new Error('STRIPE_P4_BLOCKED_DATABASE_URL_REQUIRED');
    err.code = 'STRIPE_P4_BLOCKED_DATABASE_URL_REQUIRED';
    throw err;
  }
  return { keyMode };
}

function buildSafeFixtureSpec(now = new Date(), random = crypto.randomBytes(4).toString('hex')) {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
  const suffix = String(random).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
  const tag = `SP4-${stamp}-${suffix}`;
  return Object.freeze({
    tag,
    orderReference: tag,
    productName: `Stripe P4 ${tag}`,
    relayName: `Stripe P4 ${tag}`,
    totalKmf: 250,
    totalEur: 0.50,
    stockBefore: 2,
    quantity: 1,
    fulfillmentSource: 'LOCAL_STOCK',
    userId: null,
    recipientId: null,
    trackingPhone: null,
  });
}

function eventEnabled(endpoint, eventName) {
  const enabled = Array.isArray(endpoint?.enabled_events) ? endpoint.enabled_events : [];
  return enabled.includes('*') || enabled.includes(eventName);
}

async function preflightStripeWebhook(stripe, env = process.env) {
  const listed = await stripe.webhookEndpoints.list({ limit: 100 });
  const endpoints = Array.isArray(listed?.data) ? listed.data : [];
  const expectedUrl = resolveExpectedWebhookUrl(env);

  let candidates = endpoints.filter(endpoint =>
    endpoint?.status === 'enabled' &&
    endpoint?.livemode === false &&
    REQUIRED_EVENTS.every(name => eventEnabled(endpoint, name))
  );

  if (expectedUrl) {
    candidates = candidates.filter(endpoint => String(endpoint.url || '') === expectedUrl);
  } else {
    candidates = candidates.filter(endpoint =>
      /\/api\/payments\/stripe\/webhook\/?$/.test(String(endpoint.url || ''))
    );
  }

  if (candidates.length !== 1) {
    const err = new Error('STRIPE_P4_BLOCKED_WEBHOOK_NOT_EXACT_SINGLE_MATCH');
    err.code = 'STRIPE_P4_BLOCKED_WEBHOOK_NOT_EXACT_SINGLE_MATCH';
    err.details = { candidate_count: candidates.length, expected_url_known: Boolean(expectedUrl) };
    throw err;
  }

  const endpoint = candidates[0];
  return {
    url: endpoint.url,
    status: endpoint.status,
    livemode: endpoint.livemode,
    apiVersion: endpoint.api_version || null,
  };
}

async function createFixture(db, spec) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [market] } = await client.query(
      `SELECT id FROM markets WHERE code = 'KM' AND is_active = TRUE LIMIT 1`
    );
    if (!market) throw new Error('STRIPE_P4_BLOCKED_KM_MARKET_MISSING');

    const { rows: [relay] } = await client.query(
      `INSERT INTO relais
         (name, agent_name, phone, address, island, market_id, is_active)
       VALUES ($1, $2, '+2693999999', 'Stripe P4 disposable fixture', 'Ngazidja', $3, TRUE)
       RETURNING id`,
      [spec.relayName, spec.relayName, market.id]
    );

    const { rows: [product] } = await client.query(
      `INSERT INTO products
         (name, price_kmf, price_eur, stock, inventory_model, is_active)
       VALUES ($1, $2, $3, $4, 'LEGACY_VARIANTS', TRUE)
       RETURNING id, stock`,
      [spec.productName, spec.totalKmf, spec.totalEur, spec.stockBefore]
    );

    const { rows: [order] } = await client.query(
      `INSERT INTO orders
         (reference, user_id, relais_id, market_id,
          total_kmf, total_eur, payment_mode, payment_status, status,
          recipient_id, tracking_phone, stripe_payment_id)
       VALUES
         ($1, NULL, $2, $3, $4, $5, 'stripe_eur', 'pending', 'pending',
          NULL, NULL, NULL)
       RETURNING *`,
      [spec.orderReference, relay.id, market.id, spec.totalKmf, spec.totalEur]
    );

    const { rows: [orderItem] } = await client.query(
      `INSERT INTO order_items
         (order_id, product_id, quantity, price_kmf, fulfillment_source)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [order.id, product.id, spec.quantity, spec.totalKmf, spec.fulfillmentSource]
    );

    await client.query('COMMIT');
    return {
      order,
      orderId: order.id,
      orderItemId: orderItem.id,
      productId: product.id,
      relayId: relay.id,
      stockBefore: Number(product.stock),
      reference: spec.orderReference,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function findSucceededEvent(stripe, paymentIntentId, startedAtUnix) {
  const list = await stripe.events.list({
    type: 'payment_intent.succeeded',
    created: { gte: Math.max(0, startedAtUnix - 5) },
    limit: 25,
  });
  return (list?.data || []).find(event => event?.data?.object?.id === paymentIntentId) || null;
}

async function waitForGolden({
  db,
  stripe,
  fixture,
  paymentIntentId,
  startedAtUnix,
  timeoutMs = 45000,
}) {
  const deadline = Date.now() + timeoutMs;
  let providerEvent = null;

  while (Date.now() < deadline) {
    providerEvent = providerEvent || await findSucceededEvent(stripe, paymentIntentId, startedAtUnix);

    const { rows: [order] } = await db.query(
      `SELECT id, reference, stripe_payment_id, payment_status, status, confirmed_at,
              user_id, recipient_id, tracking_phone
         FROM orders WHERE id = $1`,
      [fixture.orderId]
    );

    const { rows: [product] } = await db.query(
      'SELECT stock FROM products WHERE id = $1',
      [fixture.productId]
    );

    let processed = null;
    if (providerEvent) {
      const { rows } = await db.query(
        `SELECT stripe_event_id, event_type, payload_summary
           FROM stripe_events_processed
          WHERE stripe_event_id = $1
          LIMIT 1`,
        [providerEvent.id]
      );
      processed = rows[0] || null;
    }

    if (
      providerEvent &&
      processed &&
      order?.payment_status === 'paid' &&
      order?.status === 'ordered' &&
      String(order.stripe_payment_id) === String(paymentIntentId) &&
      Number(product?.stock) === fixture.stockBefore - 1
    ) {
      return { providerEvent, processed, order, product };
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const err = new Error('STRIPE_P4_TIMEOUT_WAITING_FOR_REAL_WEBHOOK_COMPOSITION');
  err.code = 'STRIPE_P4_TIMEOUT_WAITING_FOR_REAL_WEBHOOK_COMPOSITION';
  err.provider_event_seen = Boolean(providerEvent);
  throw err;
}

async function assertNoExternalPurchasing(db, fixture) {
  const { rows: [{ count }] } = await db.query(
    'SELECT COUNT(*)::int AS count FROM purchase_orders WHERE order_id = $1',
    [fixture.orderId]
  );
  if (Number(count) !== 0) {
    const err = new Error('STRIPE_P4_UNEXPECTED_PURCHASE_ORDER_CREATED');
    err.code = 'STRIPE_P4_UNEXPECTED_PURCHASE_ORDER_CREATED';
    throw err;
  }
}

async function cleanupFixture(db, fixture, providerEventId = null) {
  if (!fixture) return;
  const bestEffort = async (sql, params) => {
    try { await db.query(sql, params); } catch (_) { /* bounded cleanup */ }
  };

  await bestEffort('DELETE FROM notification_log WHERE order_ref = $1', [fixture.reference]);
  await bestEffort(
    `DELETE FROM client_notifications
      WHERE entity_type = 'order' AND entity_id::text = $1`,
    [String(fixture.orderId)]
  );
  await bestEffort(
    `DELETE FROM alerts WHERE entity_type = 'order' AND entity_id = $1`,
    [String(fixture.orderId)]
  );
  await bestEffort('DELETE FROM invoices WHERE order_id = $1', [fixture.orderId]);

  if (providerEventId) {
    await bestEffort(
      'DELETE FROM stripe_events_processed WHERE stripe_event_id = $1',
      [providerEventId]
    );
  }
  await bestEffort(
    `DELETE FROM stripe_events_processed
      WHERE payload_summary->>'order_id' = $1`,
    [String(fixture.orderId)]
  );

  await bestEffort(
    `DELETE FROM purchase_order_items
      WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = $1)`,
    [fixture.orderId]
  );
  await bestEffort('DELETE FROM purchase_orders WHERE order_id = $1', [fixture.orderId]);
  await bestEffort('DELETE FROM order_status_history WHERE order_id = $1', [fixture.orderId]);
  await bestEffort('DELETE FROM order_items WHERE order_id = $1', [fixture.orderId]);
  await bestEffort('DELETE FROM orders WHERE id = $1', [fixture.orderId]);
  await bestEffort('DELETE FROM products WHERE id = $1', [fixture.productId]);
  await bestEffort('DELETE FROM relais WHERE id = $1', [fixture.relayId]);
}

async function runStripeGoldenP4({ env = process.env, StripeCtor, dbModule } = {}) {
  assertP4Environment(env);

  if (env.STRIPE_P4_DATABASE_URL) {
    process.env.DATABASE_URL = env.STRIPE_P4_DATABASE_URL;
  }

  const Stripe = StripeCtor || require('stripe');
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const db = dbModule || require('../db');
  const { createStripeIntent } = require('../services/payment-stripe');

  const webhook = await preflightStripeWebhook(stripe, env);
  const spec = buildSafeFixtureSpec();
  let fixture = null;
  let providerEventId = null;
  let providerConfirmed = false;

  try {
    fixture = await createFixture(db, spec);

    await createStripeIntent(fixture.order, stripe, db);
    const paymentIntentId = String(
      (await db.query('SELECT stripe_payment_id FROM orders WHERE id = $1', [fixture.orderId]))
        .rows[0]?.stripe_payment_id || ''
    );
    if (!paymentIntentId) throw new Error('STRIPE_P4_PAYMENT_INTENT_ID_NOT_PERSISTED');

    const startedAtUnix = Math.floor(Date.now() / 1000);
    const confirmed = await stripe.paymentIntents.confirm(
      paymentIntentId,
      {
        payment_method: 'pm_card_visa',
        return_url: 'https://komerce.co/stripe-test-return',
      },
      { idempotencyKey: `stripe_p4_confirm_${fixture.orderId}` }
    );

    if (confirmed?.status !== 'succeeded') {
      const err = new Error('STRIPE_P4_PROVIDER_DID_NOT_SUCCEED');
      err.code = 'STRIPE_P4_PROVIDER_DID_NOT_SUCCEED';
      err.provider_status = confirmed?.status || null;
      throw err;
    }
    providerConfirmed = true;

    const golden = await waitForGolden({
      db,
      stripe,
      fixture,
      paymentIntentId,
      startedAtUnix,
    });
    providerEventId = golden.providerEvent.id;

    await new Promise(resolve => setTimeout(resolve, 1500));
    await assertNoExternalPurchasing(db, fixture);

    const proof = {
      provider: 'stripe',
      environment: 'TEST',
      stage: 'P4',
      verdict: 'PASS',
      webhook: {
        status: webhook.status,
        livemode: webhook.livemode,
        api_version: webhook.apiVersion,
      },
      order_reference: fixture.reference,
      payment_intent_ref: paymentIntentId,
      provider_event_ref: providerEventId,
      provider_payment_status: confirmed.status,
      komerce_payment_status: golden.order.payment_status,
      komerce_order_status: golden.order.status,
      exact_external_ref_persisted:
        String(golden.order.stripe_payment_id) === String(paymentIntentId),
      webhook_event_consumed:
        golden.processed?.event_type === 'payment_intent.succeeded',
      stock_before: fixture.stockBefore,
      stock_after: Number(golden.product.stock),
      stock_delta_exact:
        fixture.stockBefore - Number(golden.product.stock) === spec.quantity,
      no_user_contact: !golden.order.user_id && !golden.order.recipient_id && !golden.order.tracking_phone,
      fulfillment_source: spec.fulfillmentSource,
      external_purchase_order_count: 0,
      db_fixture_cleanup: 'scheduled',
      stripe_test_object_retained: true,
    };

    await cleanupFixture(db, fixture, providerEventId);
    proof.db_fixture_cleanup = 'completed';
    return proof;
  } catch (err) {
    // If Stripe has already succeeded but the webhook composition timed out,
    // keep the DB fixture for forensic replay: deleting it could turn a late
    // real webhook into an artificial "order not found".
    if (fixture && !providerConfirmed) {
      await cleanupFixture(db, fixture, providerEventId);
    }
    throw err;
  }
}

async function main() {
  if (!process.argv.includes('--execute')) {
    process.stderr.write(
      'STRIPE_P4_BLOCKED_EXECUTE_FLAG_REQUIRED\n' +
      `Set STRIPE_GOLDEN_P4_ACK=${ACK} and pass --execute only in Stripe TEST.\n`
    );
    process.exitCode = 2;
    return;
  }

  try {
    const proof = await runStripeGoldenP4();
    process.stdout.write(JSON.stringify(proof, null, 2) + '\n');
  } catch (err) {
    process.stderr.write(JSON.stringify({
      verdict: 'BLOCKED',
      code: err.code || err.message || 'STRIPE_P4_FAILED',
      provider_event_seen: err.provider_event_seen ?? undefined,
      provider_status: err.provider_status ?? undefined,
    }, null, 2) + '\n');
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(JSON.stringify({
      verdict: 'FATAL',
      code: err.code || err.message || String(err),
    }, null, 2) + '\n');
    process.exitCode = 1;
  });
}

module.exports = {
  ACK,
  REQUIRED_EVENTS,
  classifyStripeKey,
  resolveExpectedWebhookUrl,
  assertP4Environment,
  buildSafeFixtureSpec,
  eventEnabled,
  preflightStripeWebhook,
  runStripeGoldenP4,
};
