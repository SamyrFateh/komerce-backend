'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const product360 = require('../../public/dashboards/canonical/js/product-360.js');

function node() {
  return {
    className: '',
    children: [],
    textContent: '',
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    setAttribute: jest.fn(),
  };
}

function ui() {
  return {
    UIState: { render: jest.fn() },
    Section: { create: jest.fn(() => ({ element: node(), slot: node() })) },
    DataTable: { render: jest.fn() },
    MetricStrip: { render: jest.fn() },
  };
}

function payload() {
  return {
    product: {
      product_ref: 'KPR-000123', name: 'Golden Elite Pro', category: 'mode', subcategory: 'robes',
      price_kmf: 50000, inventory_model: 'SKU', lifecycle_status: 'active', is_active: true,
      is_available: true, fragility: null, weight_kg: 0.8,
    },
    scope: { mode: 'market', markets: [{ code: 'CM', name: 'Cameroun', currency: 'XAF' }] },
    summary: { stock_total: 7, quantity_sold: 3, revenue_kmf: 150000, orders_count: 2, suppliers: 0 },
    inventory: { model: 'SKU', stock_total: 7, legacy_base_stock: 999, variants: [], skus: [] },
    performance: [],
    economics: {
      imputation_lines: 2, quantity_costed: 3, revenue_costed_kmf: 150000,
      estimated_landed_kmf: 70000, estimated_business_kmf: 90000,
      estimated_margin_kmf: -4321, avg_estimated_margin_pct: -3.5,
      real_allocated_kmf: 85000, real_lines_covered: 2,
    },
    central: { visibility: 'restricted' },
    timeline: [],
  };
}

test('productRefFromPath ne reconnaît que le détail Product 360', () => {
  expect(product360.productRefFromPath('/admin/products/KPR-000123')).toBe('KPR-000123');
  expect(product360.productRefFromPath('/admin/products')).toBeNull();
  expect(product360.productRefFromPath('/api/products/KPR-000123')).toBeNull();
});

test('metricItems ne fait que formatter les valeurs déjà préparées par le serveur', () => {
  const metrics = product360.metricItems(payload());

  expect(metrics.map(row => row.key)).toEqual(['stock', 'sold', 'revenue', 'orders', 'margin', 'central']);
  expect(metrics.find(row => row.key === 'stock').value).toBe('7');
  expect(metrics.find(row => row.key === 'margin').value).toContain('4');
  expect(metrics.find(row => row.key === 'margin').tone).toBe('critical');
  expect(metrics.find(row => row.key === 'central').value).toBe('Central uniquement');
});

test('variantLabel ne fait que présenter le variant_combo serveur', () => {
  expect(product360.variantLabel({ couleur: 'Noir', taille: 'M' })).toBe('couleur: Noir · taille: M');
  expect(product360.variantLabel(null)).toBe('Défaut');
});

test('mount charge exclusivement l’endpoint Entity 360 dérivé de product_ref', async () => {
  const root = node();
  const fakeUi = ui();
  const document = { createElement: jest.fn(() => node()) };
  const fetchFn = jest.fn(async url => ({
    ok: true,
    status: 200,
    json: async () => payload(),
    url,
  }));

  const result = await product360.mount({
    root,
    document,
    ui: fakeUi,
    fetch: fetchFn,
    pathname: '/admin/products/KPR-000123',
  });

  expect(result.endpoint).toBe('/api/admin/entities/products/KPR-000123');
  expect(fetchFn).toHaveBeenCalledWith(
    '/api/admin/entities/products/KPR-000123',
    expect.objectContaining({ method: 'GET', credentials: 'include' })
  );
  expect(fakeUi.MetricStrip.render).toHaveBeenCalled();
});
