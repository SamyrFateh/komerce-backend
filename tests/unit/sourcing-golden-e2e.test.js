'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { buildObservationPlan } = require('../../services/sourcing-observation-shadow-plan');
const { buildCanonicalProductProjection } = require('../../services/sourcing-canonical-product-projection');
const { buildCanonicalOfferProjection } = require('../../services/sourcing-canonical-offer-projection');
const { buildCanonicalUnitProjection } = require('../../services/sourcing-canonical-unit-projection');
const { planSkuReconciliation } = require('../../services/catalog-promotion/sku');
const { prepareCanonicalUnitPurchase } = require('../../services/suppliers/canonical-unit-purchasing-gate');
const { buildGoldenE2EReport } = require('../../services/sourcing-golden-e2e-service');

const soi = (provider, payload) => ({ provider, version: 1, payload });

function product({ supplier, productRef, name = 'Travel Mug', description, price = 10, stock = 5, unitRef, identity }) {
  return {
    schema_version: '2',
    supplier_name: supplier,
    supplier_product_id: productRef,
    product_name: name,
    description,
    purchase_price: price,
    currency: 'USD',
    stock_available: stock,
    sellable_units: [{
      supplier_sku: unitRef,
      supplier_unit_ref: unitRef,
      option_values: { color: 'Black', size: 'M' },
      purchase_price: price,
      currency: 'USD',
      stock_available: stock,
      is_active: true,
      ...(identity ? { supplier_order_identity: identity } : {}),
    }],
    raw_payload: { supplier_native: true },
  };
}

function rowsFor(sourceId, captureId, observedAt, contract) {
  return buildObservationPlan([contract], { captureId, observedAt }).rows.map((row) => ({
    ...row,
    capture_id: row.captureId,
    observation_id: row.id,
    source_id: sourceId,
    source_ref: row.sourceRef,
    observed_at: row.observedAt,
    normalized: row.normalized,
  }));
}

