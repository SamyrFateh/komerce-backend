'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { runInit } = require('../../scripts/recette/init-pricing-recette');

const staging = { KOMERCE_TARGET_ENV: 'staging' };
const mk = (cur) => ({
  db: { query: jest.fn(async () => ({ rows: [cur] })) },
  ratesService: { updateRates: jest.fn(async () => ({})) },
});

test('refuse hors staging', async () => {
  await expect(runInit({ env: { KOMERCE_TARGET_ENV: 'production' }, ...mk({}) })).rejects.toMatchObject({ code: 'TARGET_ENV_NOT_STAGING' });
  await expect(runInit({ env: {}, ...mk({}) })).rejects.toMatchObject({ code: 'TARGET_ENV_NOT_STAGING' });
});

test('sans fichier de valeurs : à renseigner, aucune écriture', async () => {
  const d = mk({});
  const r = await runInit({ env: staging, apply: true, ...d });
  expect(r.items[0].status).toBe('a_renseigner');
  expect(d.ratesService.updateRates).not.toHaveBeenCalled();
});

test('valeurs sans source : refusées', async () => {
  const d = mk({});
  const r = await runInit({ env: staging, apply: true, params: { exchange_rates: { eur_kmf: 1, aed_kmf: 1 } }, ...d });
  expect(r.items[0].status).toBe('a_renseigner');
  expect(d.ratesService.updateRates).not.toHaveBeenCalled();
});

test('dry-run n’écrit pas ; apply écrit via le service ; rejeu = déjà en place', async () => {
  const params = { exchange_rates: { eur_kmf: 10, aed_kmf: 20, source: 'fichier responsable' } };
  const d = mk({ taux_change_eur_kmf: '5', taux_aed_kmf: '6' });
  expect((await runInit({ env: staging, params, ...d })).items[0].status).toBe('a_appliquer');
  expect(d.ratesService.updateRates).not.toHaveBeenCalled();
  expect((await runInit({ env: staging, params, apply: true, ...d })).items[0].status).toBe('applique');
  expect(d.ratesService.updateRates).toHaveBeenCalledWith({ eur_kmf: 10, aed_kmf: 20 }, null);
  const same = mk({ taux_change_eur_kmf: '10', taux_aed_kmf: '20' });
  expect((await runInit({ env: staging, params, apply: true, ...same })).items[0].status).toBe('deja_en_place');
  expect(same.ratesService.updateRates).not.toHaveBeenCalled();
});
