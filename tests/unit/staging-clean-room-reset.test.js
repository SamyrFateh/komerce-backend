'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const script = fs.readFileSync(path.join(ROOT, 'scripts', 'staging-clean-room-reset.js'), 'utf8');
const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'staging-catalog-ops.yml'), 'utf8');

test('clean-room reset is staging-only and explicit opt-in', () => {
  expect(script).toContain("KOMERCE_ENV || '').toLowerCase() !== 'staging'");
  expect(script).toContain("process.env.NODE_ENV === 'production'");
  expect(script).toContain("KOMERCE_ALLOW_CLEAN_ROOM_RESET !== '1'");
});

test('clean-room removes runtime facts but preserves provider configuration', () => {
  for (const table of [
    'sourcing_candidates',
    'supplier_catalog_imports',
    'sourcing_captures',
    'sourcing_observations',
    'sourcing_resolution_decisions',
    'sourcing_canonical_entities',
    'import_runtime_runs',
  ]) expect(script).toContain(`'${table}'`);

  expect(script).toContain("'sourcing_sources'");
  expect(script).toContain("'sourcing_merge_policies'");
  expect(script).toContain("'supplier_oauth_connections'");
  expect(script).not.toContain('TRUNCATE TABLE sourcing_sources');
  expect(script).not.toContain('DELETE FROM sourcing_sources');
  expect(script).not.toContain('RESTART IDENTITY CASCADE');
  expect(script).toContain('DELETE FROM sourcing_captures');
});

test('old certification evidence is invalidated and no seed is invoked', () => {
  expect(script).toContain('production_certified_capture_id = NULL');
  expect(script).toContain('production_certified_at = NULL');
  expect(script).toContain('seed: false');
  expect(script).not.toMatch(/require\(['"].*seed/);
});

test('workflow exposes the bounded clean-room operation', () => {
  expect(workflow).toContain('clean-room-reset');
  expect(workflow).toContain('KOMERCE_ALLOW_CLEAN_ROOM_RESET');
  expect(workflow).toContain('node scripts/staging-clean-room-reset.js');
});
