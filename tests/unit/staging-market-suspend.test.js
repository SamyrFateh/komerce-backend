'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const { parseMarkets, suspend, CONFIRMATION } = require('../../scripts/recette/staging-market-suspend');

describe('staging-market-suspend', () => {
  test('seuls CM, CG, YT sont admis : KM et DJ refuses', () => {
    expect(parseMarkets('')).toEqual(['CM', 'CG', 'YT']);
    expect(() => parseMarkets('KM')).toThrow('MARKET_NOT_ALLOWED:KM');
    expect(() => parseMarkets('CM,DJ')).toThrow('MARKET_NOT_ALLOWED:DJ');
  });
  test('refuse hors staging et URL non staging', async () => {
    await expect(suspend({ db: {}, env: { KOMERCE_ENV: 'production' } })).rejects.toThrow('STAGING_ONLY');
    await expect(suspend({ db: {}, env: { KOMERCE_ENV: 'staging', KOMERCE_TARGET_ENV: 'staging', STAGING_BASE_URL: 'https://example.com' } })).rejects.toThrow('BASE_URL_NOT_STAGING');
  });
  test('aucune ecriture SQL directe ; ecriture par la route canonique ; confirmation exigee', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../scripts/recette/staging-market-suspend.js'), 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
    expect(src).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i);
    expect(src).toMatch(/\/lifecycle/);
    expect(CONFIRMATION).toBe('SUSPEND-CM-CG-YT');
    const wf = fs.readFileSync(path.join(__dirname, '../../.github/workflows/staging-market-suspend.yml'), 'utf8');
    expect(wf).toMatch(/SUSPEND-CM-CG-YT/);
  });
});
