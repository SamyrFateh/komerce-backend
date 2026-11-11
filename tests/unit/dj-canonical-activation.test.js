/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
/**
 * @test-kind unit
 * L10 — Djibouti must be activated ONLY via the admin-authenticated canonical HTTP writer.
 */
const { run } = require('../../scripts/recette/dj-canonical-activation');
const env = { STAGING_BASE_URL: 'https://staging.example.test', KOMERCE_STAGING_ADMIN_TOKEN: 'test-only',
  KOMERCE_DJ_ACTIVATE: '1' };
const db = { query: jest.fn() };
const targetGuard = jest.fn(async () => ({ confirmed: true }));
const good = { market: { code: 'DJ', lifecycle_status: 'PROVISIONING', is_active: false },
  readiness: { ready_for_activation: true, platform: { blockers: [] }, operations: { blockers: [] } } };
const answer = value => ({ ok: true, json: async () => value });

test('inspection read-only n’active pas le marché', async () => {
  const fetchImpl = jest.fn(async () => answer(good));
  const result = await run({ db, fetchImpl, env, targetGuard });
  expect(result.mode).toBe('read-only');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl.mock.calls[0][1].method).toBeUndefined();
});

test('un marché non prêt ne déclenche aucune mutation', async () => {
  const fetchImpl = jest.fn(async () => answer({ ...good, readiness: { ready_for_activation: false,
    platform: { blockers: [{code:'NO_CURRENCY_PARITY'}] }, operations: { blockers: [] } } }));
  await expect(run({ db, fetchImpl, env, apply:true, targetGuard }))
    .rejects.toThrow('DJ_NOT_READY_FOR_CANONICAL_ACTIVATION');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('activation passe par POST canonique et relecture de la postcondition', async () => {
  const after = { ...good, market: { code:'DJ', lifecycle_status:'ACTIVE', is_active:true } };
  const fetchImpl = jest.fn().mockResolvedValueOnce(answer(good)).mockResolvedValueOnce(answer({changed:true}))
    .mockResolvedValueOnce(answer(after));
  const result = await run({ db, fetchImpl, env, apply:true, targetGuard });
  expect(result.status).toBe('ACTIVE');
  expect(fetchImpl.mock.calls[1][0]).toBe('https://staging.example.test/api/admin/markets/DJ/lifecycle');
  expect(fetchImpl.mock.calls[1][1].method).toBe('POST');
  expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ status:'ACTIVE' });
});

test('échec fingerprint : aucune requête HTTP de gestion de marché', async () => {
  const fetchImpl = jest.fn();
  await expect(run({ db, fetchImpl, env, apply:true,
    targetGuard: async () => ({ confirmed: false }) })).rejects.toThrow('STAGING_TARGET_NOT_CONFIRMED');
  expect(fetchImpl).not.toHaveBeenCalled();
});
