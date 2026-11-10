'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { MARKERS, groupMarkers, listMarkers, assertEnvironment } =
  require('../../scripts/recette/hub-v1-staging-run-census');

test('Census: des RUN8 avec commandes et orphelins sans commandes sont tous découverts', () => {
  const got = groupMarkers([
    { source: 'users', run8: 'ABCDEF12', n: 1 },
    { source: 'orders', run8: '1234ABCD', n: 4 },
    { source: 'products', run8: 'ABCDEF12', n: 3 },
    { source: 'relais', run8: '1234ABCD', n: 1 },
  ]);
  expect(got).toEqual([
    { run8: '1234ABCD', sources: { orders: 4, relais: 1 } },
    { run8: 'ABCDEF12', sources: { users: 1, products: 3 } },
  ]);
});

test('Census: aucun nombre ou RUN8 non fiable, pas de source imprévue, limite sans troncature', () => {
  for (const item of [
    { source: 'users', run8: 'bad-name', n: 1 },
    { source: 'users', run8: 'ABCDEF12', n: -1 },
    { source: 'users', run8: 'ABCDEF12', n: 0 },
    { source: 'unknown', run8: 'ABCDEF12', n: 1 },
  ]) expect(() => groupMarkers([item])).toThrow('HUB_V1_CENSUS_UNTRUSTED_MARKER');
  expect(() => groupMarkers([
    { source: 'users', run8: 'ABCDEF12', n: 1 },
    { source: 'users', run8: 'ABCDEF12', n: 1 },
  ])).toThrow('HUB_V1_CENSUS_DUPLICATE_MARKER');
  const tooMany = Array.from({ length: 41 }, (_, i) => ({
    source: 'orders', run8: i.toString(16).toUpperCase().padStart(8, '0'), n: 1,
  }));
  expect(() => groupMarkers(tooMany)).toThrow('HUB_V1_CENSUS_RUN_LIMIT');
});

test('Census: SQL sources statiques, lecture seule, snapshot cohérent et ROLLBACK', async () => {
  const queries = [];
  const client = { query: jest.fn(async (sql) => {
    queries.push(sql);
    if (sql.startsWith('BEGIN') || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('FROM orders')) return { rows: [{ run8: 'ABCD1234', n: 4 }] };
    if (sql.includes('FROM products')) return { rows: [{ run8: '1234ABCD', n: 1 }] };
    return { rows: [] };
  }) };
  const report = await listMarkers(client);
  expect(report).toEqual([
    { run8: '1234ABCD', sources: { products: 1 } },
    { run8: 'ABCD1234', sources: { orders: 4 } },
  ]);
  expect(queries.at(0)).toBe('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  expect(queries.at(-1)).toBe('ROLLBACK');
  expect(queries.slice(1, -1).every(q => /^SELECT\b/.test(q))).toBe(true);
  expect(queries.length).toBe(MARKERS.length + 2);
});

test('Census: environnement non staging et SHA non épinglé refusés avant la base', () => {
  const good = {
    KOMERCE_ENV: 'staging', KOMERCE_TARGET_ENV: 'staging',
    NODE_ENV: 'test', EXPECTED_RAILWAY_ENVIRONMENT: 'staging',
    STAGING_BASE_URL: 'https://komerce-backend-production.up.railway.app',
    E2E_EXPECTED_DEPLOY_SHA: 'f'.repeat(40),
  };
  expect(() => assertEnvironment(good)).not.toThrow();
  for (const [key, value] of [
    ['KOMERCE_ENV', 'production'],
    ['KOMERCE_TARGET_ENV', 'production'],
    ['NODE_ENV', 'production'],
    ['EXPECTED_RAILWAY_ENVIRONMENT', 'production'],
    ['STAGING_BASE_URL', 'https://example.com'],
  ]) {
    expect(() => assertEnvironment({ ...good, [key]: value }))
      .toThrow('HUB_V1_RUN_CENSUS_STAGING_ONLY');
  }
  expect(() => assertEnvironment({ ...good, E2E_EXPECTED_DEPLOY_SHA: '' }))
    .toThrow('HUB_V1_RUN_CENSUS_DEPLOY_PIN_REQUIRED');
});
