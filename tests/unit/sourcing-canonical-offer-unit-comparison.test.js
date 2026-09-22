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

const stockSoi = { provider: 'allegro', version: 1, payload: { offer_id: '7770000001', environment: 'sandbox' } };
const observedAt = '2026-09-22T17:12:41.000Z';
function observedStockUnit(stock, options = {}) {
  const source = options.source || 'api:allegro:test';
  return {
    ...unit({ id: 'canonical-unit', source, provider: 'allegro', ref: '7770000001', soi: options.soi || stockSoi }),
    observed_at: observedAt,
    provenance: [{ source_id: source, adapter_type: 'allegro', observed_at: observedAt }],
    current_state: {
      supplier_order_identity: options.soi || stockSoi,
      stock_available: stock,
      is_active: true,
    },
    last_observation_delta: { status: 'CHANGED', changes: [{ field: 'stock_available', before: 3, after: stock }] },
  };
}
function catalogSupplierSku(stock, soi = stockSoi) {
  return {
    id: 'sku-1', source: 'SUPPLIER', is_active: true, stock,
    supplier_unit_ref: '7770000001', supplier_order_identity: soi,
  };
}

test('shadow stock compares observed 3→1 with catalog SKU without granting commercial readiness', () => {
  const report = compareCanonicalOfferUnitWithLegacy({
    units: [observedStockUnit(1)],
    legacySkus: [catalogSupplierSku(3)],
  });
  expect(report.stock_observations).toEqual([{
    product_sku_id: 'sku-1', canonical_unit_id: 'canonical-unit',
    authority: 'shadow_read_only', freshness: 'UNVERIFIED',
    commercial_readiness: 'NOT_EVALUATED',
    status: 'COMPARED', reason: null,
    observed_supplier_stock: 1, catalog_sku_stock: 3,
    observed_at: observedAt, number_comparison: 'DIFFERENT_NUMBER',
  }]);
  expect(report.parity[0].supplier_order_identity_equal).toBe(true);
  expect(report.authority_unchanged).toBe(true);
  const equal = compareCanonicalOfferUnitWithLegacy({
    units: [observedStockUnit(1)], legacySkus: [catalogSupplierSku(1)],
  });
  expect(equal.stock_observations[0]).toMatchObject({
    status: 'COMPARED', number_comparison: 'SAME_NUMBER',
    commercial_readiness: 'NOT_EVALUATED',
  });
});

test('explicit zero differs from missing/invalid stock; none becomes an invented 0', () => {
  const zero = compareCanonicalOfferUnitWithLegacy({
    units: [observedStockUnit(0)], legacySkus: [catalogSupplierSku(3)],
  });
  expect(zero.stock_observations[0]).toMatchObject({
    status: 'COMPARED', observed_supplier_stock: 0, number_comparison: 'DIFFERENT_NUMBER',
  });
  for (const stock of [null, undefined, '', -1, 1.5, 'not-a-number']) {
    const unknown = compareCanonicalOfferUnitWithLegacy({
      units: [observedStockUnit(stock)], legacySkus: [catalogSupplierSku(3)],
    });
    expect(unknown.stock_observations[0]).toMatchObject({
      status: 'UNKNOWN', reason: 'SUPPLIER_STOCK_UNKNOWN',
      commercial_readiness: 'NOT_EVALUATED',
    });
    expect(unknown.stock_observations[0]).not.toHaveProperty('observed_supplier_stock');
  }
  const catalogUnknown = compareCanonicalOfferUnitWithLegacy({
    units: [observedStockUnit(1)], legacySkus: [catalogSupplierSku(null)],
  });
  expect(catalogUnknown.stock_observations[0]).toMatchObject({
    status: 'UNKNOWN', reason: 'CATALOG_STOCK_UNKNOWN',
  });
});

test('identity mismatch and unproved latest Source never compare stock across suppliers', () => {
  const mismatched = compareCanonicalOfferUnitWithLegacy({
    units: [observedStockUnit(1)],
    legacySkus: [catalogSupplierSku(3, { provider: 'allegro', version: 1, payload: { offer_id: 'different' } })],
  });
  expect(mismatched.stock_observations[0]).toMatchObject({
    status: 'UNKNOWN', reason: 'IDENTITY_NOT_PROVEN',
  });
  const otherSource = { ...observedStockUnit(1), provenance: [
    { source_id: 'api:allegro:other-source', adapter_type: 'allegro', observed_at: observedAt },
  ] };
  const unproved = compareCanonicalOfferUnitWithLegacy({
    units: [otherSource], legacySkus: [catalogSupplierSku(3)],
  });
  expect(unproved.stock_observations[0]).toMatchObject({
    status: 'UNKNOWN', reason: 'SOURCE_SCOPE_UNPROVEN',
  });
  const crossed = { ...observedStockUnit(1), last_observation_delta: {
    status: 'UNKNOWN', reason: 'SOURCE_SCOPE_CHANGED', changes: [],
  } };
  expect(compareCanonicalOfferUnitWithLegacy({
    units: [crossed], legacySkus: [catalogSupplierSku(3)],
  }).stock_observations[0]).toMatchObject({
    status: 'UNKNOWN', reason: 'SOURCE_SCOPE_UNPROVEN',
  });
});

test('inactive or unproven observation stays unknown; no stock comparison promotes catalog', () => {
  const inactive = { ...observedStockUnit(1), current_state: {
    ...observedStockUnit(1).current_state, is_active: false,
  } };
  expect(compareCanonicalOfferUnitWithLegacy({
    units: [inactive], legacySkus: [catalogSupplierSku(3)],
  }).stock_observations[0]).toMatchObject({
    status: 'UNKNOWN', reason: 'INACTIVE_UNIT',
  });
  const undated = { ...observedStockUnit(1), observed_at: null };
  expect(compareCanonicalOfferUnitWithLegacy({
    units: [undated], legacySkus: [catalogSupplierSku(3)],
  }).stock_observations[0]).toMatchObject({
    status: 'UNKNOWN', reason: 'SOURCE_SCOPE_UNPROVEN',
  });
});
