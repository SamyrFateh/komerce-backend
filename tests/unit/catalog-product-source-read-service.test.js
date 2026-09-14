'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {
  READ_MODES,
  resolveCatalogProductReadMode,
  readCatalogProductSource,
} = require('../../services/catalog-product-source-read-service');

const id = '11111111-1111-1111-1111-111111111111';
const legacy = { id, name_source: 'Legacy', description_source: 'Legacy desc', source_locale: 'en', price_kmf: 5000, stock: 7 };
const consensus = (value) => ({ status: 'CONSENSUS', value, candidates: [] });
const absent = { status: 'ABSENT', value: null, candidates: [] };
const conflict = { status: 'CONFLICT_PRESERVED', value: null, candidates: [{ value: 'A' }, { value: 'B' }] };
const projected = (fields) => ({ canonical_product_id: 'canon-1', fields });

function seam(row, product) {
  const { applyCanonicalSourceReadSeam } = require('../../services/catalog-product-read-cutover-trial');
  return applyCanonicalSourceReadSeam(row, product);
}
function run(overrides = {}) {
  return readCatalogProductSource({
    productId: id,
    legacyRow: legacy,
    query: jest.fn(),
    mode: READ_MODES.CANONICAL_PREFERRED,
    linkageFn: async () => ['canon-1'],
    projectionFn: async () => projected({
      product_name: consensus('Canonical'),
      description: consensus('Canonical desc'),
      source_locale: consensus('fr'),
    }),
    seamFn: seam,
    ...overrides,
  });
}

test('mode absent ou invalide résout LEGACY_ONLY', () => {
  expect(resolveCatalogProductReadMode({})).toBe('LEGACY_ONLY');
  expect(resolveCatalogProductReadMode({ CATALOG_PRODUCT_READ_MODE: 'wrong' })).toBe('LEGACY_ONLY');
  expect(resolveCatalogProductReadMode({ CATALOG_PRODUCT_READ_MODE: 'canonical_preferred' })).toBe('CANONICAL_PREFERRED');
});

test('mode explicite invalide fail-closed en LEGACY_ONLY sans lookup canonique', async () => {
  const linkageFn = jest.fn();
  const result = await run({ mode: 'bogus-mode', linkageFn });
  expect(result.row).toBe(legacy);
  expect(result.mode).toBe('LEGACY_ONLY');
  expect(result.diagnostic.status).toBe('legacy_mode');
  expect(linkageFn).not.toHaveBeenCalled();
});

test('LEGACY_ONLY ne réalise aucun lookup canonique', async () => {
  const linkageFn = jest.fn();
  const result = await run({ mode: READ_MODES.LEGACY_ONLY, linkageFn });
  expect(result.row).toBe(legacy);
  expect(result.diagnostic.status).toBe('legacy_mode');
  expect(linkageFn).not.toHaveBeenCalled();
});

test('CANARY gates fermés ne réalise aucun lookup', async () => {
  const linkageFn = jest.fn();
  const result = await run({ mode: READ_MODES.CANARY, env: { CATALOG_PRODUCT_READ_MODE: 'CANARY' }, linkageFn });
  expect(result.row).toBe(legacy);
  expect(result.diagnostic.status).toBe('legacy_mode');
  expect(linkageFn).not.toHaveBeenCalled();
});

test('CANARY gates ouverts conserve le comportement canonique', async () => {
  const result = await run({
    mode: READ_MODES.CANARY,
    headers: { 'x-komerce-catalog-canary': 'v1' },
    env: { CATALOG_PRODUCT_READ_MODE: 'CANARY', CATALOG_PRODUCT_ROUTE_CANARY_ENABLED: 'true', CATALOG_PRODUCT_ROUTE_CANARY_PRODUCT_IDS: id },
  });
  expect(result.diagnostic.status).toBe('canonical_applied');
});

test('CANONICAL_PREFERRED applique un consensus sans toucher prix ni stock', async () => {
  const result = await run();
  expect(result.row).toMatchObject({ name_source: 'Canonical', description_source: 'Canonical desc', source_locale: 'fr', price_kmf: 5000, stock: 7 });
  expect(result.diagnostic).toMatchObject({ status: 'canonical_applied', canonical_fields_applied: 3 });
});

test('consensus partiel conserve les champs ABSENT', async () => {
  const result = await run({ projectionFn: async () => projected({ product_name: consensus('Canonical'), description: absent, source_locale: absent }) });
  expect(result.row).toMatchObject({ name_source: 'Canonical', description_source: 'Legacy desc', source_locale: 'en' });
  expect(result.diagnostic).toMatchObject({ status: 'canonical_applied', canonical_fields_applied: 1, absent_fallbacks: 2 });
});

test('conflit conserve le champ legacy et les autres consensus', async () => {
  const result = await run({ projectionFn: async () => projected({ product_name: consensus('Canonical'), description: conflict, source_locale: absent }) });
  expect(result.row).toMatchObject({ name_source: 'Canonical', description_source: 'Legacy desc' });
  expect(result.diagnostic).toMatchObject({ status: 'legacy_conflict', conflict_fallbacks: 1 });
});

test.each([
  [async () => [], undefined, 'legacy_no_link'],
  [async () => ['a', 'b'], undefined, 'legacy_ambiguity'],
  [async () => ['canon-1'], async () => null, 'legacy_no_projection'],
])('fallback de linkage/projection: %s', async (linkageFn, projectionFn, status) => {
  const result = await run({ linkageFn, ...(projectionFn ? { projectionFn } : {}) });
  expect(result.row).toBe(legacy);
  expect(result.diagnostic.status).toBe(status);
});

test('exception sourcing devient legacy_read_error', async () => {
  const result = await run({ linkageFn: async () => { throw new Error('db'); } });
  expect(result.row).toBe(legacy);
  expect(result.diagnostic.status).toBe('legacy_read_error');
});

test('seam unsafe ou contrat public différent sert legacy strict', async () => {
  const result = await run({ seamFn: () => ({ status: 'SAFE', hybrid_row: { ...legacy, price_kmf: 999 }, summary: { public_contract_equal: false } }) });
  expect(result.row).toBe(legacy);
  expect(result.diagnostic.status).toBe('legacy_unsafe');
});
