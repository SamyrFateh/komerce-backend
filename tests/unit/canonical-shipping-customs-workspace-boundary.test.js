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

test('4B est Canonical tandis que Transitaire et Douane Legacy restent disponibles', () => {
  const app = fakeApp();
  mountHtmlRoutes(app, ROOT);

  const workspaceRes = fakeRes();
  app._routes['/admin/workspaces/shipping-customs']({}, workspaceRes);
  expect(workspaceRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'canonical');
  expect(workspaceRes.sendFile).toHaveBeenCalledWith(path.join(CANONICAL, 'index.html'), expect.any(Function));

  for (const legacyPath of ['/admin/transitaire', '/admin/customs']) {
    const legacyRes = fakeRes();
    app._routes[legacyPath]({}, legacyRes);
    expect(legacyRes.setHeader).toHaveBeenCalledWith('X-Admin-Generation', 'legacy-1');
  }
});

test('le navigateur 4B appelle uniquement son namespace Canonical', () => {
  const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(CANONICAL, 'js', 'shipping-customs-workspace.js'), 'utf8');

  expect(index).toContain('/dashboards/canonical/js/shipping-customs-workspace.js');
  expect(source).toContain('/api/admin/workspaces/shipping-customs/market/');
  expect(source).not.toContain('/api/transitaire');
  expect(source).not.toContain('/api/admin/customs-shipments');
  expect(source).not.toMatch(/\b(?:TransitaireView|CustomsView|ApiClient)\b/);
  expect(source).not.toMatch(/parcel_id\s*:/);
});

test('le service réutilise scan-engine et customs-shipment-service au lieu du Legacy', () => {
  const source = fs.readFileSync(path.join(ROOT, 'services', 'shipping-customs-workspace.js'), 'utf8');
  expect(source).toContain("require('./scan-engine')");
  expect(source).toContain("require('./customs-shipment-service')");
  expect(source).toContain("event_type: 'transit_confirmed'");
  expect(source).not.toContain("require('../routes/transitaire-api')");
  expect(source).not.toContain('syncScanToParcels');
});

test('aucun endpoint de mutation globale 4B n existe', () => {
  const route = fs.readFileSync(path.join(ROOT, 'routes', 'admin-shipping-customs-workspace.js'), 'utf8');
  const mutationLines = route.split('\n').filter(line => /router\.post\(/.test(line));
  expect(mutationLines.length).toBeGreaterThan(0);
  mutationLines.forEach(line => expect(line).toContain('/market/:marketCode/'));
  expect(route).toContain("requireCustomsAction = requireRole(['admin'])");
  expect(route).toContain("requireTransitAction = requireRole(['admin', 'agent_hub', 'agent_transitaire'])");
});

test('migration douane est additive et fail-closed pour le legacy non résolu', () => {
  const migration = fs.readFileSync(path.join(ROOT, 'migrations', '146_customs_shipments_market_id.sql'), 'utf8');
  expect(migration).toContain('ADD COLUMN IF NOT EXISTS market_id UUID REFERENCES markets(id)');
  expect(migration).toContain('HAVING COUNT(DISTINCT o.market_id) = 1');
  expect(migration).not.toMatch(/market_id\s+UUID\s+NOT NULL/);
});

test('runtime Canonical distingue 4A et 4B', () => {
  const appSource = fs.readFileSync(path.join(CANONICAL, 'js', 'app.js'), 'utf8');
  expect(appSource).toContain("OPERATIONS_WORKSPACE: 'operations-workspace'");
  expect(appSource).toContain("SHIPPING_CUSTOMS_WORKSPACE: 'shipping-customs-workspace'");
  expect(appSource).toContain("'/admin/workspaces/shipping-customs'");
});
