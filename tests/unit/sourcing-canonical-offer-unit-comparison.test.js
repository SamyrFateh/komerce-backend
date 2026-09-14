'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { compareCanonicalOfferUnitWithLegacy, collectCanonicalOfferUnitComparison } = require('../../services/sourcing-canonical-offer-unit-comparison');

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


test('collecte le corpus uniquement pour le rapport shadow et délègue les projections ciblées', async () => {
  const query = jest.fn()
    .mockResolvedValueOnce({ rows: [
      { canonical_entity_id: 'o1', grain: 'offer' },
      { canonical_entity_id: 'u1', grain: 'unit' },
    ] })
    .mockResolvedValueOnce({ rows: [
      { id: 'sku1', supplier_unit_ref: 'ref1', supplier_order_identity: null, source: 'SUPPLIER' },
    ] });
  const offerProjectionFn = jest.fn(async () => ({ canonical_offer_id: 'o1' }));
  const unitProjectionFn = jest.fn(async () => ({
    canonical_unit_id: 'u1',
    identity: { deterministic_refs: [{ namespace: 'source-a', kind: 'supplier_unit_ref', value: 'ref1' }] },
    current_state: { supplier_order_identity: null },
  }));
  const report = await collectCanonicalOfferUnitComparison(query, { offerProjectionFn, unitProjectionFn });
  expect(report).toMatchObject({
    report_version: 'canonical-offer-unit-shadow-comparison-v1',
    offers: { projected: 1 },
    units: { projected: 1, legacy: 1 },
    authority_unchanged: true,
  });
  expect(offerProjectionFn).toHaveBeenCalledWith('o1', query);
  expect(unitProjectionFn).toHaveBeenCalledWith('u1', query);
  expect(query.mock.calls[1][0]).toContain("WHERE source = 'SUPPLIER'");
});
