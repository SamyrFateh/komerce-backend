'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const {
  createInboundTag,
  parseInboundTag,
  generatePhysicalReference,
  buildSupplierTagRequest,
} = require('../../services/hub-reference');

const PO = '00000000-0000-0000-0000-000000000301';

test('KOM-IN is deterministic and round-trips to the exact Purchase Order', () => {
  const tag = createInboundTag(PO);
  expect(tag).toBe('KOM-IN-00000000000000000000000000000301');
  expect(parseInboundTag(tag)).toBe(PO);
});

test('invalid inbound tags are not guessed', () => {
  expect(parseInboundTag('TRACK-123')).toBeNull();
  expect(parseInboundTag('KOM-IN-NOT-A-UUID')).toBeNull();
});

test('supplier tag request is explicit and optional', () => {
  expect(buildSupplierTagRequest(PO)).toEqual(expect.objectContaining({
    reference: createInboundTag(PO),
    machine_payload: createInboundTag(PO),
    apply_to: 'EVERY_SUPPLIER_PACKAGE_FOR_PURCHASE_ORDER',
    optional: true,
  }));
});

test('physical references distinguish receipt, item/lot and outbound box', () => {
  expect(generatePhysicalReference('SUPPLIER_PACKAGE')).toMatch(/^KOM-RCV-[0-9A-F]{18}$/);
  expect(generatePhysicalReference('HANDLING_UNIT')).toMatch(/^KOM-ITEM-[0-9A-F]{18}$/);
  expect(generatePhysicalReference('MARKET_PARCEL')).toMatch(/^KOM-BOX-[0-9A-F]{18}$/);
});
