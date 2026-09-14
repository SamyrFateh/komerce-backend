'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { compareCanonicalOfferUnitWithLegacy } = require('../../services/sourcing-canonical-offer-unit-comparison');

test('compare les refs/SOI sans écrire ni sélectionner', () => {
  const soi = { provider: 'cj', version: 1, payload: { vid: 'v1' } };
  const report = compareCanonicalOfferUnitWithLegacy({
    offers: [{ canonical_offer_id: 'o1' }],
    units: [{ canonical_unit_id: 'u1', identity: { deterministic_refs: [{ value: 'v1' }] }, current_state: { supplier_order_identity: soi } }],
    legacySkus: [{ id: 'sku1', supplier_unit_ref: 'v1', supplier_order_identity: soi }],
  });
  expect(report.parity).toEqual([expect.objectContaining({ product_sku_id: 'sku1', canonical_unit_id: 'u1', supplier_order_identity_equal: true })]);
  expect(report.hard_failures).toEqual([]);
  expect(report.authority_unchanged).toBe(true);
});
