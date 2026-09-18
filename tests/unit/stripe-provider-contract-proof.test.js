/**
 * @komerce-arch
 * @role          stripe-provider-contract-proof-test
 * @domain        external-provider-contracts
 * @layer         test
 * @criticality   high
 */
'use strict';

const {
  classifyStripeKey,
  expectedWebhookUrl,
  runStripeReadOnlyProof,
} = require('../../scripts/stripe-provider-contract-proof');
const { assertThrough } = require('../../scripts/provider-contract-proof');

function fakeStripe() {
  return {
    balance: { retrieve: jest.fn().mockResolvedValue({ object: 'balance' }) },
    paymentIntents: { list: jest.fn().mockResolvedValue({ object: 'list', data: [] }) },
    webhookEndpoints: {
      list: jest.fn().mockResolvedValue({
        object: 'list',
        data: [{
          url: 'https://komerce.co/api/payments/stripe/webhook',
          status: 'enabled',
          livemode: false,
          api_version: '2024-06-20',
          enabled_events: [
            'payment_intent.succeeded',
            'payment_intent.payment_failed',
          ],
        }],
      }),
    },
  };
}

function baseEnv() {
  return {
    STRIPE_SECRET_KEY: 'sk_test_not-a-real-secret',
    STRIPE_WEBHOOK_SECRET: 'whsec_not-a-real-secret',
    KOMERCE_API_URL: 'https://komerce.co',
  };
}

describe('stripe-provider-contract-proof', () => {
  test('classifies key mode without exposing the key', () => {
    expect(classifyStripeKey('sk_test_x')).toBe('TEST');
    expect(classifyStripeKey('rk_test_x')).toBe('TEST');
    expect(classifyStripeKey('sk_live_x')).toBe('LIVE');
    expect(classifyStripeKey('rk_live_x')).toBe('LIVE');
    expect(classifyStripeKey('other')).toBe('UNKNOWN');
  });

  test('derives canonical webhook URL from explicit/public runtime context', () => {
    expect(expectedWebhookUrl({ PUBLIC_BASE_URL: 'https://komerce.co/' }))
      .toBe('https://komerce.co/api/payments/stripe/webhook');
    expect(expectedWebhookUrl({ KOMERCE_API_URL: 'https://komerce.co/' }))
      .toBe('https://komerce.co/api/payments/stripe/webhook');
    expect(expectedWebhookUrl({ RAILWAY_PUBLIC_DOMAIN: 'komerce-backend-production.up.railway.app' }))
      .toBe('https://komerce-backend-production.up.railway.app/api/payments/stripe/webhook');
    expect(expectedWebhookUrl({
      STRIPE_WEBHOOK_URL: 'https://custom.example/stripe',
      PUBLIC_BASE_URL: 'https://ignored.example',
    })).toBe('https://custom.example/stripe');
  });

  test('passes Conversation + P0 + P1 for complete read-only test-mode contract', async () => {
    const result = await runStripeReadOnlyProof({ stripeClient: fakeStripe(), env: baseEnv() });
    expect(result.report.conversation.status).toBe('PASS');
    expect(result.report.stages.find(s => s.id === 'P0').status).toBe('PASS');
    expect(result.report.stages.find(s => s.id === 'P1').status).toBe('PASS');
    expect(() => assertThrough(result.proof, 'P1')).not.toThrow();
  });

  test('fails closed when exact webhook endpoint is absent', async () => {
    const stripe = fakeStripe();
    stripe.webhookEndpoints.list.mockResolvedValueOnce({ data: [] });
    const result = await runStripeReadOnlyProof({ stripeClient: stripe, env: baseEnv() });
    expect(result.diagnostics.exact_webhook_match_count).toBe(0);
    expect(() => assertThrough(result.proof, 'P0'))
      .toThrow(/PROVIDER_CONVERSATION_BLOCKED_STRIPE_/);
  });

  test('fails closed when webhook environment disagrees with key mode', async () => {
    const stripe = fakeStripe();
    stripe.webhookEndpoints.list.mockResolvedValueOnce({
      data: [{
        url: 'https://komerce.co/api/payments/stripe/webhook',
        status: 'enabled',
        livemode: true,
        api_version: '2024-06-20',
        enabled_events: ['payment_intent.succeeded', 'payment_intent.payment_failed'],
      }],
    });
    const result = await runStripeReadOnlyProof({ stripeClient: stripe, env: baseEnv() });
    expect(() => assertThrough(result.proof, 'P0'))
      .toThrow('PROVIDER_CONTRACT_BLOCKED_STRIPE_P0_WEBHOOK_ENVIRONMENT_MATCH');
  });

  test('fails closed when effective API version is unknown', async () => {
    const stripe = fakeStripe();
    stripe.webhookEndpoints.list.mockResolvedValueOnce({
      data: [{
        url: 'https://komerce.co/api/payments/stripe/webhook',
        status: 'enabled',
        livemode: false,
        api_version: null,
        enabled_events: ['payment_intent.succeeded', 'payment_intent.payment_failed'],
      }],
    });
    const result = await runStripeReadOnlyProof({ stripeClient: stripe, env: baseEnv() });
    expect(result.diagnostics.api_version_known).toBe(false);
    expect(() => assertThrough(result.proof, 'P0'))
      .toThrow('PROVIDER_CONVERSATION_BLOCKED_STRIPE_REQUIRES_EFFECTIVE_API_VERSION');
  });

  test('never emits configured secrets', async () => {
    const env = baseEnv();
    const result = await runStripeReadOnlyProof({ stripeClient: fakeStripe(), env });
    const serialized = JSON.stringify({ report: result.report, diagnostics: result.diagnostics });
    expect(serialized).not.toContain(env.STRIPE_SECRET_KEY);
    expect(serialized).not.toContain(env.STRIPE_WEBHOOK_SECRET);
  });

  test('blocks if direct read-only Stripe access fails', async () => {
    const stripe = fakeStripe();
    stripe.balance.retrieve.mockRejectedValueOnce(new Error('auth failed'));
    const result = await runStripeReadOnlyProof({ stripeClient: stripe, env: baseEnv() });
    expect(result.report.conversation.status).toBe('BLOCKED');
    expect(() => assertThrough(result.proof, 'P1'))
      .toThrow(/PROVIDER_CONVERSATION_BLOCKED_STRIPE_RECEIVES_BALANCE_READ_RESULT/);
  });
});
