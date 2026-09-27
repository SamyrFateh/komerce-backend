'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db');

const unitProof = require('../../services/sourcing-catalog-change-unit-resolution-proof');
const { STATUS, proveExactCatalogSkuForStockDelta } =
  require('../../services/sourcing-catalog-change-sku-identity-proof');

const OBS = '11111111-1111-4111-8111-111111111111';
const PRODUCT = '22222222-2222-4222-8222-222222222222';
const UNIT = '33333333-3333-4333-8333-333333333333';
const SKU = '44444444-4444-4444-8444-444444444444';
const canonical = () => ({
  status: unitProof.STATUS.EXACT_CANONICAL_UNIT, observation_id: OBS,
  source_id: 'api:cj', canonical_product_id: PRODUCT, canonical_unit_id: UNIT,
  stock_available_observed: 0, application_status: 'NOT_EVALUATED', applicable: false,
});
const match = (override = {}) => ({
  product_sku_id: SKU, product_id: '55555555-5555-4555-8555-555555555555',
  is_active: true, inventory_model: 'SKU', competing_source_count: 0, ...override,
});
function fixture(proof = canonical(), rows = [match()], subject = { product_ref: 'p-1', unit_ref: 'u-1' }) {
  const canonicalProofFn = jest.fn().mockResolvedValue(proof);
  const query = jest.fn(async (sql, args) => {
    if (String(sql).includes('FROM sourcing_observations o')) {
      expect(args).toEqual([OBS, 'api:cj']);
      return { rows: subject ? [subject] : [] };
    }
    expect(args).toEqual(['api:cj', 'p-1', 'u-1', PRODUCT, 'cj']);
    expect(sql).toContain('sc.import_id');
    expect(sql).toContain("c.source_id = $1");
    expect(sql).toContain("product_binding.canonical_entity_id = $4::uuid");
    expect(sql).toContain("sku.supplier_unit_ref = $3");
    expect(sql).toContain("other_c.source_id <> $1");
    expect(sql).toContain("lower(sku.supplier_order_identity->>'provider') = $5");
    return { rows };
  });
  return { query, canonicalProofFn };
}

test('one exact source-bound active SKU proves identity but never authorizes application', async () => {
  const { query, canonicalProofFn } = fixture();
  const out = await proveExactCatalogSkuForStockDelta(OBS, query, { canonicalProofFn });
  expect(out).toMatchObject({
    status: STATUS.EXACT_CATALOG_SKU_IDENTITY, observation_id: OBS,
    canonical_unit_id: UNIT, product_sku_id: SKU,
    stock_available_observed: 0, sku_identity_evaluated: true, applicable: false,
    application_status: 'NOT_EVALUATED', freshness_evaluated: false,
    reservations_evaluated: false, supplier_order_identity_consistency_evaluated: false,
  });
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql))).toBe(true);
  expect(canonicalProofFn).toHaveBeenCalledWith(OBS, query);
});

test('unproved canonical identity never queries a SKU or guesses from the supplier reference', async () => {
  const { query, canonicalProofFn } = fixture({ status: unitProof.STATUS.NO_EXACT_UNIT, observation_id: OBS });
  const out = await proveExactCatalogSkuForStockDelta(OBS, query, { canonicalProofFn });
  expect(out).toMatchObject({ status: STATUS.CANONICAL_UNIT_NOT_PROVEN, applicable: false });
  expect(query).not.toHaveBeenCalled();
});

test.each([
  ['missing SKU', [], STATUS.NO_EXACT_CATALOG_SKU],
  ['multiple exact SKU candidates', [match(),match({ product_sku_id: 'other' })], STATUS.AMBIGUOUS_CATALOG_SKU],
  ['same product imported by another source', [match({ competing_source_count: 1 })], STATUS.SOURCE_LINEAGE_AMBIGUOUS],
  ['disabled SKU', [match({ is_active: false })], STATUS.INACTIVE_CATALOG_SKU],
  ['legacy variant inventory', [match({ inventory_model: 'LEGACY_VARIANTS' })], STATUS.NOT_SKU_INVENTORY],
])('%s fails closed', async (_label, rows, status) => {
  const { query, canonicalProofFn } = fixture(canonical(), rows);
  const out = await proveExactCatalogSkuForStockDelta(OBS, query, { canonicalProofFn });
  expect(out).toMatchObject({ status, applicable: false, application_status: 'NOT_EVALUATED' });
  expect(out).not.toHaveProperty('product_sku_id');
});

test('delta without an intact product/unit subject cannot be matched to a SKU', async () => {
  const { query, canonicalProofFn } = fixture(canonical(), [match()], { product_ref: 'p-1' });
  const out = await proveExactCatalogSkuForStockDelta(OBS, query, { canonicalProofFn });
  expect(out.status).toBe(STATUS.CANONICAL_UNIT_NOT_PROVEN);
  expect(query).toHaveBeenCalledTimes(1);
});
