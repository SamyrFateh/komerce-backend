'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {
  CAPABILITIES,
  normalizeProviderCapabilityDescriptor,
} = require('../../services/catalog-provider-capability-contract');

describe('catalog-provider-capability-contract', () => {
  test('keeps documented, authorized, implemented and proved as separate states', () => {
    const result = normalizeProviderCapabilityDescriptor({
      provider: 'allegro',
      environment: 'sandbox',
      account_scope: 'seller:test',
      capabilities: {
        exact_read: {
          documented: true, authorized: true, implemented: true, proved: true,
          scope: 'authorized seller offer',
        },
        change_feed: {
          documented: true, authorized: null, implemented: false, proved: false,
          scope: 'seller offers',
        },
      },
    });
    expect(result.capabilities.exact_read).toMatchObject({
      documented: true, authorized: true, implemented: true, proved: true,
    });
    expect(result.capabilities.change_feed).toMatchObject({
      documented: true, authorized: null, implemented: false, proved: false,
    });
    expect(result.capabilities.webhook).toEqual({
      documented: null, authorized: null, implemented: false, proved: false, scope: null,
    });
  });

  test('refuses to call an unimplemented capability proved', () => {
    expect(() => normalizeProviderCapabilityDescriptor({
      provider: 'x', environment: 'test',
      capabilities: { exact_read: { documented: true, implemented: false, proved: true } },
    })).toThrow(/must be implemented/);
  });

  test('refuses unsupported capability names', () => {
    expect(() => normalizeProviderCapabilityDescriptor({
      provider: 'x', environment: 'test',
      capabilities: { magic_sync: { documented: true } },
    })).toThrow(/unknown capability/);
  });
});


describe('GAP-4 — incoming catalog facts cannot grant outbound write or purchase authority', () => {
  test('the intake capability descriptor contains only read/receive operations', () => {
    expect(CAPABILITIES).toEqual([
      'discovery', 'exact_read', 'change_feed', 'webhook',
      'stock_read', 'price_read', 'offer_status_read', 'media_read',
    ]);
  });

  test.each([
    'stock_write', 'price_write', 'content_write', 'publication_write',
    'atomic_reservation', 'purchase',
  ])('refuses an outbound/execution capability: %s', capability => {
    expect(() => normalizeProviderCapabilityDescriptor({
      provider: 'allegro', environment: 'sandbox',
      capabilities: {
        [capability]: { documented: true, authorized: true, implemented: true, proved: true },
      },
    })).toThrow('unknown capability: ' + capability);
  });

  test('provider transport capability stays distinct from proof of a product fact', () => {
    const result = normalizeProviderCapabilityDescriptor({
      provider: 'allegro', environment: 'sandbox',
      capabilities: { webhook: {
        documented: true, authorized: null, implemented: false, proved: false,
      } },
    });
    expect(result.capabilities.webhook).toMatchObject({
      documented: true, authorized: null, implemented: false, proved: false,
    });
    expect(result.capabilities.stock_read).toMatchObject({
      documented: null, authorized: null, implemented: false, proved: false,
    });
  });
});
