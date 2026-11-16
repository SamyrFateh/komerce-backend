'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { CANDIDATES, selectScope, guard } = require('../../scripts/recette/g13-cj-source-refresh');
describe('G13 exact CJ staging refresh guard', () => {
  test('canary isolated before the five remaining exact source IDs', () => {
    expect(CANDIDATES).toHaveLength(6);
    expect(selectScope('canary')).toEqual([CANDIDATES[0]]);
    expect(selectScope('batch')).toEqual(CANDIDATES.slice(1));
    expect(() => selectScope('all')).toThrow('G13_CJ_REFRESH_SCOPE_REFUSED');
    expect(new Set(CANDIDATES.map(x => x.supplier_product_id)).size).toBe(6);
  });
  const authorized = { GITHUB_ACTIONS: 'true', GITHUB_ACTOR: 'owner',
    GITHUB_REPOSITORY_OWNER: 'owner', KOMERCE_ENV: 'staging', EXPECTED_RAILWAY_ENVIRONMENT: 'staging',
    STAGING_BASE_URL: 'https://komerce-backend-production.up.railway.app',
    PGOPTIONS: '-c default_transaction_read_only=on', GITHUB_RUN_ID: '43818443743',
    E2E_ADMIN_EMAIL: 'test@example.invalid', E2E_ADMIN_PASSWORD: 'test', G13_CJ_REFRESH_SCOPE: 'canary' };
  test('requires real owner, target, SQL read-only, staging and explicit scope', () => {
    expect(guard(authorized)).toHaveLength(1);
    for (const patch of [
      { GITHUB_ACTOR: 'other' }, { KOMERCE_ENV: 'production' },
      { PGOPTIONS: '' }, { STAGING_BASE_URL: 'https://invalid.example' },
      { E2E_ADMIN_PASSWORD: '' }, { G13_CJ_REFRESH_SCOPE: 'all' },
    ]) expect(() => guard({ ...authorized, ...patch })).toThrow();
  });
});
