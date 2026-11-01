'use strict';
/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({ pool: { end: jest.fn() }, query: jest.fn(), getClient: jest.fn() }));

const reset = require('../../scripts/recette/staging-reset');
const purge = require('../../scripts/controlled-business-purge');
const { confirmTarget } = require('../../scripts/recette/target-guard');

const URL_DB = 'postgresql://user:secret@db.internal:5432/railway';
const GOOD = Object.freeze({
  KOMERCE_ENV: 'staging', NODE_ENV: 'test', DATABASE_URL: URL_DB, STAGING_BASE_URL: 'https://staging.example.invalid',
  EXPECTED_RAILWAY_ENVIRONMENT: 'staging', KOMERCE_STAGING_RESET_DB_PIN: 'db.internal:5432/railway',
  KOMERCE_STAGING_RESET_ACK: reset.ACK_VALUE, KOMERCE_CONTROLLED_PURGE_CONFIRM: purge.CONFIRM_TOKEN,
});
const refused = (mode, over) => { try { reset.assertResetAllowed(mode, { ...GOOD, ...over }); return null; } catch (e) { return e.code; } };

describe('staging reset : gardes avant toute ecriture', () => {
  test('configuration complete : dry-run et execute autorises', () => {
    expect(refused('dry-run', {})).toBeNull();
    expect(refused('execute', {})).toBeNull();
  });
  test('ACK et jeton ne sont exiges que pour execute', () => {
    expect(refused('dry-run', { KOMERCE_STAGING_RESET_ACK: '', KOMERCE_CONTROLLED_PURGE_CONFIRM: '' })).toBeNull();
    expect(refused('execute', { KOMERCE_STAGING_RESET_ACK: 'oui' })).toBe('STAGING_RESET_ACK_MISSING');
    expect(refused('execute', { KOMERCE_CONTROLLED_PURGE_CONFIRM: 'x' })).toBe('STAGING_RESET_PURGE_TOKEN_MISSING');
  });
  test('production refusee quel que soit le signal', () => {
    expect(refused('dry-run', { NODE_ENV: 'production' })).toBe('STAGING_RESET_REFUSED_PRODUCTION');
    expect(refused('execute', { KOMERCE_ENV: 'production' })).toBe('STAGING_RESET_REFUSED_PRODUCTION');
  });
  test('non staging, base absente, URL non https, epingle d environnement ou de base absente/fausse : refus', () => {
    expect(refused('dry-run', { KOMERCE_ENV: 'dev' })).toBe('STAGING_RESET_REFUSED_NOT_STAGING');
    expect(refused('dry-run', { KOMERCE_ENV: undefined })).toBe('STAGING_RESET_REFUSED_NOT_STAGING');
    expect(refused('dry-run', { DATABASE_URL: '' })).toBe('STAGING_RESET_DATABASE_URL_MISSING');
    expect(refused('dry-run', { STAGING_BASE_URL: 'http://staging' })).toBe('STAGING_RESET_REFUSED_BASE_URL');
    expect(refused('dry-run', { EXPECTED_RAILWAY_ENVIRONMENT: 'production' })).toBe('STAGING_RESET_REFUSED_ENV_PIN');
    expect(refused('dry-run', { KOMERCE_STAGING_RESET_DB_PIN: '' })).toBe('STAGING_RESET_DATABASE_NOT_PINNED');
    expect(refused('dry-run', { KOMERCE_STAGING_RESET_DB_PIN: 'autre:5432/railway' })).toBe('STAGING_RESET_DATABASE_NOT_PINNED');
    expect(refused('dry-run', { DATABASE_URL: 'pas une url' })).toBe('STAGING_RESET_DATABASE_NOT_PINNED');
  });
  test('mode obligatoire et exclusif', () => {
    expect(refused(undefined, {})).toBe('STAGING_RESET_MODE_REQUIRED');
    expect(refused('purge', {})).toBe('STAGING_RESET_MODE_REQUIRED');
  });
  test('epingle de base : host:port/nom sans identifiants', () => {
    expect(reset.databasePin(URL_DB)).toBe('db.internal:5432/railway');
    expect(reset.databasePin('postgres://h/db')).toBe('h:5432/db');
    expect(reset.databasePin('???')).toBeNull();
  });
});

