'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

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
    setHeader: jest.fn(),
    sendFile: jest.fn(),
    redirect: jest.fn(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
    json: jest.fn(),
  };
}

test('stable Action Center et anciens points d’entrée Alerts/Problems convergent avec rollback Legacy', () => {
  const app = fakeApp();
  mountHtmlRoutes(app, ROOT);

  const canonicalRes = fakeRes();
  app._routes['/admin/action-center']({}, canonicalRes);
  expect(canonicalRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'canonical');
  expect(canonicalRes.sendFile).toHaveBeenCalledWith(path.join(CANONICAL, 'index.html'), expect.any(Function));

  for (const routePath of ['/admin/alerts', '/admin/problems']) {
    const cutoverRes = fakeRes();
    app._routes[routePath]({ query: {} }, cutoverRes);
    expect(cutoverRes.redirect).toHaveBeenCalledWith(302, '/admin/action-center');
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

test('Canonical runtime loads only the Action Center API and no Legacy UI client', () => {
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'action-center.js'), 'utf8');

  expect(index).toContain('/dashboards/canonical/js/action-center.js');
  expect(source).toContain("const ENDPOINT = '/api/admin/action-center'");
  expect(source).not.toContain('/api/admin/signals');
  expect(source).not.toMatch(/\b(?:ActionCenterView|ProblemsView|ApiClient|KmcApi)\b/);
  expect(source).not.toMatch(/\/dashboards\/admin(?:-legacy)?\//);
});

test('Action Center is global central, has no market selector and uses signal_ref only', () => {
  const appSource = fs.readFileSync(path.join(CANONICAL, 'js', 'app.js'), 'utf8');
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'action-center.js'), 'utf8');

  expect(appSource).toContain("ACTION_CENTER: 'action-center'");
  expect(source).toContain('row.signal_ref');
  expect(source).not.toContain('signal.id');
  expect(source).not.toContain('entity_id');
  expect(source).not.toContain('market_id');
  expect(source).not.toContain('marketId');
});

test('server service resolves drill-down business refs and never exposes target_filters authority', () => {
  const service = fs.readFileSync(path.join(ROOT, 'services', 'action-center-workspace.js'), 'utf8');
  expect(service).toContain('product_ref');
  expect(service).toContain('order_reference');
  expect(service).not.toContain('target_filters:');
  expect(service).not.toContain('entity_id: signal.entity_id');
});

test('Simulator remains outside Action Center / 4G', () => {
  const htmlRoutes = fs.readFileSync(path.join(ROOT, 'bootstrap', 'html-routes.js'), 'utf8');
  expect(htmlRoutes).toContain("'/admin/simulator'");
  expect(htmlRoutes).not.toContain("'/admin/action-center',\n    '/admin/simulator'");
});
