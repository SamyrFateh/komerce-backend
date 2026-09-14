'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { compareLegacyCanonicalUnit } = require('../../services/suppliers/canonical-unit-cutover-comparison');
const soi = { provider: 'cj', version: 1, payload: { pid: 'P', vid: 'V', variant_sku: 'S' } };
test.each([
  [{ supplier_unit_ref: 'V', supplier_order_identity: soi }, { status: 'RESOLVED', canonical_unit_id: 'u1', supplier_unit_ref: 'V', supplier_order_identity: soi }, 'PARITY', false],
  [{ supplier_unit_ref: 'V', supplier_order_identity: soi }, { status: 'AMBIGUOUS_UNIT' }, 'AMBIGUOUS', true],
  [{ supplier_unit_ref: 'X', supplier_order_identity: soi }, { status: 'RESOLVED', canonical_unit_id: 'u1', supplier_unit_ref: 'V', supplier_order_identity: { ...soi, payload: { vid: 'OTHER' } } }, 'MISMATCH', true],
])('%s', (legacy, canonical, status, blocks) => {
  expect(compareLegacyCanonicalUnit(legacy, canonical)).toMatchObject({ status, blocks_cutover: blocks });
});
