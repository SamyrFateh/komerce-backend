'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * @unit  r5-prod-guard.test.js
 * @brief [R5] Preuve fail-closed par identité d'environnement runtime.
 *
 * Le domaine n'est jamais utilisé pour décider staging/prod : komerce.co
 * peut être staging aujourd'hui et production après go-live.
 */

const {
  assertDeclaredMutantTargetSafe,
  assertRemoteMutantTargetSafe,
} = require('../e2e/helpers/environment.helpers');

function health(environment) {
  return jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: 'ok', komerce_env: environment }),
  }));
}

describe('[R5] fail-closed — runtime environment identity', () => {
  test('komerce.co est autorisé quand runner ET serveur déclarent staging', async () => {
    const env = { KOMERCE_ENV: 'staging', BASE_URL: 'https://komerce.co/boutique/' };
    await expect(assertRemoteMutantTargetSafe({ env, fetchImpl: health('staging') }))
      .resolves.toMatchObject({ environment: 'staging' });
  });

  test('production est refusée avant tout appel réseau, quel que soit le domaine', () => {
    const env = { KOMERCE_ENV: 'production', BASE_URL: 'https://komerce.co/boutique/' };
    expect(() => assertDeclaredMutantTargetSafe(env)).toThrow(/FAIL-CLOSED/);
    expect(() => assertDeclaredMutantTargetSafe(env)).toThrow(/production/);
  });

  test('un runner staging est refusé si le serveur annonce production', async () => {
    const env = { KOMERCE_ENV: 'staging', BASE_URL: 'https://komerce.co/boutique/' };
    await expect(assertRemoteMutantTargetSafe({ env, fetchImpl: health('production') }))
      .rejects.toThrow(/runner="staging".*serveur="production"/);
  });

  test('KOMERCE_ENV absent est refusé : aucun fallback hostname', () => {
    const env = { BASE_URL: 'https://komerce.co/boutique/' };
    expect(() => assertDeclaredMutantTargetSafe(env)).toThrow(/KOMERCE_ENV absent/);
  });

  test('une identité serveur absente/unknown est refusée', async () => {
    const env = { KOMERCE_ENV: 'staging', BASE_URL: 'https://komerce.co/boutique/' };
    await expect(assertRemoteMutantTargetSafe({ env, fetchImpl: health('unknown') }))
      .rejects.toThrow(/komerce_env valide/);
  });

  test('test local est autorisé si le serveur annonce aussi test', async () => {
    const env = { KOMERCE_ENV: 'test', BASE_URL: 'http://localhost:3000/boutique/' };
    await expect(assertRemoteMutantTargetSafe({ env, fetchImpl: health('test') }))
      .resolves.toMatchObject({ environment: 'test' });
  });
});
