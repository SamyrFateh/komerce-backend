/**
 * @komerce-arch
 * @role          ebay-sandbox-browse-proof-test
 * @domain        external-provider-contracts
 * @layer         test
 * @criticality   high
 */
'use strict';

const {
  TOKEN_URL,
  configuration,
  requestApplicationToken,
  runEbayBrowseReadOnlyProof,
  readThrough,
} = require('../../scripts/ebay-sandbox-browse-proof');
const { assertThrough } = require('../../scripts/provider-contract-proof');

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(payload),
  };
}

function baseEnv(overrides = {}) {
  return {
    EBAY_CLIENT_ID: 'test-client',
    EBAY_CLIENT_SECRET: 'test-credential',
    EBAY_ENV: 'sandbox',
    EBAY_MARKETPLACE_ID: 'EBAY_US',
    EBAY_ITEM_ID: 'v1|123456789012|0',
    ...overrides,
  };
}

function itemPayload(itemId = 'v1|123456789012|0') {
  return {
    itemId,
    legacyItemId: '123456789012',
    title: 'Komerce Sandbox Item',
    price: { value: '29.90', currency: 'USD' },
    estimatedAvailabilities: [{
      estimatedAvailabilityStatus: 'IN_STOCK',
      estimatedRemainingQuantity: 10,
    }],
    seller: { username: 'sandbox-seller' },
    itemEndDate: '2026-10-01T00:00:00.000Z',
    shippingOptions: [{ shippingCost: { value: '5.00', currency: 'USD' } }],
  };
}

function successfulFetch() {
  return jest.fn(async url => {
    const href = String(url);
    if (href === TOKEN_URL) {
      return response(200, {
        access_token: 'opaque-test-token',
        token_type: 'Application Access Token',
        expires_in: 7200,
      });
    }
    if (href.includes('/item/v1%7C123456789012%7C0')) {
      return response(200, itemPayload());
    }
    throw new Error(`unexpected URL ${href}`);
  });
}