describe('staging reset : aucune ecriture si la cible n est pas confirmee', () => {
  const dbSpy = () => ({ pool: { end: jest.fn() }, query: jest.fn(), getClient: jest.fn() });

  test('garde d identite : service non staging -> refus, purge jamais appelee', async () => {
    const d = dbSpy();
    d.query.mockResolvedValue({ rows: [{ name: 'railway', oid: '1', started: '1' }] });
    const run = jest.fn();
    const fetchImpl = async () => ({ ok: true, json: async () => ({ target: { db_fingerprint: 'x', identity: { komerce_env: 'production' } } }) });
    await expect(reset.runReset('execute', {
      env: GOOD,
      deps: { db: d, purge: { run, CONFIRM_TOKEN: purge.CONFIRM_TOKEN }, confirmTarget: (a) => confirmTarget({ ...a, fetchImpl }) },
    })).rejects.toThrow(/cible non confirmée/);
    expect(run).not.toHaveBeenCalled();
    expect(d.getClient).not.toHaveBeenCalled();
  });

  test('cible non confirmee (reponse vide) -> refus', async () => {
    const run = jest.fn();
    await expect(reset.runReset('dry-run', { env: GOOD, deps: { db: dbSpy(), purge: { run }, confirmTarget: async () => null } }))
      .rejects.toMatchObject({ code: 'STAGING_RESET_TARGET_NOT_CONFIRMED' });
    expect(run).not.toHaveBeenCalled();
  });

  test('garde appliquee avant meme la garde d identite', async () => {
    const confirm = jest.fn();
    await expect(reset.runReset('execute', { env: { ...GOOD, KOMERCE_STAGING_RESET_ACK: '' }, deps: { confirmTarget: confirm } }))
      .rejects.toMatchObject({ code: 'STAGING_RESET_ACK_MISSING' });
    expect(confirm).not.toHaveBeenCalled();
  });

  test('main : mode manquant ou double -> code 1 sans toucher la base', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    require('../../db').pool.end.mockResolvedValue();
    await reset.main([], GOOD);
    expect(process.exitCode).toBe(1);
    await reset.main(['--dry-run', '--execute'], GOOD);
    expect(process.exitCode).toBe(1);
    expect(err).toHaveBeenCalled();
    process.exitCode = 0;
  });

  test('derive des referentiels existants : execute refuse sauf autorisation explicite', async () => {
    const mkClient = (afterName) => {
      let calls = 0;
      return {
        query: jest.fn(async (sql) => {
          if (/^(BEGIN|ROLLBACK)/.test(sql)) return { rows: [] };
          calls += 1;
          const table = reset.REFERENCE_TABLES[(calls - 1) % reset.REFERENCE_TABLES.length];
          const phase = calls <= reset.REFERENCE_TABLES.length ? 'before' : 'after';
          if (table !== 'markets') return { rows: [] };
          return { rows: [{ r: { code: 'WM', name: phase === 'before' ? 'Ancien' : afterName, updated_at: 'x' } }] };
        }),
        release: jest.fn(),
      };
    };
    const d = dbSpy();
    d.getClient.mockResolvedValue(mkClient('Nouveau'));
    const run = jest.fn(async () => ({ before: {}, cascade_tables: [], delete_roots: [], protected_before: {}, uncertain_foundation: [], fixtures: { blockers: [] } }));
    const deps = { db: d, purge: { run }, confirmTarget: async () => ({ confirmed: true }), seed: jest.fn(async () => ({})), verify: async () => ({ ok: true }) };
    await expect(reset.runReset('execute', { env: GOOD, deps })).rejects.toMatchObject({ code: 'STAGING_RESET_REFERENCE_DRIFT' });
    expect(run).not.toHaveBeenCalled();
    d.getClient.mockResolvedValue(mkClient('Nouveau'));
    const report = await reset.runReset('execute', { env: { ...GOOD, KOMERCE_STAGING_RESET_ALLOW_REFERENCE_DRIFT: '1' }, deps });
    expect(report.status).toBe('RESET_OK');
    expect(report.reference_drift.markets.diffs).toEqual([{ key: 'WM', column: 'name', staging: 'Ancien', seed: 'Nouveau', change: 'overwritten_by_seed' }]);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ execute: true, withFixtures: true }));
  });

  test('diff de referentiel : colonne, valeur staging, valeur seed ; ajout et retrait signales', () => {
    const empty = Object.fromEntries(reset.REFERENCE_TABLES.map((t) => [t, []]));
    const d = reset.diffReference(
      { ...empty, currency_parities: [{ currency: 'XAF', eur_rate: 650 }], markets: [{ code: 'ZZ', name: 'x' }] },
      { ...empty, currency_parities: [{ currency: 'XAF', eur_rate: 655.957 }], markets: [{ code: 'KM', name: 'Comores' }] }
    );
    expect(d.currency_parities.diffs).toEqual([{ key: 'XAF', column: 'eur_rate', staging: 650, seed: 655.957, change: 'overwritten_by_seed' }]);
    expect(d.markets.diffs.map((x) => x.change).sort()).toEqual(['added_by_seed', 'removed']);
  });

  test('perimetre full : valeur invalide refusee, defaut prudent', () => {
    expect(refused('dry-run', { KOMERCE_STAGING_RESET_MODE: 'full' })).toBeNull();
    expect(refused('dry-run', { KOMERCE_STAGING_RESET_MODE: 'prudent' })).toBeNull();
    expect(refused('dry-run', { KOMERCE_STAGING_RESET_MODE: 'tout' })).toBe('STAGING_RESET_SCOPE_INVALID');
  });

  test('stripe livemode : non stocke -> le dit ; colonne livemode -> decompte', async () => {
    const q = (cols, rows) => ({ query: jest.fn(async (sql) => {
      if (/information_schema/.test(sql)) return { rows: cols };
      if (/COUNT\(\*\)::int AS n FROM stripe_events_processed$/.test(sql)) return { rows: [{ n: 3 }] };
      return { rows };
    }) });
    expect(await reset.stripeLivemode(q([{ column_name: 'stripe_event_id', data_type: 'text' }], []))).toMatchObject({ stored: 'not_stored', by_livemode: null });
    expect(await reset.stripeLivemode(q([{ column_name: 'livemode', data_type: 'boolean' }], [{ livemode: 'true', n: 2 }, { livemode: 'false', n: 1 }])))
      .toMatchObject({ stored: 'column', by_livemode: { true: 2, false: 1 } });
    expect(await reset.stripeLivemode(q([{ column_name: 'payload_summary', data_type: 'jsonb' }], [{ livemode: 'absent', n: 3 }])))
      .toMatchObject({ stored: 'not_stored' });
  });
});
