'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '308_suspend_unproven_active_markets.sql'), 'utf8');
const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

describe('migration 308 — marchés ACTIVE sans preuve → SUSPENDED (lot 5)', () => {
  test('ne touche que CM et CG, uniquement ceux encore ACTIVE (idempotent), jamais KM', () => {
    expect(code).toMatch(/code IN \('CM', 'CG'\)/);
    expect(code).toMatch(/lifecycle_status = 'ACTIVE'/);
    expect(code).not.toMatch(/'KM'/);
  });

  test('suspend sans supprimer ni modifier is_active (SUSPENDED garde is_active=true, contrainte 278)', () => {
    expect(code).toMatch(/SET lifecycle_status = 'SUSPENDED'/);
    expect(code).not.toMatch(/is_active\s*=\s*(false|FALSE)/);
    expect(code).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
  });

  test('trace d’audit par marché modifié', () => {
    expect(code).toMatch(/INSERT INTO market_delegation_audit/);
    expect(code).toMatch(/'MARKET_LIFECYCLE_CHANGED'/);
    expect(code).toMatch(/FROM changed/);
  });
});
