'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const migration = fs.readFileSync(
  path.join(ROOT, 'migrations', '197_market_delegation_legacy_scope_backfill.sql'),
  'utf8'
);

describe('market-delegation legacy scope backfill', () => {
  test('creates no competing active assignment and adopts only active legacy scopes', () => {
    expect(migration).toMatch(/oms\.revoked_at IS NULL/);
    expect(migration).toMatch(/a\.status = 'ACTIVE'/);
    expect(migration).toMatch(/WHERE NOT EXISTS[\s\S]*market_operating_assignments/);
    expect(migration).not.toMatch(/operator_market_scopes[\s\S]*DELETE/i);
  });

  test('never grants future or missing capabilities', () => {
    expect(migration).toMatch(/registry\.status = 'LIVE'/);
    expect(migration).toMatch(/registry\.class = 'DELEGATION'/);
    expect(migration).toMatch(/registry\.authority_scope = 'MARKET'/);
    expect(migration).toMatch(/registry\.delegation_mode = 'DELEGABLE'/);
  });

  test('legacy viewer mapping is an explicit conservative read whitelist', () => {
    for (const capability of [
      'pricing.read',
      'pricing.simulate',
      'dashboard.market.read',
      'operations.read',
      'client.read',
      'network.read',
      'market_config.read',
      'finance.read',
    ]) {
      expect(migration).toContain(`'${capability}'`);
    }
    expect(migration).not.toMatch(/legacy_role = 'viewer'[\s\S]{0,900}'team\.grant'/);
  });

  test('existing memberships are not expanded and legacy read model is attributed', () => {
    expect(migration).toMatch(/WHERE NOT EXISTS[\s\S]*assignment_memberships/);
    expect(migration).toMatch(/projected_from_membership_id = am\.id/);
    expect(migration).toContain("'LEGACY_SCOPE_BACKFILLED'");
    expect(migration).toContain("'migration-197'");
  });
});
