'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function loadPolicy() {
  jest.resetModules();
  delete global.KomerceCanonicalNavigation;
  delete global.window;
  delete global.document;
  require('../../public/dashboards/canonical/js/navigation-policy-v4.js');
  return global.KomerceCanonicalNavigation;
}

afterEach(() => {
  delete global.KomerceCanonicalNavigation;
  delete global.window;
  delete global.document;
});

function domainIds(nav, role) {
  return nav.visibleDomainsFor({ role }).map(domain => domain.id);
}

function spaceIds(nav, domainId, role) {
  const domain = nav.DOMAINS.find(item => item.id === domainId);
  return nav.visibleSpacesFor(domain, role).map(space => space.id);
}

describe('Canonical Navigation Policy V3.1', () => {
  test('Catalogue global reste une autorité admin ; le responsable pays pilote via Marchés', () => {
    const nav = loadPolicy();
    expect(domainIds(nav, 'admin')).toEqual([
      'dashboard', 'pricing', 'catalog', 'orders', 'markets', 'operations', 'live', 'finance',
    ]);
    expect(domainIds(nav, 'market_operator')).toEqual([
      'dashboard', 'pricing', 'orders', 'markets', 'operations', 'finance',
    ]);
    expect(domainIds(nav, 'market_operator')).not.toContain('catalog');
  });

  test('les rôles spécialisés ne reçoivent jamais un faux Dashboard', () => {
    const nav = loadPolicy();
    expect(domainIds(nav, 'finance')).toEqual(['finance']);
    expect(domainIds(nav, 'sourcing')).toEqual(['live']);
    expect(domainIds(nav, 'agent_hub')).toEqual(['operations', 'live']);
    expect(domainIds(nav, 'agent_relais')).toEqual(['operations', 'live', 'finance']);
    expect(domainIds(nav, 'agent_transitaire')).toEqual(['operations']);
    expect(domainIds(nav, 'support')).toEqual([]);
    for (const role of ['finance', 'sourcing', 'agent_hub', 'agent_relais', 'agent_transitaire', 'support']) {
      expect(domainIds(nav, role)).not.toContain('dashboard');
    }
  });

  test('N2 Opérations reflète exactement les guards de lecture serveur', () => {
    const nav = loadPolicy();
    expect(spaceIds(nav, 'operations', 'admin')).toEqual([
      'operations-overview', 'operations-workspace', 'shipping-customs-workspace', 'purchasing-workspace',
    ]);
    expect(spaceIds(nav, 'live', 'admin')).toEqual(['import-runtime', 'hub-live', 'relais-live']);
    expect(spaceIds(nav, 'live', 'sourcing')).toEqual(['import-runtime']);
    expect(spaceIds(nav, 'live', 'agent_hub')).toEqual(['hub-live']);
    expect(spaceIds(nav, 'live', 'agent_relais')).toEqual(['relais-live']);
    expect(spaceIds(nav, 'operations', 'market_operator')).toEqual([
      'operations-overview', 'operations-workspace', 'shipping-customs-workspace',
    ]);
    expect(spaceIds(nav, 'operations', 'agent_hub')).toEqual([
      'operations-workspace', 'shipping-customs-workspace',
    ]);
    expect(spaceIds(nav, 'operations', 'agent_relais')).toEqual(['operations-workspace']);
    expect(spaceIds(nav, 'operations', 'agent_transitaire')).toEqual(['shipping-customs-workspace']);
    expect(spaceIds(nav, 'operations', 'sourcing')).toEqual([]);
  });

  test('N2 Finance reflète Comptabilité terrain et vue pays', () => {
    const nav = loadPolicy();
    expect(spaceIds(nav, 'finance', 'admin')).toEqual(['finance-overview', 'accounting-workspace']);
    expect(spaceIds(nav, 'finance', 'market_operator')).toEqual(['finance-overview', 'accounting-workspace']);
    expect(spaceIds(nav, 'finance', 'finance')).toEqual(['accounting-workspace']);
    expect(spaceIds(nav, 'finance', 'agent_relais')).toEqual(['accounting-workspace']);
  });

  test('les landings de domaines spécialisés ne pointent jamais vers une surface interdite', () => {
    const nav = loadPolicy();
    const operations = nav.DOMAINS.find(item => item.id === 'operations');
    const finance = nav.DOMAINS.find(item => item.id === 'finance');
    const live = nav.DOMAINS.find(item => item.id === 'live');
    expect(nav.landingForDomain(live, { role: 'sourcing' })).toBe('/admin/import-runtime');
    expect(nav.landingForDomain(operations, { role: 'sourcing' })).toBeNull();
    expect(nav.landingForDomain(operations, { role: 'agent_hub' })).toBe('/admin/workspaces/operations');
    expect(nav.landingForDomain(operations, { role: 'agent_relais' })).toBe('/admin/workspaces/operations');
    expect(nav.landingForDomain(operations, { role: 'agent_transitaire' })).toBe('/admin/workspaces/shipping-customs');
    expect(nav.landingForDomain(finance, { role: 'finance' })).toBe('/admin/workspaces/accounting');
    expect(nav.landingForDomain(finance, { role: 'agent_relais' })).toBe('/admin/workspaces/accounting');
  });

  test('les landings générales correspondent au premier vrai espace métier', () => {
    const nav = loadPolicy();
    expect(nav.defaultLandingFor({ role: 'admin' })).toBe('/admin/pilotage');
    expect(nav.defaultLandingFor({ role: 'market_operator' })).toBe('/admin/pilotage');
    expect(nav.defaultLandingFor({ role: 'finance' })).toBe('/admin/workspaces/accounting');
    expect(nav.defaultLandingFor({ role: 'sourcing' })).toBe('/admin/import-runtime');
    expect(nav.defaultLandingFor({ role: 'agent_hub' })).toBe('/admin/workspaces/operations');
    expect(nav.defaultLandingFor({ role: 'agent_relais' })).toBe('/admin/workspaces/operations');
    expect(nav.defaultLandingFor({ role: 'agent_transitaire' })).toBe('/admin/workspaces/shipping-customs');
    expect(nav.defaultLandingFor({ role: 'support' })).toBe('/portail');
    expect(nav.defaultLandingFor({ role: 'unknown' })).toBe('/');
  });

  test('le responsable pays accède à son catalogue dans Marchés, pas via Catalogue global', () => {
    const nav = loadPolicy();
    const catalog = nav.DOMAINS.find(item => item.id === 'catalog');
    const markets = nav.DOMAINS.find(item => item.id === 'markets');
    expect(nav.landingForDomain(catalog, { role: 'market_operator' })).toBe('/admin/workspaces/catalog');
    expect(nav.visibleDomainsFor({ role: 'market_operator' }).some(item => item.id === 'catalog')).toBe(false);
    expect(nav.landingForDomain(markets, { role: 'market_operator' })).toBe('/dashboards/canonical/market-autonomy.html');
    expect(nav.activePrimarySurface('market-catalog')).toBe('markets');
    expect(nav.landingForDomain(catalog, { role: 'admin' })).toBe('/admin/workspaces/catalog');
    expect(nav.landingForDomain(markets, { role: 'admin' })).toBe('/dashboards/canonical/access.html');
  });

  test('les surfaces techniques restent parentées aux rubriques métier', () => {
    const nav = loadPolicy();
    expect(nav.activePrimarySurface('sourcing-workspace')).toBe('catalog');
    expect(nav.activePrimarySurface('import-runtime')).toBe('live');
    expect(nav.activeSpaceFor('import-runtime')).toBe('import-runtime');
    expect(nav.activePrimarySurface('shipping-customs-workspace')).toBe('operations');
    expect(nav.activePrimarySurface('accounting-workspace')).toBe('finance');
    expect(nav.activePrimarySurface('client-360')).toBe('orders');
    expect(nav.activePrimarySurface('product-360')).toBe('catalog');
    expect(nav.activePrimarySurface('market-catalog')).toBe('markets');
    expect(nav.activeSpaceFor('orders')).toBe('orders-overview');
    expect(nav.activeSpaceFor('client-index')).toBe('commerce');
  });

  test('toutes les entrées Canonical chargent UNE seule navigation (plus de couche V2.1/V3)', () => {
    const htmlFiles = [
      'public/dashboards/canonical/index.html',
      'public/dashboards/canonical/access.html',
      'public/dashboards/canonical/market-autonomy.html',
      'public/dashboards/canonical/market-catalog.html',
    ];
    htmlFiles.forEach(relative => {
      const html = fs.readFileSync(path.join(ROOT, relative), 'utf8');
      expect(html).not.toMatch(/js\/navigation\.js/);
      expect(html).not.toMatch(/js\/navigation-policy-v3\.js/);
      expect(html.match(/js\/navigation-policy-v4\.js/g)).toHaveLength(1);
    });
  });
});

