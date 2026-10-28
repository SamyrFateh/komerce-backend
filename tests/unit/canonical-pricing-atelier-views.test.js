'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const views = require(path.join(CANONICAL, 'js', 'pricing-atelier-views.js'));
const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-atelier-views.js'), 'utf8');

const corridor = (overrides = {}) => ({
  product: { product_ref: 'KPR-1', name: 'P', purchase_cost_kmf: 7000 },
  selected: { buyer_effective: false, price_kmf: 25000, economics: { minimum_safe_price_kmf: 17990, data_quality: { sources: { purchase_price: 'real' } } } },
  candidate: null,
  ...overrides,
});

describe('résolution de la vue et de l’URL', () => {
  test('vue par défaut économique, product_ref ouvre les produits, view explicite prioritaire', () => {
    expect(views.resolveView('')).toBe('economic');
    expect(views.resolveView('?market=KM')).toBe('economic');
    expect(views.resolveView('?product_ref=KPR-1')).toBe('products');
    expect(views.resolveView('?view=costs&product_ref=KPR-1')).toBe('costs');
    expect(views.resolveView('?view=inconnue')).toBe('economic');
  });

  test('withParams conserve les autres paramètres et retire les valeurs vides', () => {
    expect(views.withParams('?market=KM', { view: 'products', product_ref: 'KPR-1' })).toBe('?market=KM&view=products&product_ref=KPR-1');
    expect(views.withParams('?market=KM&view=products&product_ref=KPR-1', { view: null, product_ref: null })).toBe('?market=KM');
    expect(views.withParams('', { view: null })).toBe('');
  });
});

describe('classement de la file (affichage, jamais recalcul économique)', () => {
  test.each([
    ['coût d’achat nul', corridor({ product: { purchase_cost_kmf: 0 } }), 'cost_missing'],
    ['coût d’achat absent', corridor({ product: {} }), 'cost_missing'],
    ['source achat manquante', corridor({ selected: { economics: { data_quality: { sources: { purchase_price: 'missing' } } } } }), 'cost_missing'],
    ['brouillon sous plancher', corridor({ candidate: { price_kmf: 9000, amount: 9000 } }), 'under_floor'],
    ['actif sous plancher', corridor({ selected: { buyer_effective: true, price_kmf: 10000, economics: { minimum_safe_price_kmf: 17990 } } }), 'under_floor'],
    ['actif', corridor({ selected: { buyer_effective: true, price_kmf: 30000, economics: { minimum_safe_price_kmf: 17990 } } }), 'active'],
    ['brouillon', corridor({ candidate: { price_kmf: 30000, amount: 30000 } }), 'draft'],
    ['à décider', corridor(), 'to_decide'],
    ['corridor vide', undefined, 'cost_missing'],
  ])('%s → %s', (_label, input, expected) => {
    expect(views.classifyProduct(input).key).toBe(expected);
  });

  test('aucun plancher serveur : jamais « sous plancher » par hypothèse', () => {
    const result = views.classifyProduct(corridor({ selected: { buyer_effective: true, price_kmf: 100, economics: {} }, product: { purchase_cost_kmf: 5 } }));
    expect(result.key).toBe('active');
  });

  test('tri par urgence, filtres et recherche', () => {
    const make = (ref, input) => ({ product: { product_ref: ref, name: `Nom ${ref}` }, corridor: input, state: views.classifyProduct(input) });
    const rows = [make('A', corridor()), make('B', corridor({ product: { purchase_cost_kmf: 0 } })), make('C', corridor({ selected: { buyer_effective: true, price_kmf: 30000, economics: { minimum_safe_price_kmf: 1 } } }))];
    expect(views.filterRows(rows, 'todo', '').map(row => row.product.product_ref)).toEqual(['B', 'A']);
    expect(views.filterRows(rows, 'all', '').map(row => row.product.product_ref)).toEqual(['B', 'A', 'C']);
    expect(views.filterRows(rows, 'active', '').map(row => row.product.product_ref)).toEqual(['C']);
    expect(views.filterRows(rows, undefined, 'nom a').map(row => row.product.product_ref)).toEqual(['A']);
    expect(views.summarizeQueue(rows)).toMatchObject({ all: 3, todo: 2, cost_missing: 1, to_decide: 1, active: 1 });
  });
});

