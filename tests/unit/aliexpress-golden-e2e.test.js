/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const golden = require('../../scripts/aliexpress-golden-e2e');
const router = require('../../scripts/aliexpress-prepayment-proof');

function product(overrides = {}) {
  return {
    supplier_product_id: '1000000000001',
    product_name: 'Golden cable',
    image_url: 'https://example.test/hero.jpg',
    purchase_price: 4.5,
    currency: 'USD',
    stock_available: 9,
    media: [
      { url: 'https://example.test/hero.jpg' },
      { url: 'https://example.test/detail.jpg' },
    ],
    option_axes: [{ key: 'p_14', display_name: 'Color', values: ['Black', 'White'] }],
    sellable_units: [
      {
        supplier_sku: 'SKU-BLACK',
        supplier_unit_ref: 'ali-unit-1',
        supplier_order_identity: { provider: 'aliexpress', version: 1, payload: { sku_id: 'ali-unit-1' } },
        stock_available: 5,
        is_active: true,
      },
      {
        supplier_sku: 'SKU-WHITE',
        supplier_unit_ref: '14:29',
        supplier_order_identity: { provider: 'aliexpress', version: 1, payload: { sku_attr: '14:29' } },
        stock_available: 4,
        is_active: true,
      },
    ],
    ...overrides,
  };
}

describe('AliExpress Golden E2E source gate', () => {
  test('requires complete order identity for every in-stock unit', () => {
    const audit = golden.identityAudit(product());
    expect(audit).toEqual({
      units: 2,
      active_units: 2,
      in_stock_units: 2,
      complete_order_identity_units: 2,
      complete: true,
    });

    const broken = product({
      sellable_units: [
        product().sellable_units[0],
        { ...product().sellable_units[1], supplier_order_identity: null },
      ],
    });
    expect(golden.identityAudit(broken).complete).toBe(false);
    expect(golden.sourceQualified(broken)).toBe(false);
  });

  test('selects only an unseen rich source-qualified product', () => {
    const seen = new Set(['1000000000001']);
    const incomplete = product({
      supplier_product_id: '1000000000002',
      sellable_units: [{ ...product().sellable_units[0], supplier_order_identity: null }],
    });
    const selected = product({ supplier_product_id: '1000000000003' });
    expect(golden.selectGoldenProduct([product(), incomplete, selected], seen)?.supplier_product_id)
      .toBe('1000000000003');
  });

  test('execute import requires one exact AliExpress supplier product id', () => {
    expect(golden.parseArgs(['--dry-run'])).toEqual({ mode: 'dry-run', supplierProductId: null });
    expect(golden.parseArgs(['--execute-import', '--supplier-product-id=1000000000003']))
      .toEqual({ mode: 'import', supplierProductId: '1000000000003' });
    expect(() => golden.parseArgs(['--execute-import'])).toThrow(/supplier-product-id/);
    expect(() => golden.parseArgs(['--dry-run', '--execute-import', '--supplier-product-id=1000000000003']))
      .toThrow(/mutuellement exclusifs/);
  });

  test('never turns scanner recommendation into a price decision', () => {
    const summary = golden.candidateSummary({
      id: 'c1',
      state: 'scanned',
      supplier_product_id: '1000000000003',
      scan_result: { sourcing_decision: 'TEST', recommended_price_kmf: 9500, test_price_kmf: 8900 },
      normalized_source_contract: { sellable_units: [{}, {}] },
    });
    expect(summary.recommended_price_kmf).toBe(9500);
    expect(summary.test_price_kmf).toBe(8900);
    expect(summary).not.toHaveProperty('price_kmf');
  });
});

describe('AliExpress one-shot Golden route', () => {
  test('parses dry-run and exact import operations', () => {
    expect(router.parseGoldenE2ERun({ KOMERCE_ALIEXPRESS_GOLDEN_E2E_RUN: 'dry-run' }))
      .toEqual({ mode: 'dry-run', supplierProductId: null });
    expect(router.parseGoldenE2ERun({ KOMERCE_ALIEXPRESS_GOLDEN_E2E_RUN: 'import:1000000000003' }))
      .toEqual({ mode: 'import', supplierProductId: '1000000000003' });
    expect(() => router.parseGoldenE2ERun({ KOMERCE_ALIEXPRESS_GOLDEN_E2E_RUN: 'execute:1' }))
      .toThrow(/dry-run ou import/);
  });

  test('staging assertion stays fail-closed', () => {
    expect(() => router.assertStaging({ KOMERCE_ENV: 'production' })).toThrow(/staging requis/);
    expect(() => router.assertStaging({ KOMERCE_ENV: 'staging' })).not.toThrow();
  });
});
