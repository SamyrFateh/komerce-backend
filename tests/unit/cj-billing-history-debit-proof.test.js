'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const contract = require('../../services/suppliers/cj-purchasing-contract');

test('billingHistory mappe une écriture Order Payment Balance Success en preuve réelle', () => {
  const out = contract.parseBillingHistoryDebitEvidence({
    result:true,
    data:{
      list:[{
        id:'BILL-123',
        cjOrderId:'CJ-ORDER-1',
        typeDesc:'Order Payment',
        paymentTypeDesc:'Balance',
        status:'1',
        copeMoney:62.07,
        amount:'-$62.07',
        afterTransactionMoney:937.93,
        createDate:'2026-10-05 08:00:00',
      }],
    },
  }, {
    expectedOrderIds:['CJ-ORDER-1'],
    expectedAmount:62.07,
  });

  expect(out).toEqual({
    verified:true,
    reason:null,
    evidence:{
      provider:'cj',
      payment_ref:null,
      observed_amount:62.07,
      currency:'USD',
      proof_source:'cj_wallet_billing_history',
      proof_ref:'BILL-123',
      debit_confirmed:true,
      sandbox:false,
      simulated:false,
      provider_order_id:'CJ-ORDER-1',
      payment_type:'Balance',
      status:'Success',
      after_transaction_amount:937.93,
      occurred_at:'2026-10-05 08:00:00',
    },
  });
});

test('zéro correspondance reste non vérifiée', () => {
  const out = contract.parseBillingHistoryDebitEvidence({
    result:true,
    data:{list:[{
      id:'BILL-X',
      cjOrderId:'CJ-OTHER',
      typeDesc:'Order Payment',
      paymentTypeDesc:'Balance',
      status:'1',
      copeMoney:62.07,
      amount:'-$62.07',
    }]},
  }, {
    expectedOrderIds:['CJ-ORDER-1'],
    expectedAmount:62.07,
  });

  expect(out).toEqual({
    verified:false,
    reason:'CJ_BILLING_DEBIT_NOT_FOUND',
    evidence:null,
  });
});

test('plusieurs écritures correspondantes restent ambiguës', () => {
  const row = {
    cjOrderId:'CJ-ORDER-1',
    typeDesc:'Order Payment',
    paymentTypeDesc:'Balance',
    status:'1',
    copeMoney:62.07,
    amount:'-$62.07',
  };
  const out = contract.parseBillingHistoryDebitEvidence({
    result:true,
    data:{list:[{...row,id:'B1'},{...row,id:'B2'}]},
  }, {
    expectedOrderIds:['CJ-ORDER-1'],
    expectedAmount:62.07,
  });

  expect(out).toEqual({
    verified:false,
    reason:'CJ_BILLING_DEBIT_AMBIGUOUS',
    evidence:null,
  });
});

test('montant, moyen ou statut incorrect ne prouvent pas le débit', () => {
  const base = {
    id:'B1',
    cjOrderId:'CJ-ORDER-1',
    typeDesc:'Order Payment',
    paymentTypeDesc:'Balance',
    status:'1',
    copeMoney:62.07,
    amount:'-$62.07',
  };

  for (const row of [
    {...base, copeMoney:61.00},
    {...base, paymentTypeDesc:'Card'},
    {...base, status:'0'},
    {...base, amount:'$62.07'},
  ]) {
    const out = contract.parseBillingHistoryDebitEvidence({
      result:true,
      data:{list:[row]},
    }, {
      expectedOrderIds:['CJ-ORDER-1'],
      expectedAmount:62.07,
    });
    expect(out.verified).toBe(false);
  }
});
