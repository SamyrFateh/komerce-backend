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

test('le détail /admin/clients/:clientPhone est Canonical sans détourner /admin/clients legacy', () => {
  const app = fakeApp();
  mountHtmlRoutes(app, ROOT);

  const detailRes = fakeRes();
  app._routes['/admin/clients/:clientPhone']({ params: { clientPhone: '+2691234567' } }, detailRes);
  expect(detailRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'canonical');
  expect(detailRes.sendFile).toHaveBeenCalledWith(path.join(CANONICAL, 'index.html'), expect.any(Function));

  const listRes = fakeRes();
  app._routes['/admin/clients']({ query: {} }, listRes);
  expect(listRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'canonical');

  const legacyRes = fakeRes();
  app._routes['/admin/clients']({ query: { legacy: '1' } }, legacyRes);
  expect(legacyRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'legacy-1');
});

test('Client 360 est physiquement Canonical et ne réutilise ni ClientsView ni son endpoint legacy', () => {
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
  const client360 = fs.readFileSync(path.join(CANONICAL, 'js', 'client-360.js'), 'utf8');
  const apiBootstrap = fs.readFileSync(path.join(ROOT, 'bootstrap', 'api-routes.js'), 'utf8');

  expect(index).toContain('/dashboards/canonical/js/client-360.js');
  expect(client360).not.toMatch(/\/dashboards\/admin(?:-legacy)?\//);
  expect(client360).not.toMatch(/\bClientsView\b/);
  expect(client360).not.toContain('/api/dashboard/clients/detail');
  expect(client360).toContain('/api/admin/entities/clients/');
  expect(apiBootstrap).toContain("require('../routes/admin-client-360')");
  expect(apiBootstrap).toContain("app.use('/api/admin/entities',    adminClient360Router)");
});
