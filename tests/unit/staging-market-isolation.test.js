'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { isolation } = require('../../scripts/recette/staging-market-isolation');
const ENV = { KOMERCE_ENV: 'staging', STAGING_BASE_URL: 'https://komerce-backend-production.up.railway.app', E2E_ADMIN_EMAIL: 'a@x', E2E_ADMIN_PASSWORD: 'x', E2E_AGENT_RELAIS_EMAIL: 'r@x', E2E_AGENT_RELAIS_PASSWORD: 'x' };
const fake = (relayHome, leak) => async (url, o = {}) => {
  const u = url.replace(ENV.STAGING_BASE_URL, ''); const res = (s, j = {}) => ({ status: s, json: async () => j, headers: { get: () => `sid=${o.body && JSON.parse(o.body).email === 'r@x' ? 'r' : 'a'}` } });
  if (u === '/api/auth/login') return res(200, { user: { role: JSON.parse(o.body).email === 'r@x' ? 'agent_relais' : 'admin' } });
  const isRelay = (o.headers.cookie || '') === 'sid=r'; const m = u.match(/market\/([A-Z]{2})/)[1];
  if (!isRelay) return res(o.method === 'POST' ? 403 : 200);
  if (m === relayHome) return res(o.method === 'POST' ? 404 : 200);
  return res(leak && o.method === 'POST' ? 404 : 403);
};
test('isolation : le relais ne voit et n\'agit que sur son marche', async () => {
  const r = await isolation({ env: ENV, fetchImpl: fake('CM') });
  expect(r.verdict).toBe('ISOLATION_PASS'); expect(r.relay_home_market).toEqual(['CM']);
});
test('fuite en ecriture sur un autre marche = ISOLATION_FAIL', async () => {
  expect((await isolation({ env: ENV, fetchImpl: fake('KM', true) })).verdict).toBe('ISOLATION_FAIL');
});
