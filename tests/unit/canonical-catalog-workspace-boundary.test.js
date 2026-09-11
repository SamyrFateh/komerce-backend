'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const catalogWorkspace = require('../../public/dashboards/canonical/js/catalog-workspace');
const catalogDecision = require('../../public/dashboards/canonical/js/catalog-workspace-decision');

jest.mock('../../utils/logger', () => ({ child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }) }));

const { mountHtmlRoutes } = require('../../bootstrap/html-routes');
const ROOT = path.join(__dirname, '..', '..');
const CANONICAL = path.join(ROOT, 'public', 'dashboards', 'canonical');

function fakeApp() {
  const routes = {};
  return { get: jest.fn((routePath, handler) => { routes[routePath] = handler; }), _routes: routes };
}

function fakeRes() {
  return {
    headersSent: false,
    setHeader: jest.fn(),
    sendFile: jest.fn(),
    redirect: jest.fn(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
    json: jest.fn(),
  };
}

test('URL Catalogue et anciens points d’entrée convergent vers Canonical avec rollback Legacy', () => {
  const app = fakeApp();
  mountHtmlRoutes(app, ROOT);

  const canonicalRes = fakeRes();
  app._routes['/admin/workspaces/catalog']({}, canonicalRes);
  expect(canonicalRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'canonical');
  expect(canonicalRes.sendFile).toHaveBeenCalledWith(path.join(CANONICAL, 'index.html'), expect.any(Function));

  for (const routePath of ['/admin/products', '/admin/categories', '/admin/catalog-approval']) {
    const cutoverRes = fakeRes();
    app._routes[routePath]({ query: {} }, cutoverRes);
    expect(cutoverRes.redirect).toHaveBeenCalledWith(302, '/admin/workspaces/catalog');
    expect(cutoverRes.sendFile).not.toHaveBeenCalled();

    const legacyRes = fakeRes();
    app._routes[routePath]({ query: { legacy: '1' } }, legacyRes);
    expect(legacyRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'legacy-1');
    expect(legacyRes.sendFile).toHaveBeenCalledWith(
      path.join(ROOT, 'public', 'dashboards', 'admin', 'index.html'),
      expect.any(Function)
    );
  }
});

test('runtime charge Catalogue sans importer les vues Legacy ni leurs API', () => {
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'catalog-workspace.js'), 'utf8');

  expect(index).toContain('/dashboards/canonical/js/catalog-workspace.js');
  expect(index).toContain('/dashboards/canonical/js/catalog-workspace-decision.js');
  expect(source).not.toMatch(/\/dashboards\/admin(?:-legacy)?\//);
  expect(source).not.toMatch(/\b(?:ProductsView|CategoriesView|CatalogApprovalView|ApiClient)\b/);
  expect(source).not.toContain("'/api/products");
  expect(source).not.toContain('/api/admin/boutique-categories');
  expect(source).not.toContain('/api/admin/catalog/approval-queue');
  expect(source).toContain('/api/admin/workspaces/catalog');
});

test('Catalogue est global central et Product 360 reste le drill-down', () => {
  const appSource = fs.readFileSync(path.join(CANONICAL, 'js', 'app.js'), 'utf8');
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'catalog-workspace.js'), 'utf8');
  expect(appSource).toContain("CATALOG_WORKSPACE: 'catalog-workspace'");
  expect(source).toContain('/admin/products/${encodeURIComponent(row.product_ref)}');
  expect(source).not.toContain('market_id');
  expect(source).not.toContain('marketId');
  expect(source).not.toContain('marketCode');
});

test('projection decision-first Catalogue ne fabrique que les signaux prouvés', () => {
  const payload = {
    scope: { mode: 'global_catalog', label: 'Catalogue commun Komerce' },
    summary: { active_products: 2, approval_pending: 1, needs_review: 1, categories: 1 },
    curation: {
      catalog_cap_mvp: 120,
      published_products: 2,
      remaining_slots: 118,
      fill_pct: 2,
      at_cap: false,
      first_publication_authority: 'human_approval',
      catalog_scope: 'global',
    },
    approval: [{ product_ref: 'KPR-2', name: 'À valider' }],
    products: [
      { product_ref: 'KPR-1', name: 'Publié', category: 'Maison', is_active: true, needs_review: false, content_source: 'manual' },
      { product_ref: 'KPR-3', name: 'À relire', category: 'Maison', is_active: true, needs_review: true, content_source: 'ai_enriched' },
    ],
    categories: [{ key: 'Maison', label: 'Maison', is_active: true, show_in_rail: true, subcategories: [] }],
  };

  const decisions = catalogDecision.decisionItems(payload);
  expect(decisions.map(item => item.label)).toEqual(['Produits à curater', 'Produits à relire']);
  expect(decisions.some(item => /prix local|média|traduction|publier/i.test(item.label))).toBe(false);

  const metrics = catalogDecision.metricItems(payload, catalogWorkspace);
  expect(metrics.map(item => item.label)).toEqual([
    'Produits publiés', 'À curater', 'À relire', 'Catégories actives', 'Cap utilisé',
  ]);
  expect(catalogDecision.productItems(payload)[1]).toEqual(expect.objectContaining({
    title: 'À relire', value: 'À relire', tone: 'warning', href: '/admin/products/KPR-3',
  }));
  expect(catalogDecision.trust(payload)).toEqual(expect.objectContaining({
    scopeLabel: 'Catalogue commun Komerce',
    qualityLabel: 'Première publication : validation humaine',
  }));
});
