'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');
const { listMigrationFiles } = require('../../scripts/run-migrations');

const root = path.join(__dirname, '..', '..');
const railway = fs.readFileSync(path.join(root, 'railway.toml'), 'utf8');
const migration148a = fs.readFileSync(
  path.join(root, 'migrations', '148a_sourcing_user_role.sql'),
  'utf8'
);
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

test('sourcing enum preparation is a separate migration ordered before immutable 149', () => {
  expect(migration148a).toContain("ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'sourcing';");
  expect(migration149).toContain("WHERE role = 'sourcing'");
  expect(migration149).not.toContain('ALTER TYPE public.user_role');

  const files = listMigrationFiles();
  expect(files.indexOf('148a_sourcing_user_role.sql')).toBeGreaterThan(files.indexOf('148_cash_deposit_business_reference.sql'));
  expect(files.indexOf('148a_sourcing_user_role.sql')).toBeLessThan(files.indexOf('149_sourcing_workspace_business_refs.sql'));
});
