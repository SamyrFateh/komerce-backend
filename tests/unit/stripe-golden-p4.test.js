'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  ACK,
  classifyStripeKey,
  resolveExpectedWebhookUrl,
  assertP4Environment,
  buildSafeFixtureSpec,
  preflightStripeWebhook,
} = require('../../scripts/stripe-golden-p4');

function baseEnv() {
  return {
    STRIPE_SECRET_KEY: 'sk_test_fake',
    STRIPE_WEBHOOK_SECRET: 'whsec_fake',
    STRIPE_MODE: 'TEST',
    STRIPE_GOLDEN_P4_ACK: ACK,
    DATABASE_URL: 'postgres://example.invalid/komerce',
    PUBLIC_BASE_URL: 'https://komerce-backend-production.up.railway.app',
  };
}

describe('stripe-golden-p4 guards', () => {
  test('classifies only explicit Stripe test/live key prefixes', () => {
    expect(classifyStripeKey('sk_test_x')).toBe('TEST');
    expect(classifyStripeKey('rk_test_x')).toBe('TEST');
    expect(classifyStripeKey('sk_live_x')).toBe('LIVE');
    expect(classifyStripeKey('rk_live_x')).toBe('LIVE');
    expect(classifyStripeKey('anything')).toBe('UNKNOWN');
  });

  test('hard-stops a live key', () => {
    expect(() => assertP4Environment({
      ...baseEnv(),
      STRIPE_SECRET_KEY: 'sk_live_never_execute',
    })).toThrow('STRIPE_P4_BLOCKED_TEST_KEY_REQUIRED');
  });

  test('hard-stops missing explicit operator acknowledgement', () => {
    const env = baseEnv();
    delete env.STRIPE_GOLDEN_P4_ACK;
    expect(() => assertP4Environment(env))
      .toThrow('STRIPE_P4_BLOCKED_EXPLICIT_ACK_REQUIRED');
  });

  test('hard-stops missing webhook secret', () => {
    const env = baseEnv();
    delete env.STRIPE_WEBHOOK_SECRET;
    expect(() => assertP4Environment(env))
      .toThrow('STRIPE_P4_BLOCKED_WEBHOOK_SECRET_REQUIRED');
  });

  test('hard-stops non TEST declared mode', () => {
    expect(() => assertP4Environment({
      ...baseEnv(),
      STRIPE_MODE: 'LIVE',
    })).toThrow('STRIPE_P4_BLOCKED_TEST_MODE_REQUIRED');
  });

  test('hard-stops missing DB connectivity', () => {
    const env = baseEnv();
    delete env.DATABASE_URL;
    expect(() => assertP4Environment(env))
      .toThrow('STRIPE_P4_BLOCKED_DATABASE_URL_REQUIRED');
  });

  test('accepts explicit TEST-only execution context', () => {
    expect(assertP4Environment(baseEnv())).toEqual({ keyMode: 'TEST' });
  });
});

describe('stripe-golden-p4 safe fixture contract', () => {
  test('fixture cannot contact a user or trigger supplier purchasing', () => {
    const spec = buildSafeFixtureSpec(
      new Date('2026-09-18T18:00:00.000Z'),
      'a1b2c3d4'
    );

    expect(spec.orderReference).toMatch(/^SP4-/);
    expect(spec.userId).toBeNull();
    expect(spec.recipientId).toBeNull();
    expect(spec.trackingPhone).toBeNull();
    expect(spec.fulfillmentSource).toBe('LOCAL_STOCK');
    expect(spec.totalEur).toBe(0.5);
    expect(spec.totalKmf).toBeGreaterThan(0);
    expect(spec.stockBefore).toBeGreaterThan(spec.quantity);
  });

  test('resolves webhook URL from public runtime context', () => {
    expect(resolveExpectedWebhookUrl({
      PUBLIC_BASE_URL: 'https://example.test/',
    })).toBe('https://example.test/api/payments/stripe/webhook');

    expect(resolveExpectedWebhookUrl({
      RAILWAY_PUBLIC_DOMAIN: 'backend.up.railway.app',
    })).toBe('https://backend.up.railway.app/api/payments/stripe/webhook');
  });

  test('preflight requires exactly one enabled TEST endpoint with required events', async () => {
    const stripe = {
      webhookEndpoints: {
        list: jest.fn().mockResolvedValue({
          data: [{
            url: 'https://example.test/api/payments/stripe/webhook',
            status: 'enabled',
            livemode: false,
            api_version: '2026-03-25.dahlia',
            enabled_events: [
              'payment_intent.succeeded',
              'payment_intent.payment_failed',
            ],
          }],
        }),
      },
    };

    await expect(preflightStripeWebhook(stripe, {
      PUBLIC_BASE_URL: 'https://example.test',
    })).resolves.toEqual({
      url: 'https://example.test/api/payments/stripe/webhook',
      status: 'enabled',
      livemode: false,
      apiVersion: '2026-03-25.dahlia',
    });
  });

  test('preflight fails closed on ambiguous endpoint set', async () => {
    const endpoint = {
      status: 'enabled',
      livemode: false,
      api_version: '2026-03-25.dahlia',
      enabled_events: [
        'payment_intent.succeeded',
        'payment_intent.payment_failed',
      ],
    };
    const stripe = {
      webhookEndpoints: {
        list: jest.fn().mockResolvedValue({
          data: [
            { ...endpoint, url: 'https://a.test/api/payments/stripe/webhook' },
            { ...endpoint, url: 'https://b.test/api/payments/stripe/webhook' },
          ],
        }),
      },
    };

    await expect(preflightStripeWebhook(stripe, {}))
      .rejects.toMatchObject({
        code: 'STRIPE_P4_BLOCKED_WEBHOOK_NOT_EXACT_SINGLE_MATCH',
      });
  });
});
