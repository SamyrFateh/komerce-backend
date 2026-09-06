'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

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
    setHeader: jest.fn(), sendFile: jest.fn(), redirect: jest.fn(),
    status: jest.fn().mockReturnThis(), send: jest.fn(), json: jest.fn(),
  };
}

test('URL Pricing et anciens points d?entr?e convergent vers Canonical avec rollback Legacy explicite', () => {
  const app = fakeApp();
  mountHtmlRoutes(app, ROOT);

  const canonicalRes = fakeRes();
  app._routes['/admin/workspaces/pricing']({}, canonicalRes);
  expect(canonicalRes.setHeader)
    .toHaveBeenCalledWith('X-Admin-Generation', 'canonical');

  for (const routePath of [
    '/admin/pricing',
    '/admin/pricing-workshop',
    '/admin/pricing-strategy',
    '/admin/economic-flow',
    '/admin/economic',
  ]) {
    const canonicalAliasRes = fakeRes();
    app._routes[routePath]({ query: {} }, canonicalAliasRes);
    expect(canonicalAliasRes.redirect)
      .toHaveBeenCalledWith(302, '/admin/workspaces/pricing');

    const legacyRes = fakeRes();
    app._routes[routePath]({ query: { legacy: '1' } }, legacyRes);
    expect(legacyRes.setHeader)
      .toHaveBeenCalledWith('X-Admin-Generation', 'legacy-1');
  }
});

test('Simulator reste explicitement hors Pricing 4F', () => {
  const app = fakeApp();
  mountHtmlRoutes(app, ROOT);
  const res = fakeRes();
  app._routes['/admin/simulator']({}, res);
  expect(res.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'legacy-1');
  const contract = fs.readFileSync(path.join(ROOT, 'docs', 'contract', 'PRICING_WORKSPACE_4F.md'), 'utf8');
  expect(contract).toContain('SimulatorView');
  expect(contract).toMatch(/hors 4F/i);
});

test('runtime Pricing n’importe aucune vue Legacy ni API historique', () => {
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-workspace.js'), 'utf8');
  expect(index).toContain('/dashboards/canonical/js/pricing-workspace.js');
  expect(source).not.toMatch(/\/dashboards\/admin(?:-legacy)?\//);
  expect(source).not.toMatch(/\b(?:PricingView|PricingWorkshopView|PricingStrategyView|EconomicFlowView|SimulatorView|ApiClient|KmcApi)\b/);
  expect(source).not.toContain("'/api/pricing");
  expect(source).not.toContain('/api/admin/cost-components');
  expect(source).not.toContain('/api/admin/economic');
  expect(source).toContain('/api/admin/workspaces/pricing');
  expect(source).toContain('Santé économique globale');
  expect(source).toContain('Variables économiques');
  expect(source).toContain('Charges économiques');
});

test('Atelier market rend le viewer en lecture seule et réserve les mutations au manager', () => {
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
  const presentation = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-workspace-presentation.js'), 'utf8');
  expect(index).toContain('/dashboards/canonical/js/pricing-workspace-presentation.js?v=1215');
  expect(presentation).toContain('payload.capabilities?.cost_overrides');
  expect(presentation).toContain("payload.access?.read_only !== true");
  expect(presentation).toContain('input.disabled = true');
  expect(presentation).toContain('Lecture seule');
  expect(presentation).toContain('manager pays');
});

test('chaque ligne de coût expose provenance, hypothèse, mouvement, impact et vérité', () => {
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
  const presentation = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-workspace-presentation.js'), 'utf8');
  const css = fs.readFileSync(path.join(CANONICAL, 'css', 'pricing-workspace.css'), 'utf8');
  const service = fs.readFileSync(path.join(ROOT, 'services', 'pricing-cost-explainability.js'), 'utf8');

  expect(index).toContain('/dashboards/canonical/css/pricing-workspace.css?v=1215');
  expect(presentation).toContain('Comprendre cette ligne');
  expect(presentation).toContain('D’où vient la valeur');
  expect(presentation).toContain('Hypothèse portée');
  expect(presentation).toContain('Ce qui la fait bouger');
  expect(presentation).toContain('Qualité de vérité');
  expect(css).toContain('.kmc-cost-explain-body');
  expect(service).toContain('never_promote_config_to_real');
  expect(service).toContain('N3 → charge économique de période');
});

test('Pricing Canonical est global et utilise uniquement refs métier navigateur', () => {
  const appSource = fs.readFileSync(path.join(CANONICAL, 'js', 'app.js'), 'utf8');
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'pricing-workspace.js'), 'utf8');
  expect(appSource).toContain("PRICING_WORKSPACE: 'pricing-workspace'");
  expect(source).toContain('product_ref');
  expect(source).toContain('competitor_ref');
  expect(source).not.toContain('market_id');
  expect(source).not.toContain('marketId');
  expect(source).not.toContain('product_id');
  expect(source).not.toContain('competitor_id');
});

test('service délègue aux autorités pricing existantes', () => {
  const source = fs.readFileSync(path.join(ROOT, 'services', 'pricing-workspace.js'), 'utf8');
  expect(source).toContain("require('./pricing-engine')");
  expect(source).toContain("require('./pricing-recommend')");
  expect(source).toContain("require('./pricing-apply')");
  expect(source).toContain("require('./pricing-strategy-service')");
  expect(source).toContain("require('./cost-component-admin-service')");
  expect(source).toContain("require('./pricing-cost-explainability')");
  expect(source).toContain("require('./economic-engine-queries')");
});

test('Pilotage Financier converge vers Finance avec rollback Legacy explicite', () => {
  const app = fakeApp();
  mountHtmlRoutes(app, ROOT);

  const canonicalRes = fakeRes();
  app._routes['/admin/pilotage-fin']({ query: {} }, canonicalRes);
  expect(canonicalRes.redirect).toHaveBeenCalledWith(302, '/admin/finance');

  const legacyRes = fakeRes();
  app._routes['/admin/pilotage-fin']({ query: { legacy: '1' } }, legacyRes);
  expect(legacyRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'legacy-1');
});
