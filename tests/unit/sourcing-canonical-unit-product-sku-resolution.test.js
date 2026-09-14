'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { STATUS, resolveCanonicalUnitForProductSku } = require('../../services/sourcing-canonical-unit-product-sku-resolution');

function queryWith(unitIds) {
  return jest.fn()
    .mockResolvedValueOnce({ rows: [{ id: 'sku1', product_id: 'p1', supplier_sku: 'SKU', supplier_unit_ref: 'VID1', supplier_order_identity: { provider: 'cj', version: 1, payload: { pid: 'P', vid: 'VID1', variant_sku: 'SKU' } } }] })
    .mockResolvedValueOnce({ rows: unitIds.map((canonical_entity_id) => ({ canonical_entity_id })) });
}
const opts = (projection) => ({ productLinkageFn: async () => ['cp1'], projectionFn: async () => projection });

test.each([[[], STATUS.NO_UNIT], [['u1','u2'], STATUS.AMBIGUOUS_UNIT]])('cardinalité exacte %j', async (ids, status) => {
  expect((await resolveCanonicalUnitForProductSku('sku1', queryWith(ids), opts(null))).status).toBe(status);
});
test('CJ vid exact et SOI opaque sont résolus', async () => {
  const soi = { provider: 'cj', version: 1, payload: { pid: 'P', vid: 'VID1', variant_sku: 'SKU' } };
  const unit = { canonical_unit_id: 'u1', identity: { deterministic_refs: [{ kind: 'source_ref', value: 'VID1' }] }, current_state: { supplier_order_identity: soi, is_active: true } };
  const out = await resolveCanonicalUnitForProductSku('sku1', queryWith(['u1']), opts(unit));
  expect(out).toMatchObject({ status: 'RESOLVED', supplier_unit_ref: 'VID1', supplier_order_identity: soi });
});
test('SOI absente et Unit supprimée bloquent explicitement', async () => {
  const base = { canonical_unit_id: 'u1', identity: { deterministic_refs: [{ kind: 'source_ref', value: 'VID1' }] } };
  expect((await resolveCanonicalUnitForProductSku('sku1', queryWith(['u1']), opts({ ...base, current_state: {} }))).status).toBe('NO_SUPPLIER_IDENTITY');
  expect((await resolveCanonicalUnitForProductSku('sku1', queryWith(['u1']), opts({ ...base, current_state: { supplier_order_identity: {}, availability: 'removed' } }))).status).toBe('INACTIVE_UNIT');
});
