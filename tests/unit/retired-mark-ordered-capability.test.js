'use strict';
/**
 * @test-kind unit
 * L1 residual — no stale authority can revive mark_ordered without a PO.
 * The old migration (193) remains historical; 380 revokes it on staging.
 */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('mark_ordered disappeared from runtime delegations, team presets and their tests', () => {
  for (const file of [
    'config/market-delegation-capabilities.js',
    'public/dashboards/canonical/js/market-team.js',
    'tests/e2e-api/market-delegation.execution-bridge.e2e.test.js',
    'tests/unit/admin-operations-workspace-route.test.js',
  ]) {
    expect(read(file)).not.toContain('execution.order.mark_ordered');
  }
});

test('migration revokes all assignments before removing the capability', () => {
  const sql = read('migrations/380_retire_mark_ordered_capability.sql');
  const tables = [
    'membership_capabilities',
    'assignment_capability_ceiling',
    'ceiling_template_capabilities',
    'market_delegation_audit',
    'capability_registry',
  ];
  const positions = tables.map(t => {
    const pos = sql.indexOf('DELETE FROM public.' + t);
    expect(pos).toBeGreaterThan(-1);
    return pos;
  });
  expect(positions).toEqual([...positions].sort((a,b)=>a-b));
  expect(sql).not.toMatch(/\bCASCADE\b/i);
});

test('the only historical occurrence lives in the original 193 migration', () => {
  expect(read('migrations/193_market_delegation_capability_registry.sql'))
    .toContain('execution.order.mark_ordered');
  expect(read('features/market-delegation.feature.js'))
    .toContain('migrations/380_retire_mark_ordered_capability.sql');
});
