'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {
  STATUS,
  normalizeCatalogChangeEnvelope,
} = require('../../services/catalog-change-intake');

function base() {
  return {
    source: {
      provider: 'allegro',
      account_scope: 'seller:sandbox',
      source_ref: 'api:allegro',
    },
    method: 'PULL_EXACT',
    observed_at: '2026-09-23T08:30:00.000Z',
    subject: { product_ref: 'offer-1', unit_ref: 'unit-1' },
    facts: {
      stock_available: { status: STATUS.OBSERVED, value: 3 },
    },
  };
}

describe('catalog-change-intake', () => {
  test('keeps explicit stock zero distinct from UNKNOWN', () => {
    const zero = normalizeCatalogChangeEnvelope({
      ...base(),
      facts: { stock_available: { status: 'OBSERVED', value: 0 } },
    });
    expect(zero.facts.stock_available).toEqual({ status: 'OBSERVED', value: 0 });
    const unknown = normalizeCatalogChangeEnvelope({
      ...base(),
      facts: { stock_available: { status: 'UNKNOWN', reason: 'provider_timeout' } },
    });
    expect(unknown.facts.stock_available).toEqual({
      status: 'UNKNOWN', reason: 'provider_timeout',
    });
    expect(unknown).toMatchObject({
      authority: 'catalog_change_intake_only',
      application_status: 'NOT_EVALUATED',
    });
  });

  test('accepts push, feed, webhook, file and manual producers through one envelope', () => {
    for (const method of ['PULL_EXACT', 'CHANGE_FEED', 'WEBHOOK', 'FILE', 'MANUAL', 'API_PUSH']) {
      expect(normalizeCatalogChangeEnvelope({ ...base(), method }).method).toBe(method);
    }
  });

  test('supports several independent live catalog facts in one event', () => {
    const change = normalizeCatalogChangeEnvelope({
      ...base(),
      event_id: 'evt-1',
      facts: {
        stock_available: { status: 'OBSERVED', value: 1 },
        purchase_price: { status: 'OBSERVED', value: 29.9 },
        currency: { status: 'OBSERVED', value: 'PLN' },
        offer_status: { status: 'OBSERVED', value: 'ACTIVE' },
        media: { status: 'OBSERVED', value: [{ url: 'https://example.test/a.jpg' }] },
      },
    });
    expect(Object.keys(change.facts)).toEqual([
      'stock_available', 'purchase_price', 'currency', 'offer_status', 'media',
    ]);
    expect(change.event_id).toBe('evt-1');
  });

  test.each([
    [{ stock_available: { status: 'OBSERVED', value: -1 } }, /stock_available/],
    [{ stock_available: { status: 'UNKNOWN', value: 0, reason: 'x' } }, /UNKNOWN/],
    [{ stock_available: { status: 'UNKNOWN' } }, /reason/],
    [{ purchase_price: { status: 'OBSERVED', value: 0 } }, /purchase_price/],
    [{ unsupported: { status: 'OBSERVED', value: true } }, /unsupported catalog fact/],
  ])('refuses invalid or invented facts %#', (facts, expected) => {
    expect(() => normalizeCatalogChangeEnvelope({ ...base(), facts })).toThrow(expected);
  });

  test('confirmed removal is explicit and cannot be inferred from absence', () => {
    const removed = normalizeCatalogChangeEnvelope({
      ...base(),
      facts: {
        offer_status: { status: 'REMOVAL_CONFIRMED', value: 'ENDED' },
        is_active: { status: 'REMOVAL_CONFIRMED', value: false },
      },
    });
    expect(removed.facts.offer_status.status).toBe('REMOVAL_CONFIRMED');
    expect(() => normalizeCatalogChangeEnvelope({
      ...base(),
      facts: { stock_available: { status: 'REMOVAL_CONFIRMED', value: 0 } },
    })).toThrow(/REMOVAL_CONFIRMED/);
  });

  test('requires stable source identity, scoped subject and offset-aware time', () => {
    expect(() => normalizeCatalogChangeEnvelope({
      ...base(), source: { provider: 'allegro' },
    })).toThrow(/account_scope/);
    expect(() => normalizeCatalogChangeEnvelope({
      ...base(), subject: {},
    })).toThrow(/product_ref or subject.unit_ref/);
    expect(() => normalizeCatalogChangeEnvelope({
      ...base(), observed_at: '2026-09-23',
    })).toThrow(/offset-aware/);
  });
});
