'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {
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
