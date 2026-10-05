'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../services/supplier-real-debit-verification', () => ({
  verifyRealDebitEvidence: jest.fn(),
}));
jest.mock('../../services/supplier-payment-proof-persistence', () => ({
  persistSupplierPaymentProof: jest.fn(),
}));

const verifier=require('../../services/supplier-real-debit-verification');
const persistence=require('../../services/supplier-payment-proof-persistence');
const { reconcileCjBillingHistory }=require('../../services/suppliers/cj-billing-history-reconciliation');

function client(script=[]){
  const q=jest.fn();
  script.forEach(rows=>q.mockResolvedValueOnce({rows}));
  return {query:q};
}

beforeEach(()=>jest.clearAllMocks());

const payment={
  id:'pay-1',
  provider:'cj',
  status:'succeeded',
  reconciliation_status:'matched',
  real_debit_verified:false,
  expected_amount:'62.0700',
  currency:'USD',
  payment_ref:'PAY-1',
  supplier_execution_group_id:'grp-1',
  supplier_execution_order_id:null,
};

test('already verified => no provider read and no persistence',async()=>{
  const c=client([[{...payment,real_debit_verified:true}]]);
  const fetchBillingHistory=jest.fn();

  await expect(reconcileCjBillingHistory(c,{
    supplierPaymentId:'pay-1',
    fetchBillingHistory,
  })).resolves.toMatchObject({
    verified:true,
    already_verified:true,
  });

  expect(fetchBillingHistory).not.toHaveBeenCalled();
  expect(persistence.persistSupplierPaymentProof).not.toHaveBeenCalled();
});

test('group parent lit chaque sous-ordre et persiste une preuve exacte',async()=>{
  const c=client([
    [payment],
    [{supplier_order_id:'CJ-1'},{supplier_order_id:'CJ-2'}],
  ]);
  const fetchBillingHistory=jest.fn(async({orderId})=>({
    result:true,
    data:{list:orderId==='CJ-1'?[{
      id:'BILL-1',
      cjOrderId:'CJ-1',
      typeDesc:'Order Payment',
      paymentTypeDesc:'Balance',
      status:'1',
      copeMoney:62.07,
      amount:'-$62.07',
      afterTransactionMoney:100,
      createDate:'2026-10-05 08:00:00',
    }]:[]},
  }));

  verifier.verifyRealDebitEvidence.mockReturnValue({
    verified:true,
    reasons:[],
    normalized:{
      provider:'cj',
      payment_ref:'PAY-1',
      observed_amount:62.07,
      currency:'USD',
      proof_source:'cj_wallet_billing_history',
      proof_ref:'BILL-1',
      debit_confirmed:true,
      sandbox:false,
      simulated:false,
    },
  });
  persistence.persistSupplierPaymentProof.mockResolvedValue({id:'proof-1'});

  const out=await reconcileCjBillingHistory(c,{
    supplierPaymentId:'pay-1',
    fetchBillingHistory,
  });

  expect(fetchBillingHistory).toHaveBeenCalledTimes(2);
  expect(persistence.persistSupplierPaymentProof).toHaveBeenCalledWith(c,expect.objectContaining({
    supplierPaymentId:'pay-1',
    provider:'cj',
    proofSource:'cj_wallet_billing_history',
    proofRef:'BILL-1',
    providerOrderId:'CJ-1',
    observedAmount:62.07,
    currency:'USD',
    debitConfirmed:true,
    sandbox:false,
    simulated:false,
  }));
  expect(out).toMatchObject({
    verified:true,
    already_verified:false,
    payment_id:'pay-1',
    proof:{id:'proof-1'},
  });
});

test('preuve billing absente ne promeut rien',async()=>{
  const c=client([
    [payment],
    [{supplier_order_id:'CJ-1'}],
  ]);
  const out=await reconcileCjBillingHistory(c,{
    supplierPaymentId:'pay-1',
    fetchBillingHistory:async()=>({result:true,data:{list:[]}}),
  });

  expect(out).toMatchObject({
    verified:false,
    reason:'CJ_BILLING_DEBIT_NOT_FOUND',
  });
  expect(verifier.verifyRealDebitEvidence).not.toHaveBeenCalled();
  expect(persistence.persistSupplierPaymentProof).not.toHaveBeenCalled();
});

test('preuve rejetée par le contrat réel ne persiste rien',async()=>{
  const c=client([
    [payment],
    [{supplier_order_id:'CJ-1'}],
  ]);
  verifier.verifyRealDebitEvidence.mockReturnValue({
    verified:false,
    reasons:['PAYMENT_REF_REQUIRED'],
    normalized:null,
  });

  const out=await reconcileCjBillingHistory(c,{
    supplierPaymentId:'pay-1',
    fetchBillingHistory:async()=>({
      result:true,
      data:{list:[{
        id:'BILL-1',
        cjOrderId:'CJ-1',
        typeDesc:'Order Payment',
        paymentTypeDesc:'Balance',
        status:'1',
        copeMoney:62.07,
        amount:'-$62.07',
      }]},
    }),
  });

  expect(out).toMatchObject({
    verified:false,
    reason:'CJ_BILLING_DEBIT_EVIDENCE_REJECTED',
  });
  expect(persistence.persistSupplierPaymentProof).not.toHaveBeenCalled();
});

test('paiement non succeeded+matched est refusé avant billingHistory',async()=>{
  const c=client([[{...payment,status:'ambiguous',reconciliation_status:'unverified'}],[]]);
  const fetchBillingHistory=jest.fn();

  await expect(reconcileCjBillingHistory(c,{
    supplierPaymentId:'pay-1',
    fetchBillingHistory,
  })).rejects.toThrow('CJ_BILLING_RECONCILIATION_PAYMENT_NOT_READY');

  expect(fetchBillingHistory).not.toHaveBeenCalled();
});