test('Golden traverse ingestion, Resolution, Product/Offer/Unit, catalog SKU et HARD_STOP', async () => {
  const manual = rowsFor('manual:ops:1', 'capture-manual', '2026-09-01T00:00:00Z',
    product({ supplier: 'Manual', productRef: 'MUG-A', description: 'Manual wording', unitRef: 'MAN-M' }));
  const cj1 = rowsFor('api:cj', 'capture-cj-1', '2026-09-02T00:00:00Z',
    product({ supplier: 'CJ', productRef: 'CJ-MUG-A', description: 'CJ wording', unitRef: 'CJ-VID-1',
      identity: soi('cj', { pid: 'CJ-P1', vid: 'CJ-VID-1', variant_sku: 'CJ-SKU-1' }) }));
  const cj2 = rowsFor('api:cj', 'capture-cj-2', '2026-09-03T00:00:00Z',
    product({ supplier: 'CJ', productRef: 'CJ-MUG-A', description: 'CJ wording', price: 12, stock: 2,
      unitRef: 'CJ-VID-1', identity: soi('cj', { pid: 'CJ-P1', vid: 'CJ-VID-1', variant_sku: 'CJ-SKU-1' }) }));
  const ali = rowsFor('api:aliexpress', 'capture-ali', '2026-09-02T00:00:00Z',
    product({ supplier: 'AliExpress', productRef: 'AE-DISTINCT', name: 'Travel Mug XL',
      description: 'Distinct model', unitRef: 'AE-SKU-1',
      identity: soi('aliexpress', { product_id: 'AE-P2', sku_id: 'AE-SKU-1' }) }));

  const bind = (rows, canonicalProduct, canonicalOffer, canonicalUnit) => rows.map((row) => {
    const id = row.grain === 'product' ? canonicalProduct : row.grain === 'offer' ? canonicalOffer : canonicalUnit;
    const parent = row.grain === 'offer' ? canonicalProduct : row.grain === 'unit' ? canonicalOffer : null;
    return { ...row, canonical_entity_id: id, parent_entity_id: parent, entity_status: 'active' };
  });
  const observations = [
    ...bind(manual, 'cp-mug', 'co-manual', 'cu-manual'),
    ...bind(cj1, 'cp-mug', 'co-cj', 'cu-cj'),
    ...bind(cj2, 'cp-mug', 'co-cj', 'cu-cj'),
    ...bind(ali, 'cp-distinct', 'co-ali', 'cu-ali'),
  ];

  const productRows = observations.filter((row) => row.grain === 'product');
  const products = [
    buildCanonicalProductProjection(productRows.filter((row) => row.canonical_entity_id === 'cp-mug')),
    buildCanonicalProductProjection(productRows.filter((row) => row.canonical_entity_id === 'cp-distinct')),
  ];
  const cjOffer = buildCanonicalOfferProjection(observations.filter((row) => row.canonical_entity_id === 'co-cj'));
  const cjUnit = buildCanonicalUnitProjection(observations.filter((row) => row.canonical_entity_id === 'cu-cj'), [
    { namespace: 'api:cj', kind: 'supplier_unit_ref', value: 'CJ-VID-1' },
  ]);
  expect(cjOffer).toMatchObject({ canonical_offer_id: 'co-cj', observation_count: 2,
    current_state: { purchase_price: 12, stock_available: 2 } });
  expect(cjUnit).toMatchObject({ canonical_unit_id: 'cu-cj', observation_count: 2,
    current_state: { purchase_price: 12, stock_available: 2 } });
  expect(products[0].conflicts).toContain('description');

  const skuPlan = planSkuReconciliation([], [cj2.find((row) => row.grain === 'unit').normalized]);
  expect(skuPlan.toCreate[0]).toMatchObject({
    supplier_sku: 'CJ-VID-1',
    supplier_unit_ref: 'CJ-VID-1',
    supplier_order_identity: soi('cj', { pid: 'CJ-P1', vid: 'CJ-VID-1', variant_sku: 'CJ-SKU-1' }),
  });

  const resolvedCj = {
    status: 'RESOLVED',
    product_sku_id: 'sku-cj',
    canonical_unit_id: 'cu-cj',
    supplier_unit_ref: 'CJ-VID-1',
    supplier_order_identity: cjUnit.current_state.supplier_order_identity,
    legacy_sku: { id: 'sku-cj', product_id: 'catalog-cj' },
    canonical_unit: cjUnit,
  };
  const adapter = {
    provider: 'cj',
    evaluate: jest.fn(async () => ({ ready: true, status: 'FULFILLMENT_READY' })),
    buildOrderPayload: jest.fn(async ({ identity }) => ({ opaque: identity })),
  };
  const hardStop = await prepareCanonicalUnitPurchase({
    productSkuId: 'sku-cj',
    resolveFn: async () => resolvedCj,
    adapters: { cj: adapter },
  });
  expect(hardStop).toMatchObject({ status: 'HARD_STOP', place_order_invoked: false });
  expect(hardStop).not.toHaveProperty('placeOrder');

  const report = buildGoldenE2EReport({
    sources: [
      { source_id: 'manual:ops:1', adapter_type: 'manual' },
      { source_id: 'api:cj', adapter_type: 'cj' },
      { source_id: 'api:aliexpress', adapter_type: 'aliexpress' },
    ],
    observations,
    products,
    refs: [
      { canonical_entity_id: 'cu-cj', grain: 'unit', source_id: 'api:cj', ref_kind: 'supplier_unit_ref', ref_value: 'CJ-VID-1' },
      { canonical_entity_id: 'cu-ali', grain: 'unit', source_id: 'api:aliexpress', ref_kind: 'supplier_unit_ref', ref_value: 'AE-SKU-1' },
    ],
    catalog_rows: [
      { candidate_id: 'candidate-cj', supplier_name: 'CJ', candidate_state: 'imported_to_catalog',
        product_id: 'catalog-cj', lifecycle_status: 'candidate', product_is_active: false,
        product_sku_id: 'sku-cj', supplier_order_identity: resolvedCj.supplier_order_identity },
      { candidate_id: 'candidate-manual', supplier_name: 'Manual', candidate_state: 'imported_to_catalog',
        product_id: 'catalog-manual', lifecycle_status: 'candidate', product_is_active: false,
        product_sku_id: 'sku-manual', supplier_order_identity: null },
      { candidate_id: 'candidate-ali', supplier_name: 'AliExpress', candidate_state: 'imported_to_catalog',
        product_id: 'catalog-ali', lifecycle_status: 'candidate', product_is_active: false,
        product_sku_id: 'sku-ali', supplier_order_identity: soi('aliexpress', { product_id: 'AE-P2', sku_id: 'AE-SKU-1' }) },
    ],
    resolutions: [
      resolvedCj,
      { status: 'RESOLVED', product_sku_id: 'sku-ali', canonical_unit_id: 'cu-ali',
        supplier_unit_ref: 'AE-SKU-1' },
      { status: 'AMBIGUOUS_UNIT', product_sku_id: 'sku-ambiguous' },
      { status: 'NO_SUPPLIER_IDENTITY', product_sku_id: 'sku-manual' },
    ],
  });

  expect(report.status).toBe('PASS');
  expect(report).toMatchObject({
    integrity: { status: 'PASS', provenance_preserved: true, economic_product_leaks: [], place_order_invoked: false },
    resolution: { status: 'PASS', cross_source_products: 1, distinct_products: 2,
      repeated_source_identities: 3, descriptive_conflicts_preserved: 1 },
    catalog: { status: 'PASS', inactive_promotions: 3 },
    unit_identity: { status: 'PASS', ambiguous_blocked: 1 },
    commandability: { status: 'PASS', missing_soi_blocked: 1 },
    hard_failures: [],
  });
});

