'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { persistSupplierOrderExecution, recordSupplierCreateAmbiguity, hasBlockingSupplierCreateAmbiguity } = require('../../services/supplier-execution-persistence');

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


test('persiste une création ambiguë avec la décision de blocage de replay', async () => {
  const client = clientWith([[]]);
  await recordSupplierCreateAmbiguity(client, {
    purchaseOrderId: 'po-amb',
    provider: 'AliExpress',
    evidence: {
      provider_code: 'TIMEOUT',
      provider_message: 'response lost',
      error_name: 'TimeoutError',
    },
    replayBlocked: true,
  });

  const [sql, params] = client.query.mock.calls[0];
  expect(sql).toContain("'create_order','ambiguous'");
  expect(params.slice(0, 4)).toEqual(['po-amb', 'aliexpress', 'TIMEOUT', 'response lost']);
  expect(JSON.parse(params[4])).toEqual({
    replay_blocked: true,
    supports_idempotent_replay: false,
    error_name: 'TimeoutError',
  });
});

test('le dernier create ambigu bloquant interdit le replay, un succès ultérieur le libère', async () => {
  const blocked = clientWith([[{ outcome: 'ambiguous', facts: { replay_blocked: true } }]]);
  await expect(hasBlockingSupplierCreateAmbiguity(blocked, {
    purchaseOrderId: 'po-1',
    provider: 'aliexpress',
  })).resolves.toBe(true);

  const recovered = clientWith([[{ outcome: 'observed', facts: {} }]]);
  await expect(hasBlockingSupplierCreateAmbiguity(recovered, {
    purchaseOrderId: 'po-1',
    provider: 'aliexpress',
  })).resolves.toBe(false);
});

test('une ambiguïté explicitement rejouable ne crée pas de verrou', async () => {
  const client = clientWith([[{ outcome: 'ambiguous', facts: { replay_blocked: false } }]]);
  await expect(hasBlockingSupplierCreateAmbiguity(client, {
    purchaseOrderId: 'po-cj',
    provider: 'cj',
  })).resolves.toBe(false);
});
