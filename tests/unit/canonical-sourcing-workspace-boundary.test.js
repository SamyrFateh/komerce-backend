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

test('URL Sourcing et anciens points d?entr?e convergent selon le cutover 4L', () => {
  const app = fakeApp();
  mountHtmlRoutes(app, ROOT);

  const canonicalRes = fakeRes();
  app._routes['/admin/workspaces/sourcing']({}, canonicalRes);
  expect(canonicalRes.setHeader)
    .toHaveBeenCalledWith('X-Admin-Generation', 'canonical');

  for (const routePath of ['/admin/sourcing', '/admin/sourcing-scanner']) {
    const aliasRes = fakeRes();
    app._routes[routePath]({ query: {} }, aliasRes);
    expect(aliasRes.redirect)
      .toHaveBeenCalledWith(302, '/admin/workspaces/sourcing');

    const rollbackRes = fakeRes();
    app._routes[routePath]({ query: { legacy: '1' } }, rollbackRes);
    expect(rollbackRes.setHeader)
      .toHaveBeenCalledWith('X-Admin-Generation', 'legacy-1');
  }

  const suppliersRes = fakeRes();
  app._routes['/admin/suppliers']({}, suppliersRes);
  expect(suppliersRes.setHeader)
    .toHaveBeenCalledWith('X-Admin-Generation', 'legacy-1');
});

test('runtime charge Sourcing sans vues Legacy ni API historiques', () => {
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'sourcing-workspace.js'), 'utf8');

  expect(index).toContain('/dashboards/canonical/js/sourcing-workspace.js');
  expect(source).not.toMatch(/\/dashboards\/admin(?:-legacy)?\//);
  expect(source).not.toMatch(/\b(?:SourcingView|SourcingScannerView|SuppliersView|ApiClient|KmcApi)\b/);
  expect(source).not.toContain('/api/admin/sourcing');
  expect(source).not.toContain('/api/admin/partners');
  expect(source).toContain('/api/admin/workspaces/sourcing');
});

test('Sourcing est global central et navigue par références métier', () => {
  const appSource = fs.readFileSync(path.join(CANONICAL, 'js', 'app.js'), 'utf8');
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'sourcing-workspace.js'), 'utf8');
  expect(appSource).toContain("SOURCING_WORKSPACE: 'sourcing-workspace'");
  expect(source).toContain('row.candidate_ref');
  expect(source).toContain('row.partner_ref');
  expect(source).toContain('row.product_ref');
  expect(source).not.toContain('market_id');
  expect(source).not.toContain('marketId');
});

test('service Canonical délègue les moteurs au lieu de réimplémenter leur SQL métier', () => {
  const service = fs.readFileSync(path.join(ROOT, 'services', 'sourcing-workspace.js'), 'utf8');
  expect(service).toContain("require('./sourcing-candidate-actions')");
  expect(service).toContain("require('./sourcing-mutations')");
  expect(service).toContain("require('./suppliers/catalog-import-orchestrator')");
  expect(service).toContain("require('./partner-admin-service')");
  expect(service).not.toContain('INSERT INTO sourcing_candidate_events');
  expect(service).not.toContain('UPDATE products SET');
});
