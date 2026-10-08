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

test('controlPositionItem reste compact et ne fait que formater la projection backend', () => {
  expect(order360.controlPositionItem({
    control_position: {
      stage: 'HUB_CONTROL',
      health: 'RED',
      exception: { summary: 'Unité HUB en quarantaine' },
      envelope: { type: 'HUB_UNIT', refs: ['KOM-RCV-001'] },
    },
  })).toEqual({
    level: 'critical',
    title: 'Contrôle HUB · Bloquée',
    message: 'Unité HUB en quarantaine · HUB_UNIT · KOM-RCV-001',
  });

  expect(order360.controlPositionItem({
    control_position: {
      stage: 'PURCHASING',
      health: 'ORANGE',
      exception: { summary: 'Paiement fournisseur bloqué' },
      envelope: { type: 'PURCHASE_ORDER', refs: [] },
    },
  })).toEqual({
    level: 'warning',
    title: 'Achats · À risque',
    message: 'Paiement fournisseur bloqué · PURCHASE_ORDER',
  });

  expect(order360.controlPositionItem({})).toBeNull();
});

test('controlPositionItem : santé absente/inconnue = Non observé (jamais Normal) ; 3 causes + propriétaire', () => {
  for (const health of [undefined, null, 'UNKNOWN', 'green']) {
    const item = order360.controlPositionItem({ control_position: { stage: 'HUB_CONTROL', health } });
    expect(item.title).toBe('Contrôle HUB · Non observé');
    expect(item.title).not.toContain('Normal');
    expect(item.level).toBe('info');
  }
  expect(order360.controlPositionItem({ control_position: { stage: 'PURCHASING', health: 'GREEN' } }).title).toBe('Achats · Normal');
  const multi = order360.controlPositionItem({
    control_position: {
      stage: 'HUB_CONTROL', health: 'RED',
      exceptions: [
        { code: 'a', summary: 'Cause A', owner_role: 'hub' },
        { code: 'b', summary: 'Cause B' },
        { code: 'c', summary: 'Cause C', owner_role: 'finance' },
        { code: 'd', summary: 'Cause D' },
      ],
    },
  });
  expect(multi.message).toBe('Cause A — hub · Cause B · Cause C — finance');
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


test('purchaseOrderDrills ouvre la PO dans Achats avec retour contextuel vers Order 360', () => {
  const previous = globalThis.KomerceCanonicalNavigation;
  globalThis.KomerceCanonicalNavigation = {
    withReturnTo(path, returnTo, label) {
      const q = new URLSearchParams();
      q.set('return_to', returnTo);
      q.set('return_label', label);
      return path + (path.includes('?') ? '&' : '?') + q.toString();
    },
  };

  try {
    const drills = order360.purchaseOrderDrills({
      purchase_orders: [{
        id: 'cccccccc-cccc-4ccc-8ccc-000000000001',
        status: 'confirmed',
        supplier_name: 'CJdropshipping',
        supplier_platform: 'cj',
        procurement_hub_ref: 'DXB',
        supplier_order_id: 'CJ-42',
      }],
    }, 'CMD-CM-001');

    expect(drills).toHaveLength(1);
    expect(drills[0]).toEqual(expect.objectContaining({
      title: 'CJdropshipping · PO cccccccc',
      message: 'confirmed · Hub DXB · Commande fournisseur CJ-42',
      actionLabel: 'Ouvrir dans Achats',
    }));
    expect(drills[0].href).toContain('/admin/workspaces/purchasing?po=cccccccc-cccc-4ccc-8ccc-000000000001');
    expect(drills[0].href).toContain('return_to=%2Fadmin%2Forders%2FCMD-CM-001');
    expect(drills[0].href).toContain('return_label=Retour+%C3%A0+la+commande');
  } finally {
    globalThis.KomerceCanonicalNavigation = previous;
  }
});
