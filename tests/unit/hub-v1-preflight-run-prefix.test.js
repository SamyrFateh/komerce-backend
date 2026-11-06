'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { databaseGates } = require('../../scripts/recette/hub-v1-staging-transactional-preflight');

const clientFor = () => {
  const calls = [];
  return { calls, query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('schema_migrations')) return { rows: [] };
    if (sql.includes('FROM public.orders')) return { rows: [{ n: 0 }] };
    if (sql.includes('product_suppliers')) return { rows: [{ n: 0 }] };
    return { rows: [] };
  } };
};

describe('preflight : unicite de reference par RUN8', () => {
  test('avec un RUN8 valide, le prefixe verifie est celui de la fixture', async () => {
    const c = clientFor(); await databaseGates(c, '5605A7A8');
    expect(c.calls.find((x) => x.sql.includes('FROM public.orders')).params).toEqual(['E2E-HUB-V1-5605A7A8%']);
  });
  test('sans RUN8 ou RUN8 invalide, la garde reste stricte (tout E2E-HUB-V1-)', async () => {
    for (const run of [undefined, 'zz', '5605a7a8x']) {
      const c = clientFor(); await databaseGates(c, run);
      expect(c.calls.find((x) => x.sql.includes('FROM public.orders')).params).toEqual(['E2E-HUB-V1-%']);
    }
  });
});
