'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');
const { verifyAccounts, expectedFor } = require('../../scripts/recette/staging-e2e-verify-accounts');
const { PROFILES } = require('../../scripts/recette/staging-e2e-provision');

const read = (f) => fs.readFileSync(path.join(__dirname, '../../.github/workflows', f), 'utf8');
const reset = read('staging-reset.yml');
const provision = read('staging-e2e-provision.yml');
const block = reset.slice(reset.indexOf('\n  provision:'));

describe('staging-reset.yml : chainage reset -> provisionnement E2E', () => {
  test('le job provision depend du job reset et de RESET_OK', () => {
    expect(block).toMatch(/needs: reset/);
    expect(block).toMatch(/needs\.reset\.outputs\.reset_status == 'RESET_OK'/);
  });
  test('saute en dry-run et si skip_provision vaut true', () => {
    expect(block).toMatch(/inputs\.mode == 'execute'/);
    expect(block).toMatch(/inputs\.skip_provision != true/);
  });
  test('entrees provision_markets (CM,CG) et skip_provision (false)', () => {
    expect(reset).toMatch(/provision_markets:[\s\S]*?default: 'CM,CG'/);
    expect(reset).toMatch(/skip_provision:[\s\S]*?type: boolean\s+default: false/);
  });
  test('reutilise le workflow de provisionnement (pas de copie) avec secrets herites', () => {
    expect(block).toMatch(/uses: \.\/\.github\/workflows\/staging-e2e-provision\.yml/);
    expect(block).toMatch(/secrets: inherit/);
    expect(block).toMatch(/extra_markets: \$\{\{ inputs\.provision_markets \}\}/);
    expect(provision).toMatch(/workflow_call:/);
    expect(reset).not.toMatch(/staging-e2e-provision\.js/);
  });
  test('confirmation interne : aucune saisie supplementaire, execute exige la confirmation du reset', () => {
    expect(block).toMatch(/confirmation: PROVISION-STAGING-E2E/);
    expect(reset).not.toMatch(/provision_confirmation/);
    expect(reset).toMatch(/\[ "\$RESET_CONFIRMATION" = 'RESET-STAGING-BUSINESS-DATA' \]/);
    expect(provision).toMatch(/\[ "\$PROVISION_CONFIRMATION" = 'PROVISION-STAGING-E2E' \]/);
  });
  test('dry-run : plan affiche, rien execute', () => {
    expect(reset).toMatch(/E2E provisioning plan \(dry-run, nothing executed\)[\s\S]*?if: \$\{\{ inputs\.mode == 'dry-run' \}\}/);
  });
  test('garde-fous inchanges : proprietaire, epingle, identite live; verification finale en lecture seule', () => {
    expect(reset).toMatch(/if: github\.actor == github\.repository_owner/);
    expect(provision).toMatch(/if: >-\s+github\.actor == github\.repository_owner/);
    expect(reset).toMatch(/target-guard\.js/);
    expect(provision).toMatch(/staging-e2e-verify-accounts\.js/);
    expect(provision).toMatch(/Verify E2E accounts[\s\S]*?PROVISION_MODE == 'execute'/);
    expect(block).not.toMatch(/E2E_\w+_PASSWORD/);
  });
});

describe('staging-e2e-verify-accounts : lecture seule', () => {
  const env = { E2E_PROVISION_EXTRA_MARKETS: 'CM,CG' };
  for (const p of PROFILES) env[`E2E_${p.prefix}_EMAIL`] = `${p.key}@x.test`;
  function fakeDb({ missing = new Set(), noMarkets = new Set() } = {}) {
    const writes = [];
    return {
      writes,
      query: async (sql, params = []) => {
        if (!/^\s*SELECT/i.test(sql)) writes.push(sql);
        if (/FROM users/.test(sql)) {
          const key = params[0].replace('@x.test', '');
          if (missing.has(key)) return { rows: [] };
          const p = PROFILES.find((x) => x.key === key);
          return { rows: [{ id: key, role: p.role, relais_id: 'r1' }] };
        }
        if (/assignment_memberships/.test(sql)) {
          return { rows: noMarkets.has(params[0]) ? [] : ['KM', 'CM', 'CG'].map((code) => ({ code })) };
        }
        return { rows: [{}] };
      },
    };
  }
  test('tout present : ok, aucune ecriture, aucune valeur de secret', async () => {
    const db = fakeDb();
    const r = await verifyAccounts({ db, env });
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(PROFILES.length);
    expect(db.writes).toEqual([]);
  });
  test('compte manquant (transitaire) : echec', async () => {
    const r = await verifyAccounts({ db: fakeDb({ missing: new Set(['agent_transitaire']) }), env });
    expect(r.ok).toBe(false);
    expect(r.failures).toEqual(['agent_transitaire']);
  });
  test('perimetre de marche manquant : echec', async () => {
    const r = await verifyAccounts({ db: fakeDb({ noMarkets: new Set(['finance']) }), env });
    expect(r.failures).toContain('finance');
  });
  test('marches attendus : operateur et relais portent KM + extras', () => {
    expect(expectedFor(PROFILES.find((p) => p.key === 'market_operator'), ['CM', 'CG']).sort()).toEqual(['CG', 'CM', 'KM']);
    expect(expectedFor(PROFILES.find((p) => p.key === 'finance'), ['CM', 'CG'])).toEqual(['KM']);
  });
});

test('global reset reserves the same staging lock as G6, through the provision chain',()=>{
  expect(reset).toMatch(/^concurrency:\n(?:  #.*\n)*  group: komerce-g6-canonical-real-transaction\n  cancel-in-progress: false/m);
  expect(reset).not.toMatch(/group: komerce-staging-reset/);
});
