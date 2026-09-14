'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { STATUS, resolveCanonicalUnitForProductSku } = require('../../services/sourcing-canonical-unit-product-sku-resolution');

function queryWith(unitIds, identity = { provider: 'cj', version: 1, payload: { pid: 'P', vid: 'VID1', variant_sku: 'SKU' } }) {
  return jest.fn()
    .mockResolvedValueOnce({ rows: [{ id: 'sku1', product_id: 'p1', supplier_sku: 'SKU', supplier_unit_ref: 'VID1', supplier_order_identity: identity }] })
    .mockResolvedValueOnce({ rows: unitIds.map((canonical_entity_id) => ({ canonical_entity_id })) });
}
const opts = (projection, productLinkageFn = async () => ['cp1']) => ({ productLinkageFn, projectionFn: async () => projection });

const cjUnit = (state = {}) => ({
  canonical_unit_id: 'u1',
  identity: { deterministic_refs: [{ namespace: 'api:cj', kind: 'unit.source_ref', value: 'VID1' }] },
  provenance: [{ source_id: 'api:cj', adapter_type: 'cj' }],
  current_state: {
    supplier_order_identity: { provider: 'cj', version: 1, payload: { pid: 'P', vid: 'VID1', variant_sku: 'SKU' } },
    is_active: true,
    ...state,
  },
});

test.each([[[], STATUS.NO_UNIT], [['u1','u2'], STATUS.AMBIGUOUS_UNIT]])('cardinalité Unit exacte %j', async (ids, status) => {
  expect((await resolveCanonicalUnitForProductSku('sku1', queryWith(ids), opts(null))).status).toBe(status);
});

test('plusieurs Canonical Products liés bloquent avant toute recherche Unit', async () => {
  const query = queryWith([]);
  const out = await resolveCanonicalUnitForProductSku('sku1', query, opts(null, async () => ['cp2', 'cp1']));
  expect(out).toMatchObject({ status: 'AMBIGUOUS_PRODUCT', canonical_product_ids: ['cp1', 'cp2'] });
  expect(query).toHaveBeenCalledTimes(1);
});

test('CJ unit.source_ref exact et SOI opaque sont résolus', async () => {
  const soi = { provider: 'cj', version: 1, payload: { pid: 'P', vid: 'VID1', variant_sku: 'SKU' } };
  const out = await resolveCanonicalUnitForProductSku('sku1', queryWith(['u1'], soi), opts(cjUnit({ supplier_order_identity: soi })));
  expect(out).toMatchObject({ status: 'RESOLVED', supplier_unit_ref: 'VID1', supplier_order_identity: soi });
});

test('une ref de même valeur dans un autre namespace provider ne prouve pas la Unit', async () => {
  const unit = {
    ...cjUnit(),
    identity: { deterministic_refs: [{ namespace: 'api:aliexpress', kind: 'unit.source_ref', value: 'VID1' }] },
    provenance: [{ source_id: 'api:aliexpress', adapter_type: 'aliexpress' }],
  };
  const out = await resolveCanonicalUnitForProductSku('sku1', queryWith(['u1']), opts(unit));
  expect(out).toMatchObject({ status: 'NO_SUPPLIER_IDENTITY', reason: 'UNIT_REF_NOT_PROVEN' });
});

test('SOI absente et Unit supprimée bloquent explicitement', async () => {
  const base = cjUnit();
  expect((await resolveCanonicalUnitForProductSku('sku1', queryWith(['u1']), opts({ ...base, current_state: {} }))).status).toBe('NO_SUPPLIER_IDENTITY');
  expect((await resolveCanonicalUnitForProductSku('sku1', queryWith(['u1']), opts({ ...base, current_state: { supplier_order_identity: {}, availability: 'removed' } }))).status).toBe('INACTIVE_UNIT');
});
