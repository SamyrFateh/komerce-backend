'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { observationDelta } = require('../../services/sourcing-canonical-commercial-projection-core');
const { buildCanonicalUnitProjection } = require('../../services/sourcing-canonical-unit-projection');
const { buildCanonicalOfferProjection } = require('../../services/sourcing-canonical-offer-projection');

const row = (id, when, normalized) => ({
  canonical_entity_id: id, parent_entity_id: 'product-1',
  observation_id: id + when, source_id: 'api:example', source_ref: 'exact-1',
  observed_at: when, normalized,
});

test('detects exact stock transition 3 -> 0 without treating zero as missing', () => {
  const result = observationDelta([
    row('unit-1', '2026-09-20T10:00:00Z', { stock_available: 3 }),
    row('unit-1', '2026-09-20T10:01:00Z', { stock_available: 0 }),
  ], ['stock_available']);
  expect(result).toMatchObject({
    status: 'CHANGED', compared_fields: 1, unknown_fields: [],
    changes: [{ field: 'stock_available', before: 3, after: 0 }],
  });
});

test('missing or null new supplier fact means unknown, never withdrawal or zero', () => {
  const before = row('unit-1', '2026-09-20T10:00:00Z', { stock_available: 3 });
  for (const after of [{}, { stock_available: null }]) {
    const result = observationDelta([
      before, row('unit-1', '2026-09-20T10:01:00Z', after),
    ], ['stock_available']);
    expect(result).toMatchObject({
      status: 'UNKNOWN', changes: [], unknown_fields: ['stock_available'],
    });
  }
});

test('first sighting or newly observed fact is not silently an unchanged baseline', () => {
  const first = row('offer-1', '2026-09-20T10:00:00Z', {});
  const second = row('offer-1', '2026-09-20T10:01:00Z', { availability: 'available' });
  expect(observationDelta([second], ['availability']).status).toBe('FIRST_OBSERVATION');
  expect(observationDelta([first, second], ['availability'])).toMatchObject({
    status: 'UNKNOWN', newly_observed_fields: ['availability'], changes: [],
  });
});

test('same value and reordered object fields are not false positives', () => {
  const delta = observationDelta([
    row('offer-1', '2026-09-20T10:00:00Z', { purchase_price: 9.5, freight: { a: 1, b: 2 } }),
    row('offer-1', '2026-09-20T10:01:00Z', { purchase_price: 9.5, freight: { b: 2, a: 1 } }),
  ], ['purchase_price', 'freight']);
  expect(delta).toMatchObject({ status: 'UNCHANGED', changes: [], compared_fields: 2 });
});

test('canonical Unit projection exposes delta as shadow evidence without readiness decision', () => {
  const unit = buildCanonicalUnitProjection([
    row('unit-1', '2026-09-20T10:00:00Z', { stock_available: 3 }),
    row('unit-1', '2026-09-20T10:01:00Z', { stock_available: 0 }),
  ]);
  expect(unit.last_observation_delta).toMatchObject({
    status: 'CHANGED', changes: [expect.objectContaining({ field: 'stock_available', after: 0 })],
  });
  expect(unit.commandability.ready_now).toBe(false);
  expect(unit.authority).toBe('shadow_read_only');
});

test('canonical Offer projection exposes price drift but never changes a published price', () => {
  const offer = buildCanonicalOfferProjection([
    row('offer-1', '2026-09-20T10:00:00Z', { purchase_price: 10, currency: 'PLN' }),
    row('offer-1', '2026-09-20T10:01:00Z', { purchase_price: 11, currency: 'PLN' }),
  ]);
  expect(offer.last_observation_delta).toMatchObject({
    status: 'CHANGED', changes: [expect.objectContaining({ field: 'purchase_price', before: 10, after: 11 })],
  });
  expect(offer.authority).toBe('shadow_read_only');
});

test('two observations from different source instances never infer a supplier delta', () => {
  const a = row('offer-1', '2026-09-20T10:00:00Z', { stock_available: 3 });
  const b = { ...row('offer-1', '2026-09-20T10:01:00Z', { stock_available: 0 }), source_id: 'api:other-account' };
  expect(observationDelta([a, b], ['stock_available'])).toMatchObject({
    status: 'UNKNOWN', reason: 'SOURCE_SCOPE_CHANGED', changes: [],
  });
});
