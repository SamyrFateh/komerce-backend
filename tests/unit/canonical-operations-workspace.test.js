'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const workspace = require('../../public/dashboards/canonical/js/operations-workspace');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'js', 'operations-workspace.js'),
  'utf8'
);

test('endpointFor impose un code marché et reste dans le namespace Canonical', () => {
  expect(workspace.endpointFor('cm')).toBe('/api/admin/workspaces/operations/market/CM');
  expect(workspace.endpointFor('CM', 'distribution/run')).toBe(
    '/api/admin/workspaces/operations/market/CM/distribution/run'
  );
  expect(() => workspace.endpointFor(null)).toThrow('canonical_operations_workspace_market_required');
});

test('le frontend ne construit jamais market_id comme autorité', () => {
  const executable = SOURCE.replace(/\/\*\*[\s\S]*?\*\//, '');
  expect(executable).not.toMatch(/\bmarket_id\b/);
  expect(executable).not.toMatch(/\bmarketId\b/);
  expect(executable).not.toContain('/api/hub/');
  expect(executable).not.toContain('/api/v2/');
});

test('les KPI du Workspace sont une projection pure du résumé serveur', () => {
  const items = workspace.metricItems({
    hub_to_order: 2,
    hub_unassigned: 3,
    hub_to_ship: 4,
    relay_cash_pending: 5,
    relay_to_receive: 6,
    relay_to_collect: 7,
    inventory_to_assign: 8,
  });

  expect(items.map(item => item.value)).toEqual(['2', '3', '4', '5', '6', '7', '8']);
  expect(items.every(item => item.tone === 'warning')).toBe(true);
});

test('jsonRequest POST sérialise uniquement le body métier fourni', async () => {
  const fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({ ok: true }),
  });

  await workspace.jsonRequest(
    fetch,
    '/api/admin/workspaces/operations/market/CM/inventory/items/item-1/assign',
    { method: 'POST', body: { parcel_ref: 'PCL-CM-001' } }
  );

  expect(fetch).toHaveBeenCalledWith(
    '/api/admin/workspaces/operations/market/CM/inventory/items/item-1/assign',
    expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ parcel_ref: 'PCL-CM-001' }),
    })
  );
});
