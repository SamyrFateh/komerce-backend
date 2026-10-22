'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');
const { runInit } = require('../../scripts/recette/init-pricing-recette');

const staging = { KOMERCE_TARGET_ENV: 'staging' };
const PARAMS = { is_test_data: true, recette_label: 'T', aed_kmf: { value: 140, source: 'FICTIF' }, relay_commission_kmf: { value: 600, source: 'FICTIF' } };

function mk({ fc, comp }) {
  const state = { fc: { ...fc }, comp: { ...comp } };
  return {
    state,
    db: { query: jest.fn(async (sql) => ({ rows: [sql.includes('finance_config') ? state.fc : state.comp] })) },
    ratesService: { updateRates: jest.fn(async ({ aed_kmf }) => { state.fc.taux_aed_kmf = String(aed_kmf); }) },
    componentService: { updateComponent: jest.fn(async (_s, b) => { state.comp.default_value = String(b.default_value); }) },
  };
}
const DEF = { fc: { taux_change_eur_kmf: '491.96', taux_aed_kmf: '138.00', updated_by: null }, comp: { default_value: '500', updated_by: null } };
const st = (r, k) => r.items.find(i => i.key === k).status;

test('refuse hors staging', async () => {
  await expect(runInit({ env: { KOMERCE_TARGET_ENV: 'production' }, ...mk(DEF) })).rejects.toMatchObject({ code: 'TARGET_ENV_NOT_STAGING' });
});

test('sans fichier : à renseigner, jamais complet', async () => {
  const d = mk(DEF);
  const r = await runInit({ env: staging, apply: true, ...d });
  expect(r.complete).toBe(false);
  expect(st(r, 'aed_kmf')).toBe('a_renseigner');
  expect(st(r, 'relay_commission_kmf')).toBe('a_renseigner');
  expect(d.ratesService.updateRates).not.toHaveBeenCalled();
});

test('fichier non marqué test : refusé', async () => {
  await expect(runInit({ env: staging, params: { ...PARAMS, is_test_data: false }, ...mk(DEF) })).rejects.toMatchObject({ code: 'PARAMS_NOT_MARKED_TEST' });
});

test('valeur sans source : aucune écriture', async () => {
  const d = mk(DEF);
  const r = await runInit({ env: staging, apply: true, params: { ...PARAMS, aed_kmf: { value: 140 }, relay_commission_kmf: { value: 600, source: ' ' } }, ...d });
  expect(st(r, 'aed_kmf')).toBe('gere_par_observation_fx'); // AED retiré : observation EUR/USD à deux personnes
  expect(st(r, 'relay_commission_kmf')).toBe('a_renseigner');
  expect(d.ratesService.updateRates).not.toHaveBeenCalled();
  expect(d.componentService.updateComponent).not.toHaveBeenCalled();
});

test('dry-run n’écrit pas ; apply écrit via les services canoniques sans toucher EUR ; rejeu = déjà en place', async () => {
  const d = mk(DEF);
  expect(st(await runInit({ env: staging, params: PARAMS, ...d }), 'aed_kmf')).toBe('gere_par_observation_fx');
  expect(d.ratesService.updateRates).not.toHaveBeenCalled();
  const r = await runInit({ env: staging, params: PARAMS, apply: true, ...d });
  expect(st(r, 'aed_kmf')).toBe('gere_par_observation_fx');
  expect(st(r, 'relay_commission_kmf')).toBe('applique');
  expect(d.ratesService.updateRates).not.toHaveBeenCalled(); // le taux AED n'est plus écrit par ce script
  expect(d.componentService.updateComponent).toHaveBeenCalledWith({ key: 'commission_relais_kmf' }, { default_value: 600 }, null);
  expect(r.complete).toBe(true);
  expect(r.note).toMatch(/non validées/);
  const again = await runInit({ env: staging, params: PARAMS, apply: true, ...d });
  expect(st(again, 'aed_kmf')).toBe('gere_par_observation_fx');
  expect(st(again, 'relay_commission_kmf')).toBe('deja_en_place');
  expect(d.ratesService.updateRates).toHaveBeenCalledTimes(0);
  expect(d.componentService.updateComponent).toHaveBeenCalledTimes(1);
});

test('n’écrase jamais une configuration saisie par un opérateur', async () => {
  const d = mk({ fc: { ...DEF.fc, updated_by: 'u1' }, comp: { default_value: '750', updated_by: 'u1' } });
  const r = await runInit({ env: staging, params: PARAMS, apply: true, ...d });
  expect(st(r, 'aed_kmf')).toBe('gere_par_observation_fx');
  expect(st(r, 'relay_commission_kmf')).toBe('configuration_presente_non_ecrasee');
  expect(d.ratesService.updateRates).not.toHaveBeenCalled();
  expect(d.componentService.updateComponent).not.toHaveBeenCalled();
});

test('le jeu de recette fourni est marqué test et sourcé comme fictif', () => {
  const f = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'recette', 'fixtures', 'pricing-recette.test-values.json'), 'utf8'));
  expect(f.is_test_data).toBe(true);
  expect(f.aed_kmf.source).toMatch(/FICTIF/);
  expect(f.relay_commission_kmf.source).toMatch(/FICTIF/);
});
