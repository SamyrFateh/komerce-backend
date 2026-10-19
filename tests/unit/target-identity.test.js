'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { computeDbFingerprint, readRuntimeIdentity, assertSameTarget } = require('../../services/target-identity');
const { confirmTarget } = require('../../scripts/recette/target-guard');

const dbRow = (o = {}) => ({ query: jest.fn().mockResolvedValue({ rows: [{ name: 'railway', oid: '16384', addr: '10.0.0.1', port: '5432', ...o }] }) });

describe('identité de cible', () => {
  test('empreinte stable, différente si l\'adresse serveur diffère (oid identiques)', async () => {
    const a = await computeDbFingerprint(dbRow());
    const b = await computeDbFingerprint(dbRow());
    const c = await computeDbFingerprint(dbRow({ addr: '10.0.0.2' }));
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{24}$/);
  });

  test('assertSameTarget : confirme seulement empreintes égales ET service déclaré staging', () => {
    const remote = { db_fingerprint: 'abc', identity: { komerce_env: 'staging', railway_environment: 'staging' } };
    expect(assertSameTarget({ local: { fingerprint: 'abc' }, remote }).confirmed).toBe(true);
    expect(() => assertSameTarget({ local: { fingerprint: 'zzz' }, remote })).toThrow(/pas celle du service/);
    expect(() => assertSameTarget({ local: { fingerprint: 'abc' }, remote: { ...remote, identity: { komerce_env: 'production' } } })).toThrow(/non déclaré staging/);
    expect(() => assertSameTarget({ local: { fingerprint: 'abc' }, remote, expected: { railway_environment: 'production' } })).toThrow(/attendu/);
    expect(() => assertSameTarget({ local: null, remote: null })).toThrow(/absente/);
  });

  test('le nom de base seul ne suffit pas : refus sans empreinte du service', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ identity: { komerce_env: 'staging' } }) });
    await expect(confirmTarget({ db: dbRow(), fetchImpl, env: { STAGING_BASE_URL: 'https://x.example' } })).rejects.toMatchObject({ code: 'TARGET_NOT_CONFIRMED' });
  });

  test('confirmTarget OK quand le service publie la même empreinte', async () => {
    const db = dbRow();
    const { fingerprint } = await computeDbFingerprint(db);
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ db_fingerprint: fingerprint, identity: { komerce_env: 'staging' } }) });
    const v = await confirmTarget({ db, fetchImpl, env: { STAGING_BASE_URL: 'https://x.example' } });
    expect(v.confirmed).toBe(true);
    expect(JSON.stringify(v)).not.toMatch(/postgres/);
  });

  test('refus sans URL https du service', async () => {
    await expect(confirmTarget({ db: dbRow(), env: {} })).rejects.toMatchObject({ code: 'TARGET_NOT_CONFIRMED' });
  });

  test('readRuntimeIdentity ne remonte que des noms', () => {
    expect(readRuntimeIdentity({ KOMERCE_ENV: 'staging', RAILWAY_ENVIRONMENT_NAME: 'staging', RAILWAY_SERVICE_NAME: 'svc', DATABASE_URL: 'postgres://secret' }))
      .toEqual({ komerce_env: 'staging', railway_environment: 'staging' });
  });
});
