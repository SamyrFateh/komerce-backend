'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db');
const { STATUS, proveExactCanonicalUnitForStockDelta } =
  require('../../services/sourcing-catalog-change-unit-resolution-proof');

const OBS_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE = 'api:cj';
const base = () => ({
  observation_id: OBS_ID, grain: 'unit', source_ref: 'u-1', parent_observation_id: null,
  source_id: SOURCE, source_status: 'active', existing_binding: null,
  stats: { change_kind: 'UNIT_STOCK_DELTA', application_status: 'NOT_EVALUATED', event_id: 'e-1' },
  normalized: {
    observation_kind: 'CATALOG_CHANGE_DELTA', product_ref: 'p-1',
    unit_ref: 'u-1', stock_available: 0,
  },
  raw_fragment: { source_ref: 'p-1', product_ref: 'p-1',
    unit_ref: 'u-1', fact: { status: 'OBSERVED', value: 0 } },
  field_provenance: { stock_available: {
    status: 'OBSERVED', event_id: 'e-1', provider: 'cj',
  } },
});
function proofQuery(row = base(), matches = [{canonical_unit_id:'unit-1',canonical_product_id:'product-1'}]) {
  return jest.fn(async (sql, params) => {
    if (String(sql).includes('LEFT JOIN sourcing_resolution_bindings')) {
      expect(params).toEqual([OBS_ID]);
      return { rows: row ? [row] : [] };
    }
    expect(params).toEqual([SOURCE,'p-1','u-1']);
    expect(sql).toContain("product_ref.ref_kind = 'product.source_ref'");
    expect(sql).toContain("unit_ref.ref_kind = 'unit.source_ref'");
    expect(sql).toContain('prior.source_ref = $2');
    expect(sql).toContain('prior.source_ref = $3');
    expect(sql).toContain('rb.ended_at IS NULL');
    return { rows: matches };
  });
}

test('exact source/product/unit chain proves identity but cannot apply stock or resolve a SKU', async () => {
  const query = proofQuery();
  const out = await proveExactCanonicalUnitForStockDelta(OBS_ID, query);
  expect(out).toMatchObject({
    status: STATUS.EXACT_CANONICAL_UNIT, source_id: SOURCE,
    canonical_unit_id: 'unit-1', canonical_product_id: 'product-1',
    stock_available_observed: 0, applicable: false, freshness_evaluated: false,
    sku_resolution_evaluated: false, authority: 'read_only_identity_evidence',
    application_status: 'NOT_EVALUATED',
  });
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql))).toBe(true);
});

test('invalid input and missing observation fail closed', async () => {
  const query = proofQuery();
  expect((await proveExactCanonicalUnitForStockDelta('not-uuid', query)).status)
    .toBe(STATUS.INVALID_OBSERVATION_ID);
  expect(query).not.toHaveBeenCalled();
  expect((await proveExactCanonicalUnitForStockDelta(OBS_ID, proofQuery(null))).status)
    .toBe(STATUS.NO_OBSERVATION);
});

test.each([
  ['inactive source', { source_status: 'disabled' }, STATUS.SOURCE_UNAVAILABLE],
  ['already bound delta', { existing_binding: 'some-id' }, STATUS.ALREADY_BOUND],
  ['different source ref from product', { raw_fragment: {
    source_ref: 'other-product', product_ref: 'p-1', unit_ref: 'u-1',
    fact: { status: 'OBSERVED', value: 0 },
  } }, STATUS.NOT_EXACT_STOCK_DELTA],
  ['mismatched observed stock', { raw_fragment: {
    source_ref: 'p-1', product_ref: 'p-1', unit_ref: 'u-1',
    fact: { status: 'OBSERVED', value: 5 },
  } }, STATUS.NOT_EXACT_STOCK_DELTA],
  ['unknown stock cannot be applied', { normalized: {
    observation_kind: 'CATALOG_CHANGE_DELTA', product_ref: 'p-1',unit_ref: 'u-1',
  }, field_provenance: { stock_available: {status:'UNKNOWN',event_id:'e-1',provider:'cj'} },
  raw_fragment: {source_ref:'p-1',product_ref:'p-1',unit_ref:'u-1',
    fact:{status:'UNKNOWN',reason:'no fact'} } }, STATUS.NOT_EXACT_STOCK_DELTA],
  ['forged provider', { field_provenance: {
    stock_available: {status:'OBSERVED',event_id:'e-1',provider:'allegro'} } },
    STATUS.NOT_EXACT_STOCK_DELTA],
  ['not a catalog delta', { stats: {change_kind:'OTHER',event_id:'e-1',application_status:'NOT_EVALUATED'} },
    STATUS.NOT_EXACT_STOCK_DELTA],
])('%s blocks before canonical resolution query', async (_title, override, expected) => {
  const query = proofQuery({ ...base(), ...override });
  const out = await proveExactCanonicalUnitForStockDelta(OBS_ID, query);
  expect(out.status).toBe(expected);
  expect(out.applicable).toBe(false);
  expect(query).toHaveBeenCalledTimes(1);
});

test('no active exact source-scoped chain remains not proved', async () => {
  const out = await proveExactCanonicalUnitForStockDelta(OBS_ID, proofQuery(base(), []));
  expect(out).toMatchObject({status: STATUS.NO_EXACT_UNIT,applicable:false});
});

test('more than one canonical-unit chain fails closed without arbitrarily selecting one', async () => {
  const out = await proveExactCanonicalUnitForStockDelta(OBS_ID, proofQuery(base(), [
    {canonical_unit_id:'unit-1',canonical_product_id:'product-1'},
    {canonical_unit_id:'unit-2',canonical_product_id:'product-1'},
  ]));
  expect(out).toMatchObject({status: STATUS.AMBIGUOUS_UNIT,applicable:false});
});
