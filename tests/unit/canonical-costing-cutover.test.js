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

describe('LOT 4S — Costing cutover', () => {
  test('/admin/costing converge vers Finance et conserve le rollback Legacy', () => {
    const app = fakeApp();
    mountHtmlRoutes(app, ROOT);

    const canonicalRes = fakeRes();
    app._routes['/admin/costing']({ query: {} }, canonicalRes);
    expect(canonicalRes.redirect).toHaveBeenCalledWith(302, '/admin/finance');

    const legacyRes = fakeRes();
    app._routes['/admin/costing']({ query: { legacy: '1' } }, legacyRes);
    expect(legacyRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'legacy-1');
    expect(legacyRes.sendFile).toHaveBeenCalledWith(
      path.join(ROOT, 'public', 'dashboards', 'admin', 'index.html'),
      expect.any(Function)
    );
  });

  test('les deux besoins analytiques restants existent dans Canonical', () => {
    const commerce = fs.readFileSync(path.join(CANONICAL, 'js', 'commerce.js'), 'utf8');
    const finance = fs.readFileSync(path.join(CANONICAL, 'js', 'finance.js'), 'utf8');

    expect(commerce).toContain("source: 'commerce.product-profitability'");
    expect(commerce).toContain("title: 'Rentabilité produits'");
    expect(finance).toContain("source: 'finance.relay-profitability'");
    expect(finance).toContain("title: 'Rentabilité relais'");
  });

  test('le runtime Canonical ne consomme aucun endpoint Legacy Costing', () => {
    const files = [
      path.join(CANONICAL, 'js', 'commerce.js'),
      path.join(CANONICAL, 'js', 'finance.js'),
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source).not.toContain('/api/admin/costing');
      expect(source).not.toContain('getCostingProducts');
      expect(source).not.toContain('getCostingRelais');
    }
  });

  test('la marge réelle est documentée comme actual-only dans les services', () => {
    const commerce = fs.readFileSync(path.join(ROOT, 'services', 'dashboard-commerce.js'), 'utf8');
    const finance = fs.readFileSync(path.join(ROOT, 'services', 'dashboard-finance-canonical.js'), 'utf8');
    expect(commerce).toContain("product_real_margin_basis: 'actual_cost_orders_only'");
    expect(finance).toContain("relay_real_margin_basis: 'actual_cost_orders_only'");
  });
});
