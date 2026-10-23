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
    summary: { items: 2, items_assigned: 1, parcels: 2, open_incidents: 1, documents: 3 },
  });

  expect(metrics.map(metric => metric.value)).toEqual([
    'shipped',
    'paid',
    '12 000 KMF',
    '1/2',
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

describe('Commande 360 — fil de la commande (P2)', () => {
  test('statut + historique du serveur, en ordre chronologique ; le statut courant est marqué', () => {
    const steps = order360.threadSteps({
      order: { status: 'shipped' },
      history: [
        { status: 'shipped', created_at: '2026-10-03T10:00:00Z' },
        { status: 'confirmed', created_at: '2026-10-01T10:00:00Z' },
        { status: 'pending', created_at: '2026-10-01T09:00:00Z' },
      ],
    });
    expect(steps.map(s => s.status)).toEqual(['pending', 'confirmed', 'shipped']);
    expect(steps.map(s => s.current)).toEqual([false, false, true]);
    expect(steps[2].label).toBe('Expédiée');
  });

  test('sans historique : seul le statut courant, aucune étape inventée ; sans statut : rien', () => {
    expect(order360.threadSteps({ order: { status: 'confirmed' }, history: [] })).toEqual([
      { status: 'confirmed', label: 'Confirmée', date: null, current: true },
    ]);
    expect(order360.threadSteps({ order: {}, history: [] })).toEqual([]);
  });
});

describe('Commande 360 — section Coûts & écarts (projection Finance, lecture seule)', () => {
  const costs = {
    sale_total_kmf: 15065, estimated_cost_kmf: 10000, real_cost_kmf: 10300, consolidated_margin_kmf: 4765,
    cost_status: 'actual', missing_cost_types: [],
    variance: {
      class: 'overrun', cost_variance_kmf: 300,
      components: [
        { type: 'freight', label: 'Fret', state: 'confirmed', estimated_kmf: 1000, real_kmf: 1300, delta_kmf: 300, owner: { label: 'Expéditions & Douane', href: '/admin/workspaces/shipping-customs' } },
        { type: 'hub', label: 'Hub', state: 'unknown', estimated_kmf: 500, real_kmf: null, delta_kmf: null, owner: { label: 'Hub', href: '/admin/hub-live' } },
        { type: 'customs', label: 'Douane', state: 'confirmed', estimated_kmf: 0, real_kmf: 0, delta_kmf: 0, owner: { label: 'Expéditions & Douane', href: '/admin/workspaces/shipping-customs' } },
      ],
    },
  };

  test('libellés fidèles : « Coûts constatés », marge réelle finalisée (4 765 RCT1-E1), écart signé', () => {
    const rows = order360.costsSummaryRows(costs);
    expect(rows.map(r => r.poste)).toEqual([
      'Prix de vente', 'Coûts estimés (figés à la commande)', 'Coûts constatés', 'Marge réelle finalisée', 'Écart de coût (constaté − estimé)',
    ]);
    expect(rows[3].valeur.replace(/\s/g, ' ')).toBe('4 765 KMF');
    expect(rows[4].valeur.replace(/\s/g, ' ')).toBe('+300 KMF');
    expect(JSON.stringify(rows)).not.toContain('engagé');
  });

  test('inconnu ≠ zéro ; marge non finalisée jamais extrapolée', () => {
    const rows = order360.costsSummaryRows({ ...costs, estimated_cost_kmf: null, real_cost_kmf: null, consolidated_margin_kmf: null, variance: { class: 'not_comparable', cost_variance_kmf: null } });
    expect(rows[1].valeur).toBe('Non établi');
    expect(rows[2].valeur).toBe('Non établi');
    expect(rows[3].valeur).toBe('Non finalisée');
    expect(rows[3].note).toContain('jamais extrapolée');
    expect(rows[4].valeur).toBe('Non comparable');
    expect(order360.costComponentRows(costs)[1]).toEqual(expect.objectContaining({ constate: '—', ecart: '—', etat: 'Inconnu' }));
  });

  test('liens vers les espaces propriétaires dédoublonnés, avec retour à la commande (#couts)', () => {
    jest.resetModules();
    require('../../public/dashboards/canonical/js/navigation-policy-v4.js');
    const fresh = require('../../public/dashboards/canonical/js/order-360');
    try {
      const links = fresh.costOwnerLinks(costs, 'RCT1-E1');
      expect(links.map(l => l.label)).toEqual(['Expéditions & Douane', 'Hub']);
      const url = new URL(links[0].href, 'http://x.test');
      expect(url.pathname).toBe('/admin/workspaces/shipping-customs');
      expect(url.searchParams.get('return_to')).toBe('/admin/orders/RCT1-E1#couts');
    } finally {
      delete globalThis.KomerceCanonicalNavigation;
    }
  });

  test('renderPayload : section #couts seulement si le serveur fournit costs (finance.read) ; null = non applicable', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/order-360.js'), 'utf8');
    expect(src).toContain("if (!Object.prototype.hasOwnProperty.call(payload, 'costs')) return;");
    expect(src).toContain("section.element.id = 'couts'");
    expect(src).toContain('Coûts non applicables : commande annulée ou remboursée.');
  });
});

test('L6 : l’en-tête order-360 ne porte pas de lien « ← » concurrent du retour du shell', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../public/dashboards/canonical/js/order-360.js'), 'utf8');
  expect(src).not.toMatch(/'← (Opérations|Commerce)'/);
});
