'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../utils/logger', () => ({
  child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

const path = require('path');
const { mountHtmlRoutes } = require('../../bootstrap/html-routes');

const ROOT = path.join(__dirname, '..', '..');

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

describe('Control Tower → Pilotage Canonical', () => {
  test('/admin/control-tower converge vers Pilotage', () => {
    const app = fakeApp();
    mountHtmlRoutes(app, ROOT);
    const res = fakeRes();

    app._routes['/admin/control-tower']({ query: {} }, res);

    expect(res.redirect).toHaveBeenCalledWith(302, '/admin/pilotage');
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  test('/admin/control-tower?legacy=1 conserve le témoin Legacy 1', () => {
    const app = fakeApp();
    mountHtmlRoutes(app, ROOT);
    const res = fakeRes();

    app._routes['/admin/control-tower']({ query: { legacy: '1' } }, res);

    expect(res.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'legacy-1');
    expect(res.sendFile).toHaveBeenCalledWith(
      path.join(ROOT, 'public', 'dashboards', 'admin', 'index.html'),
      expect.any(Function)
    );
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
