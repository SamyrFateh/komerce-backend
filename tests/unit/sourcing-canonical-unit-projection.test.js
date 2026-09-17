'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { buildCanonicalUnitProjection } = require('../../services/sourcing-canonical-unit-projection');

const row = (id, ref, time, normalized = {}) => ({
  canonical_entity_id: id, parent_entity_id: 'offer-1', observation_id: id + time,
  source_id: 'cj:account-a', adapter_type: 'cj', source_ref: ref, observed_at: time, normalized,
});

test('même Offer et plusieurs refs donnent plusieurs Units', () => {
  const a = buildCanonicalUnitProjection([row('unit-1', 'vid-1', '2026-01-01', { option_values: { color: 'Black', size: 'M' } })]);
  const b = buildCanonicalUnitProjection([row('unit-2', 'vid-2', '2026-01-01', { option_values: { color: 'Black', size: 'M' } })]);
  expect(a.canonical_offer_id).toBe(b.canonical_offer_id);
  expect(a.canonical_unit_id).not.toBe(b.canonical_unit_id);
  expect(a.identity.deterministic_refs[0].value).not.toBe(b.identity.deterministic_refs[0].value);
});

test('même ref déterministe observée plusieurs fois garde une Unit', () => {
  const unit = buildCanonicalUnitProjection([
    row('unit-1', 'vid-1', '2026-01-01', { stock_available: 9 }),
    row('unit-1', 'vid-1', '2026-01-02', { stock_available: 2 }),
  ]);
  expect(unit.canonical_unit_id).toBe('unit-1');
  expect(unit.observation_count).toBe(2);
  expect(unit.current_state.stock_available).toBe(2);
});

test('SOI absente: identité possible mais readiness non prouvée', () => {
  const unit = buildCanonicalUnitProjection([row('unit-1', 'vid-1', '2026-01-01')]);
  expect(unit.identity.deterministic).toBe(true);
  expect(unit.commandability).toMatchObject({ capability_identified: true, supplier_order_identity_present: false, ready_now: false });
});

test('unit.source_ref persistée par la résolution reste une identité déterministe', () => {
  const soi = { provider: 'allegro', version: 1, payload: { environment: 'sandbox', offer_id: '7782182471' } };
  const unit = buildCanonicalUnitProjection([
    {
      ...row('unit-1', '7782182471', '2026-09-17', {
        supplier_unit_ref: '7782182471',
        supplier_order_identity: soi,
        stock_available: 10,
        purchase_price: 29.9,
        currency: 'PLN',
        is_active: true,
      }),
      source_id: 'api:allegro',
      adapter_type: 'allegro',
    },
  ], [{ namespace: 'api:allegro', kind: 'unit.source_ref', value: '7782182471' }]);

  expect(unit.identity).toMatchObject({
    deterministic: true,
    ambiguity_preserved: false,
    deterministic_refs: [{ namespace: 'api:allegro', kind: 'unit.source_ref', value: '7782182471' }],
  });
  expect(unit.current_state.supplier_order_identity).toEqual(soi);
  expect(unit.commandability).toMatchObject({
    capability_identified: true,
    supplier_order_identity_present: true,
    blockers: [],
  });
});

test('sans ref déterministe: ambiguïté préservée et non commandable', () => {
  const unit = buildCanonicalUnitProjection([{ ...row('unit-1', null, '2026-01-01'), source_ref: null }]);
  expect(unit.identity).toMatchObject({ deterministic: false, ambiguity_preserved: true });
  expect(unit.commandability.blockers).toContain('missing_deterministic_unit_ref');
});
