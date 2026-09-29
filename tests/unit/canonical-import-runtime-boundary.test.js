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
  expect(index).toContain('/dashboards/canonical/js/import-runtime.js?v=260929-3');
  expect(index).toContain('/dashboards/canonical/css/import-runtime.css?v=260929-2');
  expect(source).toContain('/api/admin/workspaces/sourcing/import-runs');
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


test('import runtime pilots configured sources without inventing client authority', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'import-runtime.js'), 'utf8');
  const css = fs.readFileSync(path.join(CANONICAL, 'css', 'import-runtime.css'), 'utf8');
  expect(source).toContain("api('/api/admin/workspaces/sourcing')");
  expect(source).toContain("'/capabilities/'");
  expect(source).toContain("'/import-now'");
  expect(source).toContain("'activate'");
  expect(source).toContain("'deactivate'");
  expect(source).toContain('production_runtime_certified');
  expect(source).toContain('sourceCanImportNow');
  expect(source).toContain('sourceCanStartAutopilot');
  expect(source).toContain('Discovery ·');
  expect(source).toContain("['Différés', num(a.deferred), 'warn']");
  expect(source).toContain("error?.details?.run_ref");
  expect(source).toContain('selectedRunRef = failedRunRef');
  expect(source).toContain('Chargement du dernier lot…');
  expect(source).toContain('renderLoading(mountedRoot)');
  expect(source).not.toContain('render(mountedRoot, null, { sources:[] })');
  expect(css).toContain('.kir-source-panel');
  expect(css).toContain('.kir-switch');
  expect(css).toContain('.kir-btn-import');
});
