'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const client360 = require('../../public/dashboards/canonical/js/client-360.js');

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
    AlertPanel: { render: jest.fn() },
  };
}

function payload() {
  return {
    client: {
      name: 'Amina', phone: '+2691234567', email: 'amina@example.test', country: 'KM',
      first_order_at: '2026-06-01T10:00:00Z', last_order_at: '2026-08-20T10:00:00Z', days_since_last_order: 5,
    },
    scope: { mode: 'market', markets: [{ code: 'KM', name: 'Comores', currency: 'KMF' }] },
    summary: { orders_valid: 2, markets: 1, shared_lists: 0, notifications: 0 },
    finance: { ltv_kmf: 150000, average_basket_kmf: 75000, paid_orders: 2, unpaid_orders: 0 },
    orders: [], top_products: [], shared_lists: [], notifications: [], timeline: [],
    security: { visibility: 'restricted' },
  };
}

test('phoneFromPath ne reconnaît que le détail Client 360', () => {
  expect(client360.phoneFromPath('/admin/clients/%2B2691234567')).toBe('+2691234567');
  expect(client360.phoneFromPath('/admin/clients')).toBeNull();
  expect(client360.phoneFromPath('/admin/orders/CMD-1')).toBeNull();
});

test('metricItems ne fait que formatter les valeurs serveur', () => {
  const metrics = client360.metricItems(payload());

  expect(metrics.map(row => row.key)).toEqual(['orders', 'ltv', 'basket', 'silence', 'markets', 'security']);
  expect(metrics.find(row => row.key === 'ltv').value).toContain('150');
  expect(metrics.find(row => row.key === 'security').value).toBe('Central uniquement');
});

test('mount charge exclusivement l’endpoint Entity 360 dérivé du téléphone URL', async () => {
  const root = node();
  const fakeUi = ui();
  const document = { createElement: jest.fn(() => node()) };
  const fetchFn = jest.fn(async url => ({
    ok: true,
    status: 200,
    json: async () => payload(),
    url,
  }));

  const result = await client360.mount({
    root,
    document,
    ui: fakeUi,
    fetch: fetchFn,
    pathname: '/admin/clients/%2B2691234567',
  });

  expect(result.endpoint).toBe('/api/admin/entities/clients/%2B2691234567');
  expect(fetchFn).toHaveBeenCalledWith(
    '/api/admin/entities/clients/%2B2691234567',
    expect.objectContaining({ method: 'GET', credentials: 'include' })
  );
  expect(fakeUi.MetricStrip.render).toHaveBeenCalled();
});
