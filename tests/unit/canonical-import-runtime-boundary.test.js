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

test('import runtime stable URL is served by Canonical generation', () => {
  const app = fakeApp();
  mountHtmlRoutes(app, ROOT);
  const res = fakeRes();
  app._routes['/admin/import-runtime']({ query: {} }, res);
  expect(res.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'canonical');
});

test('canonical import runtime is loaded without legacy dependency', () => {
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'import-runtime.js'), 'utf8');
  expect(index).toContain('/dashboards/canonical/js/import-runtime.js?v=260929-8');
  expect(index).toContain('/dashboards/canonical/css/import-runtime.css?v=260929-6');
  expect(source).toContain('/api/admin/workspaces/sourcing/import-cockpit');
  expect(source).not.toMatch(/\/dashboards\/admin(?:-legacy)?\//);
  expect(source).not.toMatch(/\b(?:ImportRuntimeView|KmcApi|ApiClient)\b/);
});

test('canonical app and navigation expose import runtime under Operations', () => {
  const app = fs.readFileSync(path.join(CANONICAL, 'js', 'app.js'), 'utf8');
  const nav = fs.readFileSync(path.join(CANONICAL, 'js', 'navigation-policy-v3.js'), 'utf8');
  expect(app).toContain("IMPORT_RUNTIME: 'import-runtime'");
  expect(app).toContain("path === '/admin/import-runtime'");
  expect(app).toContain('KomerceCanonicalImportRuntime');
  expect(nav).toContain("id: 'import-runtime'");
  expect(nav).toContain("href: '/admin/import-runtime'");
  expect(nav).toContain("'import-runtime': 'operations'");
});


test('import cockpit montre les décisions et délègue les détails aux pages dédiées', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'import-runtime.js'), 'utf8');
  const css = fs.readFileSync(path.join(CANONICAL, 'css', 'import-runtime.css'), 'utf8');
  expect(source).toContain('Décisions ouvertes');
  expect(source).toContain('Validation Catalogue requise');
  expect(source).toContain('Décisions de mise en vente');
  expect(source).toContain('Exceptions à traiter');
  expect(source).toContain('Historique technique');
  expect(source).toContain('PARCOURS MÉTIER');
  expect(source).toContain('Prêts à vendre');
  expect(source).toContain('En vente');
  expect(source).toContain('Non retenus');
  expect(source).toContain('Clôture du lot');
  expect(source).toContain('Catalogue global');
  expect(source).toContain('withReturnTo');
  expect(source).toContain('return_to');
  expect(source).toContain('Retour au lot');
  expect(source).toContain('Alimentation automatique');
  expect(source).toContain('Préparation auto');
  expect(source).toContain('activation_ready');
  expect(source).toContain('data-source-toggle');
  expect(source).toContain("role=\"switch\"");
  expect(source).toContain("/api/admin/workspaces/sourcing/sources/");
  expect(source).toContain("const action = enabled ? 'deactivate' : 'activate'");
  expect(source).not.toContain("api('/api/admin/workspaces/sourcing')");
  expect(source).not.toContain("'/capabilities/'");
  expect(source).not.toContain("'/import-now'");
  expect(source).not.toContain('sourceCanStartAutopilot');
  expect(css).toContain('.kir-lot-strip');
  expect(css).toContain('.kir-action-card');
  expect(css).toContain('.kir-source-switch');
  expect(css).not.toContain('.kir-source-panel');
});
