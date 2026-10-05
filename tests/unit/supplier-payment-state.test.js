'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  prepareSupplierPayment,
  markPaymentRequested,
  markPaymentAmbiguous,
  markPaymentSucceeded,
  markPaymentRejected,
  canInvokeProviderPayment,
} = require('../../services/supplier-payment-state');

function client(script = []) {
  const q = jest.fn();
  script.forEach(rows => q.mockResolvedValueOnce({ rows }));
  return { query: q };
}

test('prepare crée un fait stable et un replay identique le réutilise', async () => {
  const c = client([
    [],
    [{ id:'pay-1', purchase_order_id:'po-1', provider:'cj', payment_execution_key:'PEK-1',
       supplier_execution_order_id:null, supplier_execution_group_id:'grp-1',
       expected_amount:'62.0700', currency:'USD', status:'prepared' }],
    [{ id:'pay-1', purchase_order_id:'po-1', provider:'cj', payment_execution_key:'PEK-1',
       supplier_execution_order_id:null, supplier_execution_group_id:'grp-1',
       expected_amount:'62.0700', currency:'USD', status:'prepared' }],
  ]);

  const first = await prepareSupplierPayment(c, {
    purchaseOrderId:'po-1', provider:'CJ', paymentExecutionKey:'PEK-1',
    supplierExecutionGroupId:'grp-1', expectedAmount:62.07, currency:'usd',
  });
  expect(first.id).toBe('pay-1');

  const second = await prepareSupplierPayment(c, {
    purchaseOrderId:'po-1', provider:'cj', paymentExecutionKey:'PEK-1',
    supplierExecutionGroupId:'grp-1', expectedAmount:62.07, currency:'USD',
  });
  expect(second.id).toBe('pay-1');
});

test('prepare refuse un rebind de la meme clé vers une autre histoire économique', async () => {
  const c = client([[
    { id:'pay-1', purchase_order_id:'po-1', provider:'cj', payment_execution_key:'PEK-1',
      supplier_execution_order_id:null, supplier_execution_group_id:'grp-1',
      expected_amount:'62.0700', currency:'USD', status:'prepared' }
  ]]);

  await expect(prepareSupplierPayment(c, {
    purchaseOrderId:'po-2', provider:'cj', paymentExecutionKey:'PEK-1',
    supplierExecutionGroupId:'grp-1', expectedAmount:62.07, currency:'USD',
  })).rejects.toThrow('SUPPLIER_PAYMENT_EXECUTION_REBIND_REFUSED');
});

test('ambiguous bloque explicitement tout second appel provider', async () => {
  const c = client([
    [{ id:'pay-1', purchase_order_id:'po-1', provider:'cj', payment_execution_key:'PEK-1',
       supplier_execution_order_id:null, supplier_execution_group_id:'grp-1',
       expected_amount:'62.0700', currency:'USD', status:'ambiguous' }],
  ]);

  await expect(canInvokeProviderPayment(c, {
    provider:'cj', paymentExecutionKey:'PEK-1',
  })).resolves.toMatchObject({
    allowed:false,
    reason:'PAYMENT_AMBIGUOUS_RECONCILIATION_REQUIRED',
  });
});

test('succeeded bloque tout nouveau paiement provider', async () => {
  const c = client([[
    { id:'pay-1', purchase_order_id:'po-1', provider:'cj', payment_execution_key:'PEK-1',
      supplier_execution_order_id:null, supplier_execution_group_id:'grp-1',
      expected_amount:'62.0700', currency:'USD', status:'succeeded' }
  ]]);

  await expect(canInvokeProviderPayment(c, {
    provider:'cj', paymentExecutionKey:'PEK-1',
  })).resolves.toMatchObject({
    allowed:false,
    reason:'PAYMENT_ALREADY_SUCCEEDED',
  });
});

test('transition requested -> ambiguous journalise sans prétendre à un débit réel', async () => {
  const c = client([
    [{ id:'pay-1', purchase_order_id:'po-1', provider:'cj', payment_execution_key:'PEK-1',
       supplier_execution_order_id:null, supplier_execution_group_id:'grp-1',
       expected_amount:'62.0700', currency:'USD', status:'requested',
       reconciliation_status:'pending' }],
    [{ id:'pay-1', status:'ambiguous', reconciliation_status:'unverified', real_debit_verified:false }],
    [],
  ]);

  const out = await markPaymentAmbiguous(c, {
    provider:'cj', paymentExecutionKey:'PEK-1',
  });

  expect(out).toMatchObject({
    status:'ambiguous',
    reconciliation_status:'unverified',
    real_debit_verified:false,
  });
  expect(c.query.mock.calls[2][1][4]).toBe('ambiguous');
});

test('requested -> succeeded accepte un montant observé et le verdict matched', async () => {
  const c = client([
    [{ id:'pay-1', purchase_order_id:'po-1', provider:'cj', payment_execution_key:'PEK-1',
       supplier_execution_order_id:null, supplier_execution_group_id:'grp-1',
       expected_amount:'62.0700', currency:'USD', status:'requested',
       reconciliation_status:'pending' }],
    [{ id:'pay-1', status:'succeeded', observed_amount:'62.0700',
       reconciliation_status:'matched', real_debit_verified:false }],
    [],
  ]);

  const out = await markPaymentSucceeded(c, {
    provider:'cj', paymentExecutionKey:'PEK-1',
    observedAmount:62.07,
    reconciliationStatus:'matched',
    paymentRef:'PAY-1',
    realDebitVerified:false,
  });

  expect(out).toMatchObject({
    status:'succeeded',
    reconciliation_status:'matched',
    real_debit_verified:false,
  });
});

test('les transitions interdites échouent avant toute mutation', async () => {
  const c = client([[
    { id:'pay-1', purchase_order_id:'po-1', provider:'cj', payment_execution_key:'PEK-1',
      status:'ambiguous', reconciliation_status:'unverified' }
  ]]);

  await expect(markPaymentRequested(c, {
    provider:'cj', paymentExecutionKey:'PEK-1',
  })).rejects.toThrow('SUPPLIER_PAYMENT_TRANSITION_REFUSED:ambiguous->requested');

  expect(c.query).toHaveBeenCalledTimes(1);
});
