'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { maybeApplyCatalogProductRouteCanary } = require('../../services/catalog-product-route-canary');

const id = '11111111-1111-1111-1111-111111111111';
const legacy = { id, name_source: 'Legacy', description_source: 'Legacy desc', source_locale: 'en', price_kmf: 10, stock: 4, is_active: true };
const env = { CATALOG_PRODUCT_ROUTE_CANARY_ENABLED: 'true', CATALOG_PRODUCT_ROUTE_CANARY_PRODUCT_IDS: id };
const headers = { 'x-komerce-catalog-canary': 'v1' };
const projection = (fields) => ({ canonical_product_id: 'canon-1', fields });
const consensus = (value) => ({ status: 'CONSENSUS', value, candidates: [{ value }] });
const absent = { status: 'ABSENT', value: null, candidates: [] };
const conflict = { status: 'CONFLICT_PRESERVED', value: null, candidates: [{ value: 'A' }, { value: 'B' }] };

function run(overrides = {}) {
  return maybeApplyCatalogProductRouteCanary({
    productId: id, legacyRow: legacy, query: jest.fn(), env, headers,
    linkageFn: async () => ['canon-1'],
    projectionFn: async () => projection({ product_name: consensus('Canonical'), description: consensus('Canonical desc'), source_locale: consensus('fr') }),
    ...overrides,
  });
}

test('gates fermés: legacy et aucun lookup', async () => {
  const linkageFn = jest.fn();
  const result = await run({ env: {}, linkageFn });
  expect(result).toEqual({ row: legacy, diagnostic: null });
  expect(linkageFn).not.toHaveBeenCalled();
});
test('no-link est distinct de no-projection', async () => {
  expect((await run({ linkageFn: async () => [] })).diagnostic.status).toBe('legacy_no_link');
  expect((await run({ projectionFn: async () => null })).diagnostic.status).toBe('legacy_no_projection');
});
test('ambiguity conserve tous les IDs sans arbitrage', async () => {
  const result = await run({ linkageFn: async () => ['b', 'a'] });
  expect(result.diagnostic).toMatchObject({ status: 'legacy_ambiguity', canonical_product_ids: ['b', 'a'] });
  expect(result.row).toBe(legacy);
});
test('ABSENT fallback champ par champ et conserve les consensus', async () => {
  const result = await run({ projectionFn: async () => projection({ product_name: consensus('Canonical'), description: absent, source_locale: absent }) });
  expect(result.row.name_source).toBe('Canonical');
  expect(result.row.description_source).toBe('Legacy desc');
  expect(result.diagnostic).toMatchObject({ status: 'canonical_applied', canonical_fields_applied: 1, absent_fallbacks: 2 });
});
test('conflict produit un hybride sûr et un diagnostic conflict', async () => {
  const result = await run({ projectionFn: async () => projection({ product_name: consensus('Canonical'), description: conflict, source_locale: absent }) });
  expect(result.row.name_source).toBe('Canonical');
  expect(result.row.description_source).toBe('Legacy desc');
  expect(result.diagnostic).toMatchObject({ status: 'legacy_conflict', canonical_fields_applied: 1, conflict_fallbacks: 1, absent_fallbacks: 1 });
});
test('seam non SAFE sert strictement legacy', async () => {
  const result = await run({ seamFn: () => ({ status: 'FAIL', hybrid_row: { ...legacy, price_kmf: 999 }, summary: {} }) });
  expect(result.diagnostic.status).toBe('legacy_unsafe');
  expect(result.row).toBe(legacy);
});
test('exception interne est absorbée et observable seulement en interne', async () => {
  const result = await run({ linkageFn: async () => { throw new Error('db'); } });
  expect(result.diagnostic.status).toBe('legacy_canary_error');
  expect(result.row).toBe(legacy);
});
