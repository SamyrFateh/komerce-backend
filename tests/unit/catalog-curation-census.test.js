'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { end: jest.fn() },
}));

const census = require('../../scripts/catalog-curation-census');

test('ordre de revue reste explicable et ne transforme jamais le signal en décision de publication', () => {
  const rows = [
    { product_ref: 'KPR-3', sourcing_decision: 'TEST', sourcing_confidence: 'medium', economic_health_status: 'strong', supplier_stock: 100, economic_test_margin_pct: 50, enrichment_confidence: 0.95, category: 'phones' },
    { product_ref: 'KPR-2', sourcing_decision: 'TEST', sourcing_confidence: 'high', economic_health_status: 'healthy', supplier_stock: 0, economic_test_margin_pct: 30, enrichment_confidence: 0.8, category: 'vetements' },
    { product_ref: 'KPR-1', sourcing_decision: 'TEST', sourcing_confidence: 'high', economic_health_status: 'strong', supplier_stock: 10, economic_test_margin_pct: 45, enrichment_confidence: 0.7, category: 'mariage' },
    { product_ref: 'KPR-4', sourcing_decision: 'WATCH', sourcing_confidence: 'high', economic_health_status: 'strong', supplier_stock: 999, economic_test_margin_pct: 80, enrichment_confidence: 1, category: 'electro' },
  ];

  const report = census.buildCensus(rows, 4);
  expect(report.review_order_preview.map(row => row.product_ref)).toEqual(['KPR-1', 'KPR-2', 'KPR-3', 'KPR-4']);
  expect(report.by_sourcing_decision.TEST).toBe(3);
  expect(report.by_sourcing_decision.WATCH).toBe(1);
});

test('bandes de marge distinguent les niveaux économiques sans utiliser la densité de valeur', () => {
  expect(census.marginBand(-1)).toBe('<0');
  expect(census.marginBand(10)).toBe('0-14.9');
  expect(census.marginBand(20)).toBe('15-24.9');
  expect(census.marginBand(30)).toBe('25-40');
  expect(census.marginBand(50)).toBe('>40');
  expect(census.marginBand(null)).toBe('unknown');
});

test('runtime refuse toute base autre que le checkpoint jetable localhost', () => {
  expect(() => census.assertDisposableRuntime({
    KOMERCE_ENV: 'staging',
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://x:x@railway.internal:5432/production',
  })).toThrow(/REFUS/);
});
