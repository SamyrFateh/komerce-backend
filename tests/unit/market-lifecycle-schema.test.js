'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

describe('Market Control Plane M5 — market lifecycle schema', () => {
  test('migration defines lifecycle, compatibility is_active and storefront texts', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'migrations', '278_market_lifecycle.sql'), 'utf8');
    expect(sql).toMatch(/lifecycle_status TEXT/);
    expect(sql).toMatch(/'PROVISIONING','ACTIVE','SUSPENDED','CLOSED'/);
    expect(sql).toMatch(/is_active = \(lifecycle_status IN \('ACTIVE','SUSPENDED'\)\)/);
    expect(sql).toMatch(/storefront_texts JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
    expect(sql).toMatch(/jsonb_typeof\(storefront_texts\) = 'object'/);
  });

  test('reference market seed preserves lifecycle/is_active compatibility after migration 278', () => {
    const seed = fs.readFileSync(path.join(ROOT, 'scripts', 'seed-reference-data.js'), 'utf8');
    expect(seed).toMatch(/columnExists\(client, 'markets', 'lifecycle_status'\)/);
    expect(seed).toMatch(/market\.is_active \? 'ACTIVE' : 'PROVISIONING'/);
    expect(seed).toMatch(/is_active, lifecycle_status/);
    expect(seed).toMatch(/lifecycle_status = EXCLUDED\.lifecycle_status/);
  });
});
