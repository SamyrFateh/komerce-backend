'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { activate, CORRIDORS } = require('../../scripts/recette/staging-market-activate');

const ENV = { KOMERCE_ENV: 'staging', STAGING_BASE_URL: 'https://komerce-backend-production.up.railway.app', E2E_ADMIN_EMAIL: 'a@x.test', E2E_ADMIN_PASSWORD: 'x', ACTIVATE_MARKET: 'CM' };
function fakeFetch({ ready, lifecycle = 'SUSPENDED', carriers = [] }) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const u = url.replace(ENV.STAGING_BASE_URL, ''); const method = opts.method || 'GET'; calls.push(`${method} ${u}`);
    const res = (status, json) => ({ status, json: async () => json, headers: { get: () => 'sid=1; Path=/' } });
    if (u === '/api/auth/login') return res(200, { user: { role: 'admin' } });
    if (u.endsWith('/control-plane')) return res(200, { market: { lifecycle_status: calls.some((c) => c.includes('/lifecycle')) ? 'ACTIVE' : lifecycle }, readiness: { ready_for_activation: ready }, gaps: ready ? [] : [{ code: 'NO_ACTIVE_MEMBERSHIP' }], deliveryProof: { proven: false } });
    if (u === '/api/carriers' && method === 'GET') return res(200, { data: carriers });
    if (u === '/api/carriers') return res(201, { id: 'c1', name: JSON.parse(opts.body).name });
    if (u.endsWith('/delivery-attestations')) return res(201, { id: 'att1' });
    if (u.endsWith('/lifecycle')) return res(200, { changed: true });
    throw new Error('inattendu ' + method + ' ' + u);
  };
  return { fn, calls };
}

test('readiness non vert : arret sans aucune ecriture, meme avec confirmation', async () => {
  const { fn, calls } = fakeFetch({ ready: false });
  const r = await activate({ env: { ...ENV, ACTIVATE_APPLY: '1', ACTIVATE_CONFIRMATION: 'ACTIVATE-RECETTE-CM' }, fetchImpl: fn });
  expect(r.result).toBe('READINESS_NOT_GREEN_NO_WRITE');
  expect(calls.filter((c) => c.startsWith('POST') && !c.includes('/auth/login'))).toEqual([]);
});

test('dry-run : aucune ecriture meme si le readiness est vert', async () => {
  const { fn, calls } = fakeFetch({ ready: true });
  const r = await activate({ env: ENV, fetchImpl: fn });
  expect(r.result).toBe('DRY_RUN_READY');
  expect(calls.filter((c) => c.startsWith('POST') && !c.includes('/auth/login'))).toEqual([]);
});

test('apply : transporteur dedie, attestation provisoire XAF, puis lifecycle ACTIVE (dans cet ordre)', async () => {
  const { fn, calls } = fakeFetch({ ready: true });
  const r = await activate({ env: { ...ENV, ACTIVATE_APPLY: '1', ACTIVATE_CONFIRMATION: 'ACTIVATE-RECETTE-CM' }, fetchImpl: fn, now: new Date('2026-11-07T00:00:00Z') });
  expect(r.result).toBe('ACTIVATED');
  expect(calls.filter((c) => c.startsWith('POST') && !c.includes('/auth/login'))).toEqual([
    'POST /api/carriers', 'POST /api/admin/markets/CM/delivery-attestations', 'POST /api/admin/markets/CM/lifecycle']);
  expect(CORRIDORS.CM.rate_currency).toBe('XAF'); expect(CORRIDORS.CG.rate_currency).toBe('XAF');
});

test('marches refuses : KM, DJ, YT ; confirmation erronee = dry-run', async () => {
  for (const m of ['KM', 'DJ', 'YT']) await expect(activate({ env: { ...ENV, ACTIVATE_MARKET: m }, fetchImpl: fakeFetch({ ready: true }).fn })).rejects.toThrow('MARKET_NOT_ALLOWED');
  const { fn } = fakeFetch({ ready: true });
  expect((await activate({ env: { ...ENV, ACTIVATE_APPLY: '1', ACTIVATE_CONFIRMATION: 'oui' }, fetchImpl: fn })).result).toBe('DRY_RUN_READY');
});
