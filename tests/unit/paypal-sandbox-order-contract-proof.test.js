'use strict';

const { main } = require('../../scripts/paypal-sandbox-order-contract-proof');

const sandboxEnv = {
  KOMERCE_ENV: 'production',
  PAYPAL_ENV: 'sandbox',
  PAYPAL_CLIENT_ID: 'sandbox-client-test-only',
  PAYPAL_CLIENT_SECRET: 'sandbox-secret-test-only',
};

describe('PayPal P1 one-off Railway Sandbox proof', () => {
  let write;
  let previousExitCode;

  beforeEach(() => {
    previousExitCode = process.exitCode;
    process.exitCode = 0;
    write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    write.mockRestore();
    process.exitCode = previousExitCode;
  });

  function output() {
    expect(write).toHaveBeenCalledTimes(1);
    return JSON.parse(String(write.mock.calls[0][0]));
  }

  test('production runtime refuses by default before any external call', async () => {
    const fetchImpl = jest.fn();
    await main({ env: sandboxEnv, fetchImpl });
    expect(output()).toMatchObject({
      provider: 'paypal', status: 'BLOCKED', reason_code: 'RUNTIME_PRODUCTION_REFUSED',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('explicit runtime opt-in still refuses non-sandbox PayPal env before any call', async () => {
    const fetchImpl = jest.fn();
    await main({
      env: {
        ...sandboxEnv,
        KOMERCE_PAYPAL_P1_ALLOW_PRODUCTION_RUNTIME_SANDBOX: '1',
        PAYPAL_ENV: 'production',
      },
      fetchImpl,
    });
    expect(output()).toMatchObject({ status: 'BLOCKED', reason_code: 'PAYPAL_SANDBOX_REQUIRED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('non-opt-in flag values including true are refused', async () => {
    const fetchImpl = jest.fn();
    await main({
      env: { ...sandboxEnv, KOMERCE_PAYPAL_P1_ALLOW_PRODUCTION_RUNTIME_SANDBOX: 'true' },
      fetchImpl,
    });
    expect(output()).toMatchObject({ status: 'BLOCKED', reason_code: 'RUNTIME_PRODUCTION_REFUSED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('explicit opt-in makes exactly OAuth, Sandbox Order POST and exact GET, never capture', async () => {
    let capturedReference;
    const fetchImpl = jest.fn(async (url, opts) => {
      expect(url).toMatch(/^https:\/\/api-m\.sandbox\.paypal\.com\//);
      expect(url).not.toMatch(/capture|refund/);
      if (url.endsWith('/v1/oauth2/token')) {
        expect(opts.method).toBe('POST');
        return { ok: true, status: 200, json: async () => ({ access_token: 'fake-bearer-test' }) };
      }
      if (url.endsWith('/v2/checkout/orders')) {
        expect(opts.method).toBe('POST');
        expect(opts.headers['PayPal-Request-Id']).toMatch(/^komerce-p1-create-/);
        const b = JSON.parse(opts.body);
        capturedReference = b.purchase_units[0].reference_id;
        expect(b.purchase_units[0].amount).toEqual({ currency_code: 'EUR', value: '1.00' });
        return { ok: true, status: 201, json: async () => ({ id: 'ORDER-P1-123', status: 'CREATED' }) };
      }
      expect(url).toBe('https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-P1-123');
      expect(opts.method).toBe('GET');
      return {
        ok: true, status: 200, json: async () => ({
          id: 'ORDER-P1-123', status: 'CREATED',
          purchase_units: [{
            reference_id: capturedReference,
            amount: { currency_code: 'EUR', value: '1.00' },
          }],
        }),
      };
    });
    await main({
      env: {
        ...sandboxEnv,
        KOMERCE_PAYPAL_P1_ALLOW_PRODUCTION_RUNTIME_SANDBOX: '1',
      },
      fetchImpl,
      now: () => 1700000000000,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(output()).toMatchObject({
      status: 'PASS',
      reason_code: 'PAYPAL_SANDBOX_ORDER_CREATE_AND_EXACT_READBACK_PROVED',
      readback_confirmed: true,
      capture_attempted: false,
    });
    expect(process.exitCode).toBe(0);
  });
});