test('Manual/CSV sans SOI reste projetable mais Purchasing est bloqué', async () => {
  const unit = product({ supplier: 'Manual', productRef: 'M1', unitRef: 'MAN-1' }).sellable_units[0];
  const projection = buildCanonicalUnitProjection([{
    canonical_entity_id: 'cu-manual', parent_entity_id: 'co-manual',
    observation_id: 'o1', source_id: 'manual:ops', source_ref: 'MAN-1',
    observed_at: '2026-09-01T00:00:00Z', normalized: unit,
  }]);
  expect(projection.identity.deterministic).toBe(true);
  expect(projection.commandability.supplier_order_identity_present).toBe(false);

  const out = await prepareCanonicalUnitPurchase({
    productSkuId: 'sku-manual',
    resolveFn: async () => ({ status: 'NO_SUPPLIER_IDENTITY' }),
  });
  expect(out).toMatchObject({ status: 'BLOCKED_SUPPLIER_IDENTITY', place_order_invoked: false });
});

test('un provider futur reste compatible via le contrat opaque, sans branche métier dans le core', async () => {
  const futureIdentity = soi('future-provider', {
    merchant: { account: 'A-9' },
    exact_variant_ref: 'FUTURE-UNIT-77',
    extension: { any_provider_native_shape: true },
  });
  const futureUnit = buildCanonicalUnitProjection([{
    canonical_entity_id: 'cu-future', parent_entity_id: 'co-future',
    observation_id: 'o-future', source_id: 'api:future-provider:tenant-a',
    adapter_type: 'future-provider', source_ref: 'FUTURE-UNIT-77',
    observed_at: '2026-09-04T00:00:00Z',
    normalized: {
      supplier_unit_ref: 'FUTURE-UNIT-77',
      stock_available: 7,
      purchase_price: 19,
      currency: 'EUR',
      is_active: true,
      supplier_order_identity: futureIdentity,
    },
  }]);
  const futureAdapter = {
    provider: 'future-provider',
    evaluate: jest.fn(async ({ identity }) => ({
      ready: true,
      status: 'FULFILLMENT_READY',
      evidence: { opaque_identity: identity },
    })),
    buildOrderPayload: jest.fn(async ({ identity }) => ({
      forwarded_without_core_interpretation: identity.payload,
    })),
  };
  const out = await prepareCanonicalUnitPurchase({
    productSkuId: 'sku-future',
    adapters: { 'future-provider': futureAdapter },
    resolveFn: async () => ({
      status: 'RESOLVED',
      product_sku_id: 'sku-future',
      canonical_unit_id: 'cu-future',
      supplier_unit_ref: 'FUTURE-UNIT-77',
      supplier_order_identity: futureIdentity,
      legacy_sku: { id: 'sku-future' },
      canonical_unit: futureUnit,
    }),
  });
  expect(out.status).toBe('HARD_STOP');
  expect(out.place_order_invoked).toBe(false);
  expect(out.payload.forwarded_without_core_interpretation).toEqual(futureIdentity.payload);
  expect(futureAdapter.evaluate.mock.calls[0][0].identity).toEqual(futureIdentity);
});
