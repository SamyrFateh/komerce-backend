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

test('la route /admin/orders/:orderReference sert le runtime Canonical', () => {
  const app = fakeApp();
  mountHtmlRoutes(app, ROOT);
  const res = fakeRes();

  expect(app._routes['/admin/orders/:orderReference']).toBeDefined();
  app._routes['/admin/orders/:orderReference']({ params: { orderReference: 'CMD-CM-001' } }, res);

  expect(res.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'canonical');
  expect(res.sendFile).toHaveBeenCalledWith(
    path.join(CANONICAL, 'index.html'),
    expect.any(Function)
  );
});

test('le runtime charge Order 360 sans dépendance legacy', () => {
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
  const order360 = fs.readFileSync(path.join(CANONICAL, 'js', 'order-360.js'), 'utf8');

  expect(index).toContain('/dashboards/canonical/js/order-360.js');
  expect(index).toContain('/dashboards/canonical/css/entity-360.css');
  expect(order360).not.toMatch(/\/dashboards\/admin(?:-legacy)?\//);
  expect(order360).not.toMatch(/\b(?:OrdersLogisticsView|PilotageView|SanteView)\b/);
});
