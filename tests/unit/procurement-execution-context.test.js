'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  parseDestination,
  buildProcurementExecutionContext,
} = require('../../services/procurement-execution-context');

test('construit un contexte provider-neutral stable depuis la vraie PO', () => {
  const env = {
    KOMERCE_PROCUREMENT_HUB_REF: 'DXB',
    KOMERCE_PROCUREMENT_HUB_DESTINATION_JSON: JSON.stringify({
      postal_code: '00000',
      country_code: 'ae',
      country: 'United Arab Emirates',
      province: 'Dubai',
      city: 'Dubai',
      customer_name: 'Komerce Hub',
      address1: 'Hub address',
      phone: '+971000000000',
    }),
  };

  const out = buildProcurementExecutionContext({
    purchaseOrderId: '00000000-0000-0000-0000-000000000201',
    purchaseLineId: 'line-1',
    item: { id: 'item-1' },
    supplierTagRequest: { reference: 'KOM-IN-X' },
    env,
  });

  expect(out).toMatchObject({
    execution_key: '00000000-0000-0000-0000-000000000201',
    procurement_hub_ref: 'DXB',
    store_line_item_id: 'line-1',
    procurement_destination: {
      country_code: 'AE',
      city: 'Dubai',
      customer_name: 'Komerce Hub',
    },
    supplier_tag_request: { reference: 'KOM-IN-X' },
  });
});

test('destination absente reste null : aucun faux fallback d adresse', () => {
  const out = buildProcurementExecutionContext({
    purchaseOrderId: 'po-1',
    item: { id: 'item-1' },
    env: {},
  });
  expect(out.procurement_destination).toBeNull();
  expect(out.procurement_hub_ref).toBe('DXB');
  expect(out.store_line_item_id).toBe('item-1');
});

test('destination invalide bloque fail-closed', () => {
  expect(() => parseDestination({
    KOMERCE_PROCUREMENT_HUB_DESTINATION_JSON: '{bad',
  })).toThrow('PROCUREMENT_HUB_DESTINATION_JSON_INVALID');

  expect(() => parseDestination({
    KOMERCE_PROCUREMENT_HUB_DESTINATION_JSON: JSON.stringify({ country_code: '???' }),
  })).toThrow('PROCUREMENT_HUB_COUNTRY_CODE_INVALID');
});

test('purchase_order_id est obligatoire pour une clé d exécution stable', () => {
  expect(() => buildProcurementExecutionContext({ env: {} }))
    .toThrow('PURCHASE_ORDER_ID_REQUIRED');
});
