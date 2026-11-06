'use strict';
const fs = require('fs');
const path = require('path');
const { isDedicatedE2E, reassign } = require('../../scripts/recette/staging-e2e-relay-reassign');

describe('staging-e2e-relay-reassign', () => {
  test('refuse un compte non E2E et un environnement non staging', async () => {
    expect(isDedicatedE2E('e2e-relais@komerce.test')).toBe(true);
    expect(isDedicatedE2E('client@gmail.com')).toBe(false);
    await expect(reassign({ db: {}, env: { KOMERCE_ENV: 'production' } })).rejects.toThrow('STAGING_ONLY');
    await expect(reassign({ db: {}, env: { KOMERCE_ENV: 'staging', KOMERCE_TARGET_ENV: 'staging', E2E_AGENT_RELAIS_EMAIL: 'x@gmail.com' } })).rejects.toThrow('E2E_ACCOUNT_REQUIRED');
  });
  test('le source n ecrit que via assignAgentRelais et le workflow exige la confirmation', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../scripts/recette/staging-e2e-relay-reassign.js'), 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
    expect(src).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i);
    expect(src).toMatch(/REASSIGN-E2E-RELAY/);
    expect(src).toMatch(/RELAY_MARKET_MISMATCH/);
  });
});
