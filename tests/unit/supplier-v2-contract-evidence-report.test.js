'use strict';

const report = require('../../scripts/supplier-v2-contract-evidence-report');

describe('supplier V2 contract evidence report', () => {
  test('classifies shared optional and provider-only fields from persisted contracts', () => {
    const rows = [
      { supplier_name: 'CJ', normalized_source_contract: {
        schema_version: '2', supplier_name: 'CJ', product_name: 'A', currency: 'USD',
        supplier_product_id: 'cj-1', media: [{ url: 'https://x/a.jpg', role: 'PRODUCT' }],
        brand: 'CJBrand'
      }},
      { supplier_name: 'AliExpress', normalized_source_contract: {
        schema_version: '2', supplier_name: 'AliExpress', product_name: 'B', currency: 'USD',
        supplier_product_id: 'ali-1', media: [{ url: 'https://x/b.jpg', role: 'PRODUCT' }]
      }},
    ];
    const out = report.collect(rows);
    const byField = Object.fromEntries(out.fields.map(f => [f.field, f]));
    expect(byField.schema_version.classification).toBe('V2 CORE REQUIRED');
    expect(byField.media.classification).toBe('V2 CORE OPTIONAL');
    expect(byField.brand.classification).toBe('SUPPLIER EXTENSION');
    expect(byField.brand.providers.CJ.presence_pct).toBe(100);
    expect(byField.brand.providers.AliExpress.presence_pct).toBe(0);
  });

  test('ignores null values for presence and exposes observed types', () => {
    const out = report.collect([
      { supplier_name: 'CJ', normalized_source_contract: {
        schema_version: '2', supplier_name: 'CJ', product_name: 'A', currency: 'USD',
        description: null, stock_available: 4
      }},
      { supplier_name: 'AliExpress', normalized_source_contract: {
        schema_version: '2', supplier_name: 'AliExpress', product_name: 'B', currency: 'USD',
        description: 'text', stock_available: 2
      }},
    ]);
    const byField = Object.fromEntries(out.fields.map(f => [f.field, f]));
    expect(byField.description.providers.CJ.present).toBe(0);
    expect(byField.description.providers.AliExpress.types).toEqual(['string']);
    expect(byField.stock_available.providers.CJ.types).toEqual(['number']);
  });
});
