'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * @unit  r5-prod-guard.test.js
 * @brief [R5] Preuve du fail-closed : assertNotProdIfMutant() lève une erreur
 *        si BASE_URL pointe la production et ALLOW_MUTANTS_ON_PROD est absent.
 *
 * DoD R5 : "Un run mutant sur BASE_URL=prod = refusé, prouvé par un test de config."
 */

const { assertNotProdIfMutant } = require('../e2e/helpers/api.helpers');

describe('[R5] fail-closed — assertNotProdIfMutant', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restaurer l'environnement après chaque test
    Object.keys(process.env).forEach(k => { if (!(k in originalEnv)) delete process.env[k]; });
    Object.assign(process.env, originalEnv);
  });

  test('lève une erreur si BASE_URL=komerce.co sans ALLOW_MUTANTS_ON_PROD', () => {
    process.env.BASE_URL = 'https://komerce.co/boutique/';
    delete process.env.ALLOW_MUTANTS_ON_PROD;

    expect(() => assertNotProdIfMutant()).toThrow(/FAIL-CLOSED/);
    expect(() => assertNotProdIfMutant()).toThrow(/komerce\.co/);
  });

  test('lève une erreur si BASE_URL=https://www.komerce.co', () => {
    process.env.BASE_URL = 'https://www.komerce.co/boutique/';
    delete process.env.ALLOW_MUTANTS_ON_PROD;

    expect(() => assertNotProdIfMutant()).toThrow(/FAIL-CLOSED/);
  });

  test('ne lève PAS d\'erreur si BASE_URL = staging (hors komerce.co)', () => {
    process.env.BASE_URL = 'https://staging.komerce.dev/boutique/';
    delete process.env.ALLOW_MUTANTS_ON_PROD;

    expect(() => assertNotProdIfMutant()).not.toThrow();
  });

  test('ne lève PAS d\'erreur si BASE_URL = localhost', () => {
    process.env.BASE_URL = 'http://localhost:3000/boutique/';
    delete process.env.ALLOW_MUTANTS_ON_PROD;

    expect(() => assertNotProdIfMutant()).not.toThrow();
  });

  test('ne lève PAS d\'erreur si ALLOW_MUTANTS_ON_PROD=1, même sur prod (override explicite)', () => {
    process.env.BASE_URL = 'https://komerce.co/boutique/';
    process.env.ALLOW_MUTANTS_ON_PROD = '1';

    expect(() => assertNotProdIfMutant()).not.toThrow();
  });

  test('ne lève PAS d\'erreur si BASE_URL est absent (mode local)', () => {
    delete process.env.BASE_URL;
    delete process.env.ALLOW_MUTANTS_ON_PROD;

    expect(() => assertNotProdIfMutant()).not.toThrow();
  });
});