describe('priorités économiques', () => {
  const labels = { MARKET_DECISION_POLICY_REQUIRED: 'Politique requise.' };
  test('gate non décisionnel avec raison serveur, sans action inventée', () => {
    const items = views.priorityItems({ decision: { decision_status: 'NOT_DECISIONAL', reason: 'MARKET_DECISION_POLICY_REQUIRED' }, components: [], counts: null, reasonLabels: labels });
    expect(items).toEqual([{ id: 'gate', tone: 'warning', title: 'Couverture non décisionnelle', detail: 'Politique requise.', action: null }]);
    expect(views.priorityItems({ decision: { decision_status: 'NOT_DECISIONAL' }, components: [], counts: null })[0].detail).toBe('Raison serveur non précisée.');
    expect(views.priorityItems({ decision: { decision_status: 'DECISIONAL' }, components: [], counts: null })).toEqual([]);
    expect(views.priorityItems({ decision: null, components: undefined, counts: null })).toEqual([]);
  });

  test('lignes de coût sans valeur et compteurs produits (pluriels, portée affichée)', () => {
    const components = [
      { key: 'a', label: 'Fret', default_value: null, is_active: true },
      { key: 'b', default_value: undefined },
      { key: 'c', default_value: 5 },
      { key: 'd', default_value: null, is_active: false },
      { key: 'e', default_value: null, family: 'exceptional' },
    ];
    expect(views.missingCostComponents(components).map(component => component.key)).toEqual(['a', 'b']);
    const items = views.priorityItems({ decision: null, components, counts: { cost_missing: 2, under_floor: 1, to_decide: 0, draft: 3 }, evaluated: 6, total: 9 });
    expect(items.map(item => item.id)).toEqual(['cost-lines', 'products-cost_missing', 'products-under_floor', 'products-draft']);
    expect(items[0].title).toBe('2 lignes du modèle de coûts sans valeur');
    expect(items[0].detail).toBe('Fret · b');
    expect(items[1].title).toBe('2 produits sans coût d’achat');
    expect(items[1].detail).toBe('Parmi 6 produits évalués sur 9.');
    expect(items[2].title).toBe('1 produit sous le plancher moteur');
    expect(items[2].action).toEqual({ label: 'Examiner ces produits', view: 'products', filter: 'under_floor' });
    expect(views.priorityItems({ decision: null, components: [{ key: 'x', default_value: null }], counts: null })[0].title).toBe('1 ligne du modèle de coûts sans valeur');
    expect(views.priorityItems({ decision: null, components: [], counts: { cost_missing: 1 }, evaluated: 1, total: 1 })[0].detail).toBe('Parmi 1 produit évalué sur 1.');
  });
});

describe('formulaires et formats', () => {
  test('observation : validation avant envoi', () => {
    expect(views.observationPayload({ competitor_name: ' ', amount: '10' }).error).toMatch(/concurrent/i);
    expect(views.observationPayload({ competitor_name: 'Boutique', amount: '0' }).error).toMatch(/Montant/);
    expect(views.observationPayload({ competitor_name: 'Boutique', amount: 'abc' }).error).toMatch(/Montant/);
    expect(views.observationPayload({ competitor_name: 'Boutique', amount: '29000', source: '', notes: ' n ' }).body)
      .toEqual({ competitor_name: 'Boutique', amount: 29000, source: 'market_manager', notes: 'n' });
    expect(views.observationPayload({ competitor_name: 'Boutique', amount: 5, source: 'terrain' }).body).toEqual({ competitor_name: 'Boutique', amount: 5, source: 'terrain' });
  });

  test('formats : valeur absente = tiret, jamais zéro ni null', () => {
    expect(views.formatKmf(null)).toBe('—');
    expect(views.formatKmf('')).toBe('—');
    expect(views.formatKmf(undefined)).toBe('—');
    expect(views.formatMoney(undefined, 'KMF')).toBe('—');
    expect(views.formatMoney(1500, 'XAF')).toContain('XAF');
    expect(views.formatMoney(1500)).toContain('KMF');
    expect(views.formatKmf(7000)).toMatch(/7\s?000 KMF/);
    expect(views.formatDate(null)).toBe('—');
    expect(views.formatDate('pas une date')).toBe('—');
    expect(views.formatDate('2026-10-20T08:00:00Z')).toMatch(/2026/);
    expect(views.sourceLabel('real')).toBe('réel');
    expect(views.sourceLabel('autre')).toBe('autre');
    expect(views.sourceLabel(null)).toBe('—');
  });

  test('lien Catalogue pays : marché, produit et retour conservés', () => {
    const href = views.catalogueHref('KM', 'KPR-1', '/admin/workspaces/pricing?market=KM&view=products');
    expect(href).toContain('/dashboards/canonical/market-catalog.html?market=KM&product_ref=KPR-1');
    expect(decodeURIComponent(href)).toContain('return_to=/admin/workspaces/pricing?market=KM&view=products');
    expect(views.catalogueHref('KM', 'KPR-1')).not.toContain('return_to');
  });

  test('mapLimit respecte la concurrence et l’ordre des résultats', async () => {
    let running = 0;
    let peak = 0;
    const out = await views.mapLimit([1, 2, 3, 4, 5], 2, async value => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise(resolve => setTimeout(resolve, 2));
      running -= 1;
      return value * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  test('install sans workspace ou déjà installé : sans effet', () => {
    expect(views.install(null)).toBe(false);
    expect(views.install({})).toBe(false);
    const mount = jest.fn();
    expect(views.install({ KomerceCanonicalPricingWorkspace: { mount, __atelierViewsInstalled: true } })).toBe(false);
    const workspace = { mount: async () => ({}) };
    expect(views.install({ KomerceCanonicalPricingWorkspace: workspace })).toBe(true);
    expect(workspace.__atelierViewsInstalled).toBe(true);
  });
});

describe('contrat de sécurité et de gouvernance', () => {
  test('aucune activation, aucun calcul économique, aucun HTML injecté depuis des données', () => {
    expect(source).not.toMatch(/local-price\/activate/);
    expect(source).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write|\beval\(/);
    expect(source).not.toMatch(/apply-price|survival_price_kmf/);
    expect(source).toContain('/simulate-impact');
    expect(source).toContain('/local-price`');
    expect(source).toContain('/price-observations');
    expect(source).toContain('/local-price/activation-preview');
  });

  test('chargé après le cockpit et la chaîne de décision, avec CSS versionné', () => {
    const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
    expect(index.indexOf('pricing-atelier-views.js')).toBeGreaterThan(index.indexOf('pricing-product-focus.js'));
    expect(index.indexOf('pricing-atelier-views.js')).toBeGreaterThan(index.indexOf('pricing-economic-cockpit.js'));
    expect(index).toContain('/dashboards/canonical/css/pricing-atelier-views.css?v=');
  });
});
