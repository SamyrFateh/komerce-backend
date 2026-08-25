'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
const db = require('../../db');
const product360 = require('../../services/product-360');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

function product(overrides = {}) {
  return {
    id: PRODUCT_ID,
    product_ref: 'KPR-000123',
    sku: 'CAT-123',
    name: 'Golden Elite Pro',
    description: 'Produit test',
    category: 'mode',
    subcategory: 'robes',
    price_kmf: 50000,
    stock: 9,
    inventory_model: 'LEGACY_VARIANTS',
    is_active: true,
    is_available: true,
    has_variants: true,
    lifecycle_status: 'active',
    content_source: 'ai_enriched',
    enrichment_version: 'v3',
    sourcing_source: 'dubai',
    fragility: null,
    weight_kg: 0.8,
    dimensions_cm: null,
    image_url: 'https://example.test/p.jpg',
    created_at: '2026-07-01T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

function mockQueries(options = {}) {
  const variants = options.variants || [
    { variant_type: 'couleur', variant_value: 'Noir', sku: 'N', stock: 12, price_kmf: null, image_url: null, display_order: 1 },
    { variant_type: 'taille', variant_value: 'M', sku: 'M', stock: 8, price_kmf: null, image_url: null, display_order: 2 },
  ];
  const skus = options.skus || [];
  const performance = options.performance || [
    { code: 'CM', name: 'Cameroun', currency: 'XAF', orders_count: 2, quantity_sold: 3, revenue_kmf: 150000, customers_count: 2, last_order_at: '2026-08-20T10:00:00Z' },
  ];
  const economics = options.economics || {
    imputation_lines: 2,
    quantity_costed: 3,
    revenue_costed_kmf: 150000,
    estimated_landed_kmf: 70000,
    estimated_business_kmf: 90000,
    estimated_margin_kmf: 60000,
    avg_estimated_margin_pct: 40,
    last_imputation_at: '2026-08-20T10:00:00Z',
  };
  const real = options.real || {
    allocations_count: 4,
    lines_with_real_cost: 2,
    real_allocated_kmf: 85000,
    last_real_allocation_at: '2026-08-22T10:00:00Z',
  };

  db.query.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes('FROM product_variants')) return { rows: variants };
    if (text.includes('FROM product_skus')) return { rows: skus };
    if (text.includes('FROM order_items oi') && text.includes('COUNT(DISTINCT o.id)')) return { rows: performance };
    if (text.includes('FROM order_item_cost_imputations imp')) return { rows: [economics] };
    if (text.includes('FROM order_item_real_cost_allocations alc')) return { rows: [real] };
    if (text.includes('FROM product_suppliers ps')) return { rows: options.suppliers || [] };
    if (text.includes('FROM price_history ph')) return { rows: options.priceHistory || [] };
    if (text.includes("type = 'product_stock_audit'")) return { rows: options.stockAudit || [] };
    throw new Error(`Unexpected SQL: ${text}`);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('product_ref est la seule identité métier acceptée', () => {
  expect(product360.normalizeProductRef(' kpr-000123 ')).toBe('KPR-000123');
  expect(product360.normalizeProductRef(PRODUCT_ID)).toBeNull();
  expect(product360.normalizeProductRef('SKU-123')).toBeNull();
});

test('MarketScope est injecté dans performance, coûts estimés et coûts réels', async () => {
  mockQueries();

  await product360.loadProduct360(product(), { marketIds: ['market-cm-id'], includeCentral: false });

  const scopedCalls = db.query.mock.calls.filter(([sql]) =>
    String(sql).includes('o.market_id = ANY($2::uuid[])')
  );
  expect(scopedCalls).toHaveLength(3);
  scopedCalls.forEach(([, params]) => {
    expect(params).toEqual([PRODUCT_ID, ['market-cm-id']]);
  });
  expect(db.query.mock.calls.some(([sql]) => String(sql).includes('FROM product_suppliers ps'))).toBe(false);
  expect(db.query.mock.calls.some(([sql]) => String(sql).includes('FROM price_history ph'))).toBe(false);
});

test('LEGACY_VARIANTS garde products.stock comme vérité et ne somme jamais les axes variantes', async () => {
  mockQueries({
    variants: [
      { variant_type: 'couleur', variant_value: 'Noir', stock: 12, display_order: 1 },
      { variant_type: 'taille', variant_value: 'M', stock: 8, display_order: 2 },
    ],
  });

  const result = await product360.loadProduct360(product({ stock: 9, inventory_model: 'LEGACY_VARIANTS' }), {
    marketIds: ['market-cm-id'], includeCentral: false,
  });

  expect(result.inventory.stock_total).toBe(9);
  expect(result.summary.stock_total).toBe(9);
  expect(result.data_quality.stock_truth).toBe('products.stock');
  expect(result.data_quality.legacy_variant_stock_rule).toBe('variant_rows_not_summed');
});

test('mode SKU somme uniquement les SKU actifs', async () => {
  mockQueries({
    variants: [],
    skus: [
      { sku: 'SKU-A', variant_combo: { couleur: 'Noir' }, stock: 3, price_kmf: 51000, is_active: true },
      { sku: 'SKU-B', variant_combo: { couleur: 'Blanc' }, stock: 4, price_kmf: 52000, is_active: true },
      { sku: 'SKU-X', variant_combo: { couleur: 'Old' }, stock: 99, price_kmf: 1, is_active: false },
    ],
  });

  const result = await product360.loadProduct360(product({ stock: 999, inventory_model: 'SKU' }), {
    marketIds: ['market-cm-id'], includeCentral: false,
  });

  expect(result.inventory.stock_total).toBe(7);
  expect(result.data_quality.stock_truth).toBe('product_skus');
});

test('les clients distincts restent par marché et ne sont pas additionnés dans le résumé', async () => {
  mockQueries({
    performance: [
      { code: 'CM', name: 'Cameroun', currency: 'XAF', orders_count: 2, quantity_sold: 2, revenue_kmf: 100000, customers_count: 2 },
      { code: 'CG', name: 'Congo', currency: 'XAF', orders_count: 1, quantity_sold: 1, revenue_kmf: 50000, customers_count: 1 },
    ],
  });

  const result = await product360.loadProduct360(product(), { marketIds: null, includeCentral: false });

  expect(result.summary.orders_count).toBe(3);
  expect(result.summary.quantity_sold).toBe(3);
  expect(result.summary.revenue_kmf).toBe(150000);
  expect(result.summary.customers_count).toBeUndefined();
  expect(result.performance.map(row => row.customers_count)).toEqual([2, 1]);
});

test('Product 360 reprend les valeurs économiques persistées sans recalculer la marge', async () => {
  mockQueries({
    economics: {
      imputation_lines: 1,
      quantity_costed: 1,
      revenue_costed_kmf: 123456,
      estimated_landed_kmf: 11111,
      estimated_business_kmf: 99999,
      estimated_margin_kmf: -4321,
      avg_estimated_margin_pct: -3.5,
      last_imputation_at: null,
    },
    real: {
      allocations_count: 2,
      lines_with_real_cost: 1,
      real_allocated_kmf: 77777,
      last_real_allocation_at: null,
    },
  });

  const result = await product360.loadProduct360(product(), { marketIds: ['market-cm-id'], includeCentral: false });

  expect(result.economics.estimated_margin_kmf).toBe(-4321);
  expect(result.economics.avg_estimated_margin_pct).toBe(-3.5);
  expect(result.economics.real_allocated_kmf).toBe(77777);
  expect(result.economics).not.toHaveProperty('real_margin_kmf');
  expect(result.economics.doctrine).toBe('persisted_cost_truth_only');
});

test('autorité centrale seule charge fournisseurs et audits sans exposer secrets ni UUID', async () => {
  mockQueries({
    suppliers: [{
      supplier_name: 'Dubai Source', platform: 'Noon', supplier_sku: 'NOON-1', supplier_url: 'https://example.test/p',
      supplier_price_aed: 42.5, min_order_qty: 1, priority: 1, is_active: true, last_checked_at: null, notes: null,
      api_key_enc: 'MUST-NOT-LEAK',
    }],
    priceHistory: [{ old_price_kmf: 45000, new_price_kmf: 50000, source: 'manual', applied_at: '2026-08-01T10:00:00Z', applied_by_name: 'Admin' }],
    stockAudit: [{ severity: 'low', created_at: '2026-08-02T10:00:00Z', resolved_at: null, description: `product=${PRODUCT_ID}` }],
  });

  const result = await product360.loadProduct360(product(), { marketIds: null, includeCentral: true });
  const serialized = JSON.stringify(result);

  expect(result.central.visibility).toBe('global');
  expect(result.central.suppliers).toHaveLength(1);
  expect(result.central.price_history).toHaveLength(1);
  expect(result.central.stock_audit_count).toBe(1);
  expect(serialized).not.toContain(PRODUCT_ID);
  expect(serialized).not.toContain('MUST-NOT-LEAK');
  expect(serialized).not.toContain('api_key');
});
