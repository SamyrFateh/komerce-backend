'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { persistSupplierPaymentProof } = require('../../services/supplier-payment-proof-persistence');

function client(script=[]) {
  const q=jest.fn();
  script.forEach(rows=>q.mockResolvedValueOnce({rows}));
  return {query:q};
}

test('persiste une preuve réelle et promeut le paiement exact', async () => {
  const c=client([
    [{id:'proof-1',supplier_payment_id:'pay-1'}],
    [{id:'pay-1'}],
    [],
  ]);
  const out=await persistSupplierPaymentProof(c,{
    supplierPaymentId:'pay-1',
    provider:'CJ',
    proofSource:'cj_wallet_billing_history',
    proofRef:'BILL-1',
    providerOrderId:'CJ-ORDER-1',
    paymentRef:'PAY-1',
    observedAmount:62.07,
    currency:'usd',
    debitConfirmed:true,
    sandbox:false,
    simulated:false,
    providerFacts:{payment_type:'Balance',status:'Success'},
  });
  expect(out.id).toBe('proof-1');
  expect(c.query).toHaveBeenCalledTimes(3);
});

test('replay de la même preuve sur le même paiement est idempotent', async () => {
  const c=client([
    [],
    [{id:'proof-1',supplier_payment_id:'pay-1'}],
    [{id:'pay-1'}],
    [],
  ]);
  await expect(persistSupplierPaymentProof(c,{
    supplierPaymentId:'pay-1',
    provider:'cj',
    proofSource:'cj_wallet_billing_history',
    proofRef:'BILL-1',
    observedAmount:62.07,
    currency:'USD',
    debitConfirmed:true,
  })).resolves.toMatchObject({id:'proof-1'});
});

test('rebind de preuve vers un autre paiement est refusé', async () => {
  const c=client([
    [],
    [{id:'proof-1',supplier_payment_id:'pay-other'}],
  ]);
  await expect(persistSupplierPaymentProof(c,{
    supplierPaymentId:'pay-1',
    provider:'cj',
    proofSource:'cj_wallet_billing_history',
    proofRef:'BILL-1',
    observedAmount:62.07,
    currency:'USD',
    debitConfirmed:true,
  })).rejects.toThrow('SUPPLIER_PAYMENT_PROOF_REBIND_REFUSED');
});

test('promotion réelle refuse tout paiement local qui ne matche pas', async () => {
  const c=client([
    [{id:'proof-1',supplier_payment_id:'pay-1'}],
    [],
  ]);
  await expect(persistSupplierPaymentProof(c,{
    supplierPaymentId:'pay-1',
    provider:'cj',
    proofSource:'cj_wallet_billing_history',
    proofRef:'BILL-1',
    observedAmount:62.07,
    currency:'USD',
    debitConfirmed:true,
    sandbox:false,
    simulated:false,
  })).rejects.toThrow('SUPPLIER_PAYMENT_PROOF_PROMOTION_REFUSED');
});

test('preuve sandbox est conservable mais ne promeut jamais real_debit_verified', async () => {
  const c=client([
    [{id:'proof-sbx',supplier_payment_id:'pay-1'}],
  ]);
  await persistSupplierPaymentProof(c,{
    supplierPaymentId:'pay-1',
    provider:'cj',
    proofSource:'sandbox',
    proofRef:'SBX-1',
    observedAmount:62.07,
    currency:'USD',
    debitConfirmed:true,
    sandbox:true,
    simulated:false,
  });
  expect(c.query).toHaveBeenCalledTimes(1);
});
