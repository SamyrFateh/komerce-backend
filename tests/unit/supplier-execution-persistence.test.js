'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { persistSupplierOrderExecution } = require('../../services/supplier-execution-persistence');

function clientWith(rowsByCall) {
  const query = jest.fn();
  rowsByCall.forEach((rows) => query.mockResolvedValueOnce({ rows }));
  return { query };
}

test('persiste un nouvel ordre provider, son lien de ligne et un événement observé', async () => {
  const client = clientWith([
    [{ id: 'exec-1', purchase_order_id: 'po-1', provider: 'cj', supplier_order_id: 'CJ-1' }],
    [],
    [],
  ]);

  await expect(persistSupplierOrderExecution(client, {
    purchaseOrderId: 'po-1',
    purchaseLineId: 'line-1',
    quantity: 2,
    provider: 'CJ',
    supplierOrderId: 'CJ-1',
    supplierOrderCode: 'SD-1',
    providerStatus: 'CREATED',
    executionRecovery: 'CREATED_NOW',
  })).resolves.toMatchObject({ id: 'exec-1' });

  expect(client.query).toHaveBeenCalledTimes(3);
  expect(client.query.mock.calls[0][1]).toEqual([
    'po-1',
    'cj',
    'CJ-1',
    'SD-1',
    'CREATED',
    JSON.stringify({ execution_recovery: 'CREATED_NOW' }),
  ]);
  expect(client.query.mock.calls[1][1]).toEqual(['exec-1', 'line-1', 2]);
});

test('replay récupère le même ordre provider sans rebind vers une autre PO', async () => {
  const client = clientWith([
    [],
    [{ id: 'exec-1', purchase_order_id: 'po-1', provider: 'cj', supplier_order_id: 'CJ-1' }],
    [],
  ]);

  await expect(persistSupplierOrderExecution(client, {
    purchaseOrderId: 'po-1',
    provider: 'cj',
    supplierOrderId: 'CJ-1',
  })).resolves.toMatchObject({ id: 'exec-1' });

  expect(client.query).toHaveBeenCalledTimes(3);
});

test('refuse qu un identifiant provider existant soit rattaché à une autre PO', async () => {
  const client = clientWith([
    [],
    [{ id: 'exec-1', purchase_order_id: 'po-other', provider: 'cj', supplier_order_id: 'CJ-1' }],
  ]);

  await expect(persistSupplierOrderExecution(client, {
    purchaseOrderId: 'po-1',
    provider: 'cj',
    supplierOrderId: 'CJ-1',
  })).rejects.toThrow('SUPPLIER_EXECUTION_ORDER_REBIND_REFUSED');

  expect(client.query).toHaveBeenCalledTimes(2);
});

test('refuse une ligne sans quantité positive', async () => {
  const client = clientWith([
    [{ id: 'exec-1', purchase_order_id: 'po-1', provider: 'cj', supplier_order_id: 'CJ-1' }],
  ]);

  await expect(persistSupplierOrderExecution(client, {
    purchaseOrderId: 'po-1',
    purchaseLineId: 'line-1',
    quantity: 0,
    provider: 'cj',
    supplierOrderId: 'CJ-1',
  })).rejects.toThrow('SUPPLIER_EXECUTION_QUANTITY_INVALID');
});


test('un second provider utilise exactement le même contrat canonique sans branche dédiée', async () => {
  const client = clientWith([
    [{ id: 'exec-foo', purchase_order_id: 'po-foo', provider: 'foosupply', supplier_order_id: 'PURCHASE-77' }],
    [],
    [],
  ]);

  const out = await persistSupplierOrderExecution(client, {
    purchaseOrderId: 'po-foo',
    purchaseLineId: 'line-foo',
    quantity: 3,
    provider: 'FooSupply',
    supplierOrderId: 'PURCHASE-77',
    supplierOrderCode: 'VISIBLE-77',
    providerStatus: 'ACCEPTED',
  });

  expect(out).toMatchObject({
    id: 'exec-foo',
    provider: 'foosupply',
    supplier_order_id: 'PURCHASE-77',
  });
  expect(client.query.mock.calls[0][1].slice(0, 5)).toEqual([
    'po-foo', 'foosupply', 'PURCHASE-77', 'VISIBLE-77', 'ACCEPTED',
  ]);
});

test('le service canonique ne contient aucun champ natif CJ', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'services', 'supplier-execution-persistence.js'),
    'utf8'
  );
  expect(src).not.toMatch(/shipmentOrderId|cjOrderCode|payId|CJ_/);
});
