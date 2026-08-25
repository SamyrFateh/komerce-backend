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
const product360Contract = require('../../public/dashboards/canonical/js/product-360.js');

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

test('la route détaillée Product 360 est Canonical mais /admin/products reste Legacy 1', () => {
  const app = fakeApp();
  mountHtmlRoutes(app, ROOT);
  const detailRes = fakeRes();
  const listRes = fakeRes();

  expect(app._routes['/admin/products/:productRef']).toBeDefined();
  app._routes['/admin/products/:productRef']({ params: { productRef: 'KPR-000123' } }, detailRes);
  expect(detailRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'canonical');
  expect(detailRes.sendFile).toHaveBeenCalledWith(path.join(CANONICAL, 'index.html'), expect.any(Function));

  expect(app._routes['/admin/products']).toBeDefined();
  app._routes['/admin/products']({}, listRes);
  expect(listRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'legacy-1');
});

test('le runtime charge Product 360 sans dépendance ProductsView ni endpoint CRUD legacy', () => {
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
  const product360 = fs.readFileSync(path.join(CANONICAL, 'js', 'product-360.js'), 'utf8');

  expect(index).toContain('/dashboards/canonical/js/product-360.js');
  expect(product360).not.toMatch(/\/dashboards\/admin(?:-legacy)?\//);
  expect(product360).not.toMatch(/\b(?:ProductsView|SourcingView|PricingView)\b/);
  expect(product360).not.toMatch(/\/api\/products\/[^'"`]*\{?/);
  expect(product360).toContain('/api/admin/entities/products/');
});

test('Product 360 navigue par product_ref et jamais par UUID technique', () => {
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'product-360.js'), 'utf8');

  expect(product360Contract.productRefFromPath('/admin/products/KPR-000123')).toBe('KPR-000123');
  expect(product360Contract.productRefFromPath('/admin/products/11111111-1111-4111-8111-111111111111'))
    .toBe('11111111-1111-4111-8111-111111111111');
  // Le parser ne décide pas de la validité métier : l'API refuse l'UUID via
  // normalizeProductRef. Le navigateur, lui, ne construit jamais de product_id.
  expect(source).toContain('product_ref');
  expect(source).not.toContain('product_id=');
  expect(source).not.toContain('/admin/products/${product.id}');
  expect(product360Contract.ENDPOINT_PREFIX).toBe('/api/admin/entities/products/');
});
