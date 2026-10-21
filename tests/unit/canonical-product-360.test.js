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

test('Product 360 distingue un SKU préparé d’un SKU devenu vérité d’inventaire', () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'product-360.js'),
    'utf8'
  );
  expect(source).toContain("'SKU préparé'");
  expect(source).toContain("row.sku || row.supplier_sku");
});

test('Product 360 conserve le produit courant en ouvrant Catalogue', () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'product-360.js'),
    'utf8'
  );
  expect(source).toContain('/admin/workspaces/catalog?product_ref=');
  expect(source).toContain('encodeURIComponent(product.product_ref)');
});

test('Product 360 ouvre Pricing directement sur le produit courant', () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'product-360.js'),
    'utf8'
  );
  expect(source).toContain('/admin/workspaces/pricing?product_ref=');
  expect(source).toContain('encodeURIComponent(product.product_ref)');
});

test('supplierDrills ouvre Supplier 360 avec retour contextuel au produit', () => {
  const previous = global.KomerceCanonicalNavigation;
  global.KomerceCanonicalNavigation = {
    withReturnTo: (path, returnTo, label) => `${path}?return_to=${encodeURIComponent(returnTo)}&return_label=${encodeURIComponent(label)}`,
  };
  try {
    expect(product360.supplierDrills([
      { id: '22222222-2222-4222-8222-222222222222', name: 'CJ' },
      { id: null, name: 'Legacy sans identité' },
    ], 'KPR-000123')).toEqual([{
      label: 'CJ',
      href: '/admin/suppliers/22222222-2222-4222-8222-222222222222?return_to=%2Fadmin%2Fproducts%2FKPR-000123&return_label=Retour%20au%20produit',
    }]);
  } finally {
    global.KomerceCanonicalNavigation = previous;
  }
});

test('Product 360 réserve les identités fournisseur exactes à la facette centrale', () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'product-360.js'),
    'utf8'
  );
  expect(source).toContain("central.visibility === 'global'");
  expect(source).toContain("'Réf. unité fournisseur'");
  expect(source).toContain("'Provider'");
});

test('purchasingModeLabel présente la preuve sans transformer CLOSED ou NO_RECORD en activation runtime', () => {
  expect(product360.purchasingModeLabel({
    resolution: 'RECORDED',
    availability: 'CLOSED',
    highest_proof: 'UNQUALIFIED',
    environment: 'SANDBOX',
  })).toBe('CLOSED · UNQUALIFIED · SANDBOX');
  expect(product360.purchasingModeLabel({ resolution: 'NO_RECORD' })).toBe('NO_RECORD');
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

describe('Produit 360 — fil P1 par marché', () => {
  afterEach(() => { delete globalThis.KomerceCanonicalNavigation; });
  const load = () => {
    jest.resetModules();
    require('../../public/dashboards/canonical/js/navigation-policy-v4.js');
    return require('../../public/dashboards/canonical/js/product-360');
  };
  const payload = {
    product: { product_ref: 'KPR-000123' },
    market_thread: [
      { market: { code: 'CM', name: 'Cameroun' }, price: { status: 'LOCAL_ACTIVE', amount: 20000, currency: 'XAF' }, exposure: { commercial_exposure: 'ENABLED', decision_recorded: true }, buyer_visible: true },
      { market: { code: 'KM', name: 'Comores' }, price: { status: null, amount: null, currency: null }, exposure: { commercial_exposure: 'DISABLED', decision_recorded: false }, buyer_visible: false },
    ],
  };
  const globalCtx = { access: { mode: 'global' } };

  test('P4 : CM actif 20 000 XAF exposé sans action ; KM sans prix → « Définir le prix » vers l’Atelier du marché', () => {
    const rows = load().marketThreadRows(payload, globalCtx);
    expect(rows[0].price.replace(/\s/g, ' ')).toBe('Actif · 20 000 XAF');
    expect(rows[0].exposure).toBe('Exposé');
    expect(rows[0].next).toBeNull();
    expect(rows[1].price).toBe('Aucun prix pays');
    expect(rows[1].exposure).toBe('Pas encore décidée');
    const url = new URL(rows[1].next.href, 'http://x.test');
    expect(url.pathname).toBe('/admin/workspaces/pricing');
    expect(url.searchParams.get('product_ref')).toBe('KPR-000123');
    expect(url.searchParams.get('market')).toBe('KM');
    expect(url.searchParams.get('return_to')).toBe('/admin/products/KPR-000123');
    expect(rows[1].next.label).toContain('Atelier des prix');
  });

  test('prix actif mais non exposé → « Continuer → Catalogue pays » (market-catalog.html?market=&product_ref=)', () => {
    const mod = load();
    const row = { market: { code: 'CM' }, price: { status: 'LOCAL_ACTIVE' }, exposure: { commercial_exposure: 'DISABLED' } };
    const next = mod.marketThreadNextStep(row, 'KPR-000123', globalCtx);
    const url = new URL(next.href, 'http://x.test');
    expect(url.pathname).toBe('/dashboards/canonical/market-catalog.html');
    expect(url.searchParams.get('market')).toBe('CM');
    expect(url.searchParams.get('product_ref')).toBe('KPR-000123');
  });

  test('prix en attente d’activation → Atelier ; statuts serveur libellés sans être recalculés', () => {
    const mod = load();
    const rows = mod.marketThreadRows({ product: { product_ref: 'KPR-1' }, market_thread: [
      { market: { code: 'CG' }, price: { status: 'DRAFT_PENDING_GATE', amount: 5000, currency: 'XAF' }, exposure: { commercial_exposure: 'DISABLED', decision_recorded: true } },
    ] }, globalCtx);
    expect(rows[0].price).toContain('Brouillon');
    expect(rows[0].exposure).toBe('Non exposé (décision enregistrée)');
    expect(rows[0].next.label).toBe('Continuer → Atelier des prix');
  });

  test('habilitation : sans capability sur le marché ou sans contexte, aucun lien (état affiché, pas d’action)', () => {
    const mod = load();
    const delegated = { access: { mode: 'market', defaultMarket: 'KM', delegatedCapabilities: { KM: ['catalog.expose'], CM: [] } } };
    const rows = mod.marketThreadRows(payload, delegated);
    expect(rows[1].next).toBeNull();   // KM : pricing.decide absent
    expect(mod.marketThreadRows(payload, null).every(r => r.next === null)).toBe(true);
  });

  test('payload sans market_thread : aucune section ; liste vide : message explicite', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/product-360.js'), 'utf8');
    expect(src).toContain('if (!Array.isArray(payload && payload.market_thread)) return;');
    expect(src).toContain('Aucun marché actif dans votre périmètre.');
    expect(load().marketThreadRows({ product: { product_ref: 'X' } }, globalCtx)).toEqual([]);
  });
});
