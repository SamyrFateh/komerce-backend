#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          stripe-provider-contract-proof
 * @domain        external-provider-contracts
 * @layer         script
 * @criticality   high
 * @inputs        Stripe credentials/config + read-only Stripe API
 * @outputs       bounded sanitized Conversation/P0/P1 proof
 * @depends       stripe, scripts/provider-contract-proof.js
 * @used-by       operator audit, Stripe external-provider qualification
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md
 * @impact-areas  external-provider-contracts, payments
 */
'use strict';

const {
  buildConversation,
  buildProof,
  assertThrough,
  summary,
} = require('./provider-contract-proof');

const REQUIRED_EVENTS = Object.freeze([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
]);

function classifyStripeKey(key) {
  const value = String(key || '');
  if (/^(sk|rk)_test_/.test(value)) return 'TEST';
  if (/^(sk|rk)_live_/.test(value)) return 'LIVE';
  return 'UNKNOWN';
}

function expectedWebhookUrl(env) {
  if (env.STRIPE_WEBHOOK_URL) return String(env.STRIPE_WEBHOOK_URL).trim();

  const explicitBase = String(
    env.PUBLIC_BASE_URL ||
    env.KOMERCE_API_URL ||
    ''
  ).trim().replace(/\/+$/, '');
  if (explicitBase) return explicitBase + '/api/payments/stripe/webhook';

  const railwayDomain = String(env.RAILWAY_PUBLIC_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return railwayDomain
    ? 'https://' + railwayDomain + '/api/payments/stripe/webhook'
    : null;
}

function eventEnabled(endpoint, eventName) {
  const enabled = Array.isArray(endpoint && endpoint.enabled_events)
    ? endpoint.enabled_events
    : [];
  return enabled.includes('*') || enabled.includes(eventName);
}

function evidence(text) {
  return String(text || '').slice(0, 220);
}

async function runStripeReadOnlyProof(options = {}) {
  const env = options.env || process.env;
  const stripe = options.stripeClient;
  if (!stripe) throw new Error('STRIPE_PROOF_CLIENT_REQUIRED');

  const keyMode = classifyStripeKey(env.STRIPE_SECRET_KEY);
  const expectedUrl = expectedWebhookUrl(env);

  let balanceOk = false;
  let paymentIntentListOk = false;
  let webhookListOk = false;
  let webhookEndpoints = [];

  try {
    await stripe.balance.retrieve();
    balanceOk = true;
  } catch (_) {
    balanceOk = false;
  }

  try {
    await stripe.paymentIntents.list({ limit: 1 });
    paymentIntentListOk = true;
  } catch (_) {
    paymentIntentListOk = false;
  }

  try {
    const listed = await stripe.webhookEndpoints.list({ limit: 100 });
    webhookEndpoints = Array.isArray(listed && listed.data) ? listed.data : [];
    webhookListOk = true;
  } catch (_) {
    webhookEndpoints = [];
    webhookListOk = false;
  }

  const exactMatches = expectedUrl
    ? webhookEndpoints.filter(endpoint => String(endpoint.url || '') === expectedUrl)
    : [];
  const endpoint = exactMatches.length === 1 ? exactMatches[0] : null;

  const endpointEnabled = Boolean(endpoint && endpoint.status === 'enabled');
  const endpointEventsOk = Boolean(
    endpoint && REQUIRED_EVENTS.every(eventName => eventEnabled(endpoint, eventName))
  );
  const expectedLivemode = keyMode === 'LIVE' ? true : keyMode === 'TEST' ? false : null;
  const endpointEnvironmentOk = Boolean(
    endpoint && expectedLivemode !== null && endpoint.livemode === expectedLivemode
  );

  const explicitApiVersion = String(env.STRIPE_API_VERSION || '').trim() || null;
  const endpointApiVersion = endpoint && typeof endpoint.api_version === 'string' && endpoint.api_version
    ? endpoint.api_version
    : null;
  const effectiveApiVersion = explicitApiVersion || endpointApiVersion || null;
  const apiVersionKnown = Boolean(effectiveApiVersion);

  const conversation = buildConversation({
    operation: 'STRIPE_PAYMENT_CONFIRMATION',
    phases: {
      EXPECTS: [
        { id: 'ONE_ORDER_ONE_PAYMENT_REFERENCE', state: 'KNOWN', evidence: 'PaymentIntent binds Komerce order' },
        { id: 'PROVIDER_PAYMENT_CONFIRMATION', state: 'KNOWN', evidence: 'signed webhook or server-side read-back' },
      ],
      REQUIRES: [
        { id: 'SECRET_KEY_CONFIGURED', state: env.STRIPE_SECRET_KEY ? 'KNOWN' : 'UNKNOWN', evidence: env.STRIPE_SECRET_KEY ? 'configured' : null },
        { id: 'WEBHOOK_SECRET_CONFIGURED', state: env.STRIPE_WEBHOOK_SECRET ? 'KNOWN' : 'UNKNOWN', evidence: env.STRIPE_WEBHOOK_SECRET ? 'configured' : null },
        { id: 'ENVIRONMENT_IDENTIFIED', state: keyMode === 'UNKNOWN' ? 'UNKNOWN' : 'KNOWN', evidence: keyMode === 'UNKNOWN' ? null : keyMode },
        { id: 'EXPECTED_WEBHOOK_URL', state: expectedUrl ? 'KNOWN' : 'UNKNOWN', evidence: expectedUrl ? 'configured' : null },
        { id: 'EFFECTIVE_API_VERSION', state: apiVersionKnown ? 'KNOWN' : 'UNKNOWN', evidence: apiVersionKnown ? effectiveApiVersion : null },
      ],
      SENDS: [
        { id: 'READ_BALANCE', state: 'KNOWN', evidence: 'read-only' },
        { id: 'LIST_PAYMENT_INTENTS_LIMIT_1', state: 'KNOWN', evidence: 'read-only bounded' },
        { id: 'LIST_WEBHOOK_ENDPOINTS_LIMIT_100', state: 'KNOWN', evidence: 'read-only bounded' },
      ],
      RECEIVES: [
        { id: 'BALANCE_READ_RESULT', state: balanceOk ? 'KNOWN' : 'UNKNOWN', evidence: balanceOk ? 'authentication accepted' : null },
        { id: 'PAYMENT_INTENT_LIST_RESULT', state: paymentIntentListOk ? 'KNOWN' : 'UNKNOWN', evidence: paymentIntentListOk ? 'bounded list accepted' : null },
        { id: 'WEBHOOK_ENDPOINT_LIST_RESULT', state: webhookListOk ? 'KNOWN' : 'UNKNOWN', evidence: webhookListOk ? 'bounded list accepted' : null },
      ],
      CONFIRMS: [
        { id: 'WEBHOOK_MATCH_COUNT', state: webhookListOk && expectedUrl ? 'DERIVED' : 'UNKNOWN', evidence: webhookListOk && expectedUrl ? evidence('matches=' + exactMatches.length) : null },
        { id: 'WEBHOOK_ENABLED_STATE', state: endpoint ? 'DERIVED' : 'UNKNOWN', evidence: endpoint ? evidence('enabled=' + endpointEnabled) : null },
        { id: 'WEBHOOK_EVENT_COVERAGE', state: endpoint ? 'DERIVED' : 'UNKNOWN', evidence: endpoint ? evidence('required_events=' + endpointEventsOk) : null },
        { id: 'WEBHOOK_ENVIRONMENT_MATCH', state: endpoint && expectedLivemode !== null ? 'DERIVED' : 'UNKNOWN', evidence: endpoint && expectedLivemode !== null ? evidence('environment_match=' + endpointEnvironmentOk) : null },
      ],
      EXPOSES: [
        { id: 'AUTH_CONNECTIVITY_VERDICT', state: 'DERIVED', evidence: evidence('balance=' + balanceOk + ';payment_intents=' + paymentIntentListOk) },
        { id: 'WEBHOOK_READINESS_VERDICT', state: webhookListOk && expectedUrl ? 'DERIVED' : 'UNKNOWN', evidence: webhookListOk && expectedUrl ? evidence('exact_match=' + (exactMatches.length === 1)) : null },
      ],
    },
  });

  const proof = buildProof({
    provider: 'STRIPE',
    environment: keyMode,
    conversation,
    stages: {
      P0: [
        { id: 'SECRET_KEY_CONFIGURED', pass: Boolean(env.STRIPE_SECRET_KEY), evidence: env.STRIPE_SECRET_KEY ? 'configured' : 'missing' },
        { id: 'WEBHOOK_SECRET_CONFIGURED', pass: Boolean(env.STRIPE_WEBHOOK_SECRET), evidence: env.STRIPE_WEBHOOK_SECRET ? 'configured' : 'missing' },
        { id: 'ENVIRONMENT_IDENTIFIED', pass: keyMode !== 'UNKNOWN', evidence: keyMode },
        { id: 'EXPECTED_WEBHOOK_URL_KNOWN', pass: Boolean(expectedUrl), evidence: expectedUrl ? 'configured' : 'missing' },
        { id: 'WEBHOOK_LIST_READABLE', pass: webhookListOk, evidence: webhookListOk ? 'readable' : 'unreadable' },
        { id: 'WEBHOOK_EXACT_SINGLE_MATCH', pass: exactMatches.length === 1, evidence: evidence('matches=' + exactMatches.length) },
        { id: 'WEBHOOK_ENABLED', pass: endpointEnabled, evidence: evidence('enabled=' + endpointEnabled) },
        { id: 'WEBHOOK_REQUIRED_EVENTS', pass: endpointEventsOk, evidence: evidence('events_ok=' + endpointEventsOk) },
        { id: 'WEBHOOK_ENVIRONMENT_MATCH', pass: endpointEnvironmentOk, evidence: evidence('environment_match=' + endpointEnvironmentOk) },
        { id: 'EFFECTIVE_API_VERSION_KNOWN', pass: apiVersionKnown, evidence: effectiveApiVersion || 'unknown' },
      ],
      P1: [
        { id: 'STRIPE_AUTH_READABLE', pass: balanceOk, evidence: balanceOk ? 'balance.retrieve accepted' : 'balance.retrieve failed' },
        { id: 'PAYMENT_INTENTS_LIST_READABLE', pass: paymentIntentListOk, evidence: paymentIntentListOk ? 'limit=1 accepted' : 'list failed' },
        { id: 'WEBHOOK_ENDPOINTS_LIST_READABLE', pass: webhookListOk, evidence: webhookListOk ? 'limit=100 accepted' : 'list failed' },
      ],
    },
  });

  return {
    proof,
    report: summary(proof),
    diagnostics: {
      environment: keyMode,
      expected_webhook_url_known: Boolean(expectedUrl),
      webhook_endpoint_count: webhookEndpoints.length,
      exact_webhook_match_count: exactMatches.length,
      exact_webhook_enabled: endpointEnabled,
      required_events_present: endpointEventsOk,
      webhook_environment_match: endpointEnvironmentOk,
      api_version_known: apiVersionKnown,
      api_version_source: explicitApiVersion ? 'explicit_env' : endpointApiVersion ? 'webhook_endpoint' : 'unknown',
      balance_readable: balanceOk,
      payment_intents_list_readable: paymentIntentListOk,
      webhook_endpoints_list_readable: webhookListOk,
    },
  };
}

async function main(argv = process.argv.slice(2)) {
  const throughArg = argv.find(arg => arg.startsWith('--through='));
  const through = throughArg ? throughArg.slice('--through='.length).toUpperCase() : 'P1';

  if (!process.env.STRIPE_SECRET_KEY) {
    process.stderr.write('STRIPE_PROOF_BLOCKED_SECRET_KEY_MISSING\n');
    process.exitCode = 2;
    return;
  }

  const stripeOptions = {};
  if (process.env.STRIPE_API_VERSION) stripeOptions.apiVersion = process.env.STRIPE_API_VERSION;
  const Stripe = require('stripe');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, stripeOptions);

  const result = await runStripeReadOnlyProof({ stripeClient: stripe, env: process.env });
  let blocked = null;
  try {
    assertThrough(result.proof, through);
  } catch (err) {
    blocked = err.message;
    process.exitCode = 2;
  }

  process.stdout.write(JSON.stringify({
    ...result.report,
    diagnostics: result.diagnostics,
    through,
    blocked,
  }, null, 2) + '\n');
}

if (require.main === module) {
  main().catch(err => {
    process.stderr.write('STRIPE_PROOF_FATAL_' + String(err && err.message || err) + '\n');
    process.exitCode = 1;
  });
}

module.exports = {
  REQUIRED_EVENTS,
  classifyStripeKey,
  expectedWebhookUrl,
  eventEnabled,
  runStripeReadOnlyProof,
};
