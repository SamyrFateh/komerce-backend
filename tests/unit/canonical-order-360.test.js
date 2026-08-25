'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const order360 = require('../../public/dashboards/canonical/js/order-360');

test('referenceFromPath accepte uniquement la route Entity 360 stable', () => {
  expect(order360.referenceFromPath('/admin/orders/CMD-CM-001')).toBe('CMD-CM-001');
  expect(order360.referenceFromPath('/admin/orders/CMD%20TEST')).toBe('CMD TEST');
  expect(order360.referenceFromPath('/admin/operations')).toBeNull();
  expect(order360.referenceFromPath('/admin/orders/a/b')).toBeNull();
});

test('metricItems ne recalcule aucune vérité économique', () => {
  const metrics = order360.metricItems({
    order: {
      status: 'shipped',
      payment: { status: 'paid', total_kmf: 12000 },
    },
    summary: { parcels: 2, open_incidents: 1, documents: 3 },
  });

  expect(metrics.map(metric => metric.value)).toEqual([
    'shipped',
    'paid',
    '12 000 KMF',
    '2',
    '1',
    '3',
  ]);
  expect(metrics.find(metric => metric.key === 'incidents').tone).toBe('critical');
});

test('productDrills ouvre Product 360 par product_ref et déduplique les lignes', () => {
  const drills = order360.productDrills([
    { product_ref: 'KPR-000123', product_name: 'Produit A' },
    { product_ref: 'KPR-000123', product_name: 'Produit A' },
    { product_ref: 'KPR-000456', product_name: 'Produit B' },
    { product_ref: null, product_name: 'Ancien produit' },
  ]);

  expect(drills).toEqual([
    expect.objectContaining({ title: 'Produit A', href: '/admin/products/KPR-000123', actionLabel: 'Product 360' }),
    expect.objectContaining({ title: 'Produit B', href: '/admin/products/KPR-000456', actionLabel: 'Product 360' }),
  ]);
});

test('mount charge la référence dans le namespace Entity 360', async () => {
  const root = { replaceChildren: jest.fn(), appendChild: jest.fn(), className: '' };
  const fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 404,
    json: jest.fn().mockResolvedValue({ error: 'Commande introuvable' }),
  });
  const ui = {
    UIState: { render: jest.fn() },
    DataTable: { render: jest.fn() },
    Section: { create: jest.fn() },
    MetricStrip: { render: jest.fn() },
    AlertPanel: { render: jest.fn() },
  };

  await expect(order360.mount({
    root,
    document: {},
    ui,
    fetch,
    pathname: '/admin/orders/CMD-CM-001',
  })).rejects.toThrow('Commande introuvable');

  expect(fetch).toHaveBeenCalledWith(
    '/api/admin/entities/orders/CMD-CM-001',
    expect.objectContaining({ method: 'GET', credentials: 'include' })
  );
  expect(ui.UIState.render).toHaveBeenNthCalledWith(1, root, 'loading', 'Chargement de la commande…');
  expect(ui.UIState.render).toHaveBeenLastCalledWith(root, 'error', 'Commande introuvable');
});
