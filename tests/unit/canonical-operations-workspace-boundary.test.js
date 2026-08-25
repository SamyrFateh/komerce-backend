'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../utils/logger', () => ({
  child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

const { mountHtmlRoutes } = require('../../bootstrap/html-routes');
const ROOT = path.join(__dirname, '..', '..');
const CANONICAL = path.join(ROOT, 'public', 'dashboards', 'canonical');

function fakeApp() {
  const routes = {};
  return {
    get: jest.fn((routePath, handler) => { routes[routePath] = handler; }),
    _routes: routes,
  };
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

test('URL Workspace est Canonical mais Hub-Relais et Inventory restent Legacy 1', () => {
  const app = fakeApp();
  mountHtmlRoutes(app, ROOT);

  const workspaceRes = fakeRes();
  app._routes['/admin/workspaces/operations']({}, workspaceRes);
  expect(workspaceRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'canonical');
  expect(workspaceRes.sendFile).toHaveBeenCalledWith(path.join(CANONICAL, 'index.html'), expect.any(Function));

  for (const legacyPath of ['/admin/hub-relais', '/admin/inventory']) {
    const legacyRes = fakeRes();
    app._routes[legacyPath]({}, legacyRes);
    expect(legacyRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'legacy-1');
  }
});

test('runtime charge le Workspace sans importer les vues Legacy', () => {
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'operations-workspace.js'), 'utf8');

  expect(index).toContain('/dashboards/canonical/js/operations-workspace.js');
  expect(index).toContain('/dashboards/canonical/css/operations-workspace.css');
  expect(source).not.toMatch(/\/dashboards\/admin(?:-legacy)?\//);
  expect(source).not.toMatch(/\b(?:HubRelaisView|InventoryView|ApiClient)\b/);
  expect(source).toContain('/api/admin/workspaces/operations/market/');
});

test('Workspace et Dashboard Opérations restent deux surfaces physiques distinctes', () => {
  const appSource = fs.readFileSync(path.join(CANONICAL, 'js', 'app.js'), 'utf8');
  const workspaceSource = fs.readFileSync(path.join(CANONICAL, 'js', 'operations-workspace.js'), 'utf8');
  const dashboardSource = fs.readFileSync(path.join(CANONICAL, 'js', 'operations.js'), 'utf8');

  expect(appSource).toContain("OPERATIONS_WORKSPACE: 'operations-workspace'");
  expect(appSource).toContain("OPERATIONS: 'operations'");
  expect(workspaceSource).not.toContain('KomerceCanonicalOperations.mount');
  expect(dashboardSource).not.toContain('/api/admin/workspaces/operations/');
});