describe('Canonical Navigation Policy — utilitaires d\'administration', () => {
  test('Paramètres, Utilisateurs et Providers restent autorisés à l\'admin (le garde de landing ne les renvoie pas au Pilotage)', () => {
    const nav = loadPolicy();
    const visible = domainIds(nav, 'admin');
    for (const surface of ['settings', 'users-admin', 'providers-admin']) {
      expect(visible).toContain(nav.activePrimarySurface(surface));
    }
  });

  test('chaque surface du menu latéral se rattache à un domaine visible pour l\'admin', () => {
    const nav = loadPolicy();
    const visible = domainIds(nav, 'admin');
    const surfaces = nav.SIDEBAR_GROUPS.flatMap(group => group.items.filter(item => item.roles.includes('admin')).flatMap(item => item.surfaces));
    for (const surface of surfaces) expect(visible).toContain(nav.activePrimarySurface(surface));
  });
});

describe('Canonical Navigation Policy — cadre hero-first', () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '..', '..', 'public/dashboards/canonical/js/navigation-policy-v4.js'),
    'utf8'
  );

  test('les overviews et les workspaces reçoivent la classe kmc-hero-first', () => {
    const block = source.match(/const HERO_FIRST_SURFACES = new Set\(\[([\s\S]*?)\]\)/)[1];
    for (const surface of ['pilotage', 'commerce', 'orders', 'operations', 'finance', 'action-center',
      'pricing-workspace', 'catalog-workspace', 'sourcing-workspace', 'purchasing-workspace',
      'operations-workspace', 'shipping-customs-workspace', 'accounting-workspace', 'client-index', 'users-admin', 'providers-admin']) {
      expect(block).toContain(`'${surface}'`);
    }
    expect(source).toContain("classList?.toggle?.('kmc-hero-first', HERO_FIRST_SURFACES.has(surface))");
  });
});
