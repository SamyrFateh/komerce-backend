'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const railway = fs.readFileSync(path.join(root, 'railway.toml'), 'utf8');
const migration149 = fs.readFileSync(
  path.join(root, 'migrations', '149_sourcing_workspace_business_refs.sql'),
  'utf8'
);

test('Railway executes migrations through the supported pre-deploy hook', () => {
  expect(railway).toContain('preDeployCommand = ["node scripts/migrate.js"]');
  expect(railway).not.toMatch(/\breleaseCommand\s*=/);
});

test('Railway watchPatterns stay in the build section', () => {
  const buildPos = railway.indexOf('[build]');
  const watchPos = railway.indexOf('watchPatterns = [');
  const deployPos = railway.indexOf('[deploy]');

  expect(buildPos).toBeGreaterThanOrEqual(0);
  expect(watchPos).toBeGreaterThan(buildPos);
  expect(deployPos).toBeGreaterThan(watchPos);
});

test('migration 149 introduces sourcing role without unsafe same-transaction enum use', () => {
  expect(migration149).toContain("ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'sourcing';");
  expect(migration149).toContain("WHERE role::text = 'sourcing'");
  expect(migration149).not.toMatch(/WHERE\s+role\s*=\s*'sourcing'/);
});
