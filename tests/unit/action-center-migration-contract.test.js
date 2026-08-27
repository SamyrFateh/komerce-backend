'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', '..', 'migrations', '153_action_center_signal_authority.sql'),
  'utf8'
);

test('migration creates stable KSG browser references', () => {
  expect(migration).toContain('decision_signal_ref_seq');
  expect(migration).toContain("'KSG-'");
  expect(migration).toContain('idx_signals_signal_ref');
});

test('historical active duplicates are resolved before the new uniqueness invariant', () => {
  expect(migration).toContain('WITH ranked_active AS');
  expect(migration).toContain("WHEN 'snoozed' THEN 1");
  expect(migration).toContain("WHEN 'acknowledged' THEN 2");
  expect(migration).toContain('AND r.rn > 1');
  expect(migration.indexOf('WITH ranked_active AS')).toBeLessThan(migration.indexOf('idx_signals_active_fact_unique'));
});

test('database enforces one fact across open acknowledged and snoozed, including null entity dimensions', () => {
  expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_active_fact_unique');
  expect(migration).toContain('ON signals(signal_type, entity_type, entity_id) NULLS NOT DISTINCT');
  expect(migration).toContain("WHERE status IN ('open','acknowledged','snoozed')");
});

test('Canonical authority stays persisted and revocable', () => {
  expect(migration).toContain('decision_signal_global_access_grants');
  expect(migration).toContain('revoked_at TIMESTAMPTZ NULL');
  expect(migration).toContain("bootstrap_from_admin_role");
});
