'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { compareCanonicalOfferUnitWithLegacy, collectCanonicalOfferUnitComparison } = require('../../services/sourcing-canonical-offer-unit-comparison');

const unit = ({ id, source, provider, ref, soi }) => ({
  canonical_unit_id: id,
  identity: { deterministic_refs: [{ namespace: source, kind: 'supplier_unit_ref', value: ref }] },
  provenance: [{ source_id: source, adapter_type: provider }],
  current_state: { supplier_order_identity: soi },
});

test('compare les refs/SOI avec namespace fournisseur explicite', () => {
  const soi = { provider: 'cj', version: 1, payload: { vid: 'v1' } };
  const report = compareCanonicalOfferUnitWithLegacy({
    offers: [{ canonical_offer_id: 'o1' }],
    units: [unit({ id: 'u1', source: 'api:cj', provider: 'cj', ref: 'v1', soi })],
    legacySkus: [{ id: 'sku1', supplier_unit_ref: 'v1', supplier_order_identity: soi }],
  });
  expect(report.parity).toEqual([expect.objectContaining({
    product_sku_id: 'sku1', canonical_unit_id: 'u1', provider: 'cj', supplier_order_identity_equal: true,
  })]);
  expect(report.parity[0].matched_ref_keys).toEqual(['api:cj|supplier_unit_ref|v1']);
  expect(report.hard_failures).toEqual([]);
  expect(report.authority_unchanged).toBe(true);
});

test('même texte de ref chez deux fournisseurs ne mélange jamais les Units', () => {
  const cjSoi = { provider: 'cj', version: 1, payload: { vid: 'SAME' } };
  const aliSoi = { provider: 'aliexpress', version: 1, payload: { sku_id: 'SAME' } };
  const report = compareCanonicalOfferUnitWithLegacy({
    units: [
      unit({ id: 'u-cj', source: 'api:cj', provider: 'cj', ref: 'SAME', soi: cjSoi }),
      unit({ id: 'u-ali', source: 'api:aliexpress', provider: 'aliexpress', ref: 'SAME', soi: aliSoi }),
    ],
    legacySkus: [{ id: 'sku-cj', supplier_unit_ref: 'SAME', supplier_order_identity: cjSoi }],
  });
  expect(report.ambiguities).toEqual([]);
  expect(report.parity).toEqual([expect.objectContaining({ canonical_unit_id: 'u-cj', provider: 'cj' })]);
  expect(report.hard_failures).toEqual([]);
});

test('SOI divergente est un hard failure même si la ref exacte est identique', () => {
  const legacySoi = { provider: 'cj', version: 1, payload: { pid: 'P1', vid: 'V1' } };
  const canonicalSoi = { provider: 'cj', version: 1, payload: { pid: 'P2', vid: 'V1' } };
  const report = compareCanonicalOfferUnitWithLegacy({
    units: [unit({ id: 'u1', source: 'api:cj', provider: 'cj', ref: 'V1', soi: canonicalSoi })],
    legacySkus: [{ id: 'sku1', supplier_unit_ref: 'V1', supplier_order_identity: legacySoi }],
  });
  expect(report.parity[0].supplier_order_identity_equal).toBe(false);
  expect(report.hard_failures).toContainEqual({ product_sku_id: 'sku1', reason: 'supplier_order_identity_mismatch' });
});

test('legacy sans provider ne prétend pas une parité cross-namespace', () => {
  const report = compareCanonicalOfferUnitWithLegacy({
    units: [unit({ id: 'u1', source: 'api:cj', provider: 'cj', ref: 'V1', soi: null })],
    legacySkus: [{ id: 'sku1', supplier_unit_ref: 'V1', supplier_order_identity: null }],
  });
  expect(report.parity).toEqual([]);
  expect(report.missing_identities).toEqual([expect.objectContaining({ reason: 'legacy_provider_namespace_missing' })]);
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
    provenance: [{ source_id: 'source-a', adapter_type: 'manual' }],
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
