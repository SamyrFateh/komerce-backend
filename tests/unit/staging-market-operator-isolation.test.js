'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { assertAllowed, accountsForRun, exerciseHttp } = require('../../scripts/recette/staging-market-operator-isolation');
const env = {
  KOMERCE_ENV: 'staging', NODE_ENV: 'test', EXPECTED_RAILWAY_ENVIRONMENT: 'staging',
  DATABASE_URL: 'postgres://user:pass@staging.example:5432/railway',
  KOMERCE_STAGING_RESET_DB_PIN: 'staging.example:5432/railway',
  STAGING_BASE_URL: 'https://komerce-backend-production.up.railway.app',
  ISOLATION_RUN_ID: '42382520838', ISOLATION_CONFIRMATION: 'CERTIFY-ISOLATED-MARKET-OPERATORS',
  E2E_ADMIN_EMAIL: 'admin@example.test',
};
describe('garde staging, mandat strict', () => {
  test('permet seulement la cible et la confirmation exactes', () => {
    expect(assertAllowed(env)).toBe('42382520838');
    for (const [key, value] of [
      ['KOMERCE_ENV','production'], ['NODE_ENV','production'],
      ['STAGING_BASE_URL','https://komerce.co'], ['EXPECTED_RAILWAY_ENVIRONMENT','production'],
      ['ISOLATION_RUN_ID','xyz'], ['ISOLATION_CONFIRMATION','wrong'],
      ['KOMERCE_STAGING_RESET_DB_PIN','bad-pin'],
    ]) expect(() => assertAllowed({ ...env, [key]: value })).toThrow();
  });
  test('deux adresses inédites, aucun compte partageable', () => {
    const accounts = accountsForRun('42382520838');
    expect(accounts.map(a=>a.code)).toEqual(['CM', 'CG']);
    expect(accounts[0].email).not.toBe(accounts[1].email);
  });
});
function mockHTTP(override = {}) {
  return jest.fn(async (url, options) => {
    const method = options.method;
    if (url.endsWith('/api/auth/login')) {
      const body = JSON.parse(options.body);
      const owner = body.email.includes('-cm-') ? 'CM' : 'CG';
      return { status: 200, json: async () => ({ user: { role: 'market_operator' } }),
        headers: { get: () => 'token=' + owner + '; HttpOnly' } };
    }
    const owner = options.headers.cookie.replace('token=', '');
    const target = /\/market\/(KM|CM|CG)(?:\/|$)/.exec(url)?.[1];
    let status = target === owner ? method === 'POST' ? 404 : 200 : 403;
    if (typeof override.status === 'function') status = override.status({ owner, target, method, url, status });
    return { status };
  });
}
const credentials = [
  { code:'CM', email:'recette-isolation-cm-42382520838@komerce.test', password:'not-real' },
  { code:'CG', email:'recette-isolation-cg-42382520838@komerce.test', password:'not-real' },
];
describe('preuve HTTP par les vrais endpoints', () => {
  test('accepte own workspace et 404 contrôlé sur l’écriture fictive, refuse 403 hors marché', async () => {
    const f = mockHTTP();
    const report = await exerciseHttp(credentials, f);
    expect(report.verdict).toBe('MARKET_OPERATOR_ISOLATION_PASS');
    expect(report.matrix.CM.CM).toEqual({ read:200, write_probe:404, trace_read:200 });
    expect(report.matrix.CM.CG).toEqual({ read:403, write_probe:403, trace_read:403 });
    expect(report.matrix.CG.KM).toEqual({ read:403, write_probe:403, trace_read:403 });
    expect(f.mock.calls.filter(([url,opts])=>opts.method==='POST' && url.includes('ISOLATION-PROBE-NONEXISTENT'))).toHaveLength(6);
  });
  test('échec fermé si accès hors marché en lecture', async () => {
    const f=mockHTTP({status:({owner,target,url,status}) =>
      owner==='CM' && target==='CG' && !url.endsWith('/ship') ? 200 : status});
    expect((await exerciseHttp(credentials,f)).verdict).toBe('MARKET_OPERATOR_ISOLATION_FAIL');
  });
  test('échec fermé si mutation hors marché franchit la garde', async () => {
    const f=mockHTTP({status:({owner,target,method,status}) =>
      owner==='CM' && target==='CG' && method==='POST' ? 404 : status});
    expect((await exerciseHttp(credentials,f)).verdict).toBe('MARKET_OPERATOR_ISOLATION_FAIL');
  });
  test('échec si le propre marché refuse la capability action', async () => {
    const f=mockHTTP({status:({owner,target,method,status}) =>
      owner===target && method==='POST' ? 403 : status});
    expect((await exerciseHttp(credentials,f)).verdict).toBe('MARKET_OPERATOR_ISOLATION_FAIL');
  });
});
