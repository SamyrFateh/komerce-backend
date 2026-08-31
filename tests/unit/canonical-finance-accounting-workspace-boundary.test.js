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

test('Accounting et Invoices convergent vers le Workspace avec rollback Legacy explicite', () => {
  const app = fakeApp();
  mountHtmlRoutes(app, ROOT);

  const canonicalRes = fakeRes();
  app._routes['/admin/workspaces/accounting']({}, canonicalRes);
  expect(canonicalRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'canonical');
  expect(canonicalRes.sendFile).toHaveBeenCalledWith(path.join(CANONICAL, 'index.html'), expect.any(Function));

  for (const legacyPath of ['/admin/accounting', '/admin/invoices']) {
    const cutoverRes = fakeRes();
    app._routes[legacyPath]({ query: {} }, cutoverRes);
    expect(cutoverRes.redirect).toHaveBeenCalledWith(302, '/admin/workspaces/accounting');

    const rollbackRes = fakeRes();
    app._routes[legacyPath]({ query: { legacy: '1' } }, rollbackRes);
    expect(rollbackRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'legacy-1');
    expect(rollbackRes.sendFile).toHaveBeenCalledWith(
      path.join(ROOT, 'public', 'dashboards', 'admin', 'index.html'),
      expect.any(Function)
    );
  }
});

test('runtime Accounting Canonical n importe ni vues Legacy ni API cash/invoices directes', () => {
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'finance-accounting-workspace.js'), 'utf8');

  expect(index).toContain('/dashboards/canonical/js/finance-accounting-workspace.js');
  expect(source).not.toMatch(/\/dashboards\/admin(?:-legacy)?\//);
  expect(source).not.toMatch(/\b(?:AccountingView|InvoicesView|ApiClient|KmcApi)\b/);
  expect(source).not.toContain('/api/cash');
  expect(source).not.toContain('/api/invoices');
  expect(source).toContain('/api/admin/workspaces/accounting');
});

test('Workspace utilise deposit_ref et conserve Order 360 comme drill-down', () => {
  const appSource = fs.readFileSync(path.join(CANONICAL, 'js', 'app.js'), 'utf8');
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'finance-accounting-workspace.js'), 'utf8');
  expect(appSource).toContain("ACCOUNTING_WORKSPACE: 'accounting-workspace'");
  expect(source).toContain('row.deposit_ref');
  expect(source).toContain('/admin/orders/${encodeURIComponent(row.order_ref)}');
  const executable = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  expect(executable).not.toContain('agent_id');
  expect(executable).not.toContain('market_id');
  expect(executable).not.toMatch(/[?&]market_id=/);
});