describe('ebay-sandbox-browse-proof', () => {
  test('configuration remains sandbox-only and requires a discovery target', () => {
    expect(configuration(baseEnv())).toEqual(expect.objectContaining({
      environment: 'SANDBOX',
      marketplace: 'EBAY_US',
      credentialsConfigured: true,
      sandboxSelected: true,
      discoveryConfigured: true,
      itemId: 'v1|123456789012|0',
    }));
    expect(configuration({
      EBAY_CLIENT_ID: 'id',
      EBAY_CLIENT_SECRET: 'credential',
      EBAY_ENV: 'sandbox',
    }).discoveryConfigured).toBe(false);
  });

  test('rejects malformed RESTful item identity before any provider call', () => {
    expect(() => configuration(baseEnv({ EBAY_ITEM_ID: '123456789012' })))
      .toThrow('EBAY_ITEM_ID_INVALID');
  });

  test('requests application OAuth token with client-credentials scope', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, {
      access_token: 'opaque-token',
      token_type: 'Application Access Token',
      expires_in: 7200,
    }));
    const token = await requestApplicationToken({
      clientId: 'client',
      clientSecret: 'credential',
      fetchImpl,
    });

    expect(token).toEqual({
      token: 'opaque-token',
      token_type: 'Application Access Token',
      expires_in: 7200,
    });
    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(TOKEN_URL);
    expect(options.method).toBe('POST');
    expect(options.body).toContain('grant_type=client_credentials');
    expect(options.body).toContain('scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope');
    expect(options.headers.Authorization).toMatch(/^Basic /);
  });

  test('passes P0 and P1 only after exact item read-back and native money', async () => {
    const result = await runEbayBrowseReadOnlyProof({
      env: baseEnv(),
      fetchImpl: successfulFetch(),
    });

    expect(result.report.conversation.status).toBe('PASS');
    expect(result.report.stages.find(stage => stage.id === 'P0').status).toBe('PASS');
    expect(result.report.stages.find(stage => stage.id === 'P1').status).toBe('PASS');
    expect(() => assertThrough(result.proof, 'P1')).not.toThrow();
    expect(result.diagnostics.exact_item).toEqual(expect.objectContaining({
      item_id: 'v1|123456789012|0',
      price_value: '29.90',
      price_currency: 'USD',
      estimated_remaining_quantity: 10,
    }));
  });

  test('supports bounded search then exact getItem', async () => {
    const fetchImpl = jest.fn(async url => {
      const href = String(url);
      if (href === TOKEN_URL) {
        return response(200, {
          access_token: 'opaque-token',
          token_type: 'Application Access Token',
          expires_in: 7200,
        });
      }
      if (href.includes('/item_summary/search')) {
        expect(href).toContain('limit=3');
        return response(200, {
          total: 1,
          itemSummaries: [{
            itemId: 'v1|123456789012|0',
            title: 'Komerce Sandbox Item',
            price: { value: '29.90', currency: 'USD' },
          }],
        });
      }
      if (href.includes('/item/v1%7C123456789012%7C0')) {
        return response(200, itemPayload());
      }
      throw new Error(`unexpected URL ${href}`);
    });

    const result = await runEbayBrowseReadOnlyProof({
      env: baseEnv({
        EBAY_ITEM_ID: '',
        EBAY_SEARCH_QUERY: 'komerce sandbox',
        EBAY_SEARCH_LIMIT: '3',
      }),
      fetchImpl,
    });

    expect(result.diagnostics.discovery_target).toBe('bounded_search');
    expect(result.diagnostics.search_result_count).toBe(1);
    expect(result.diagnostics.selected_item_id).toBe('v1|123456789012|0');
    expect(() => assertThrough(result.proof, 'P1')).not.toThrow();
  });

  test('blocks at P0 without credentials and never calls eBay', async () => {
    const fetchImpl = jest.fn();
    const result = await runEbayBrowseReadOnlyProof({
      env: { EBAY_ENV: 'sandbox', EBAY_ITEM_ID: 'v1|123456789012|0' },
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.report.conversation.status).toBe('PASS');
    expect(() => assertThrough(result.proof, 'P0'))
      .toThrow('PROVIDER_CONTRACT_BLOCKED_EBAY_P0_SANDBOX_KEYSET_CONFIGURED');
  });



  test('blocks at P0 when marketplace is missing and never calls eBay', async () => {
    const fetchImpl = jest.fn();
    const result = await runEbayBrowseReadOnlyProof({
      env: baseEnv({ EBAY_MARKETPLACE_ID: '' }),
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(() => assertThrough(result.proof, 'P0'))
      .toThrow('PROVIDER_CONTRACT_BLOCKED_EBAY_P0_MARKETPLACE_CONFIGURED');
  });

  test('blocks at P0 when Railway points to production credentials', async () => {
    const fetchImpl = jest.fn();
    const result = await runEbayBrowseReadOnlyProof({
      env: baseEnv({ EBAY_ENV: 'production' }),
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(() => assertThrough(result.proof, 'P0'))
      .toThrow('PROVIDER_CONTRACT_BLOCKED_EBAY_P0_SANDBOX_ENVIRONMENT_SELECTED');
  });

  test('blocks P1 on OAuth rejection with bounded error evidence', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(401, {
      errors: [{ errorId: 1001, message: 'provider detail omitted' }],
    }));
    const result = await runEbayBrowseReadOnlyProof({ env: baseEnv(), fetchImpl });

    expect(() => assertThrough(result.proof, 'P1'))
      .toThrow('PROVIDER_CONTRACT_BLOCKED_EBAY_P1_APPLICATION_TOKEN_ACCEPTED');
    expect(result.diagnostics.token_error).toEqual({
      message: 'EBAY_OAUTH_FAILED_401',
      diagnostic: { status: 401, provider_error_ids: ['1001'] },
    });
    expect(JSON.stringify(result)).not.toContain('provider detail omitted');
  });

  test('proof output never contains configured credential or OAuth token', async () => {
    const env = baseEnv();
    const result = await runEbayBrowseReadOnlyProof({ env, fetchImpl: successfulFetch() });
    const serialized = JSON.stringify({ report: result.report, diagnostics: result.diagnostics });

    expect(serialized).not.toContain(env.EBAY_CLIENT_SECRET);
    expect(serialized).not.toContain('opaque-test-token');
  });

  test('CLI is deliberately limited to P0 or P1', () => {
    expect(readThrough([])).toBe('P1');
    expect(readThrough(['--through=P0'])).toBe('P0');
    expect(() => readThrough(['--through=P2'])).toThrow(/Usage:/);
  });
});
