'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const proof=require('../../scripts/cj-billing-history-readonly-proof');

test('guard refuse production et exige sandbox explicite',()=>{
  expect(()=>proof.guard({
    KOMERCE_ENV:'production',
    KOMERCE_ALLOW_CJ_BILLING_HISTORY_READ:'1',
    KOMERCE_CJ_SANDBOX:'1',
  })).toThrow(/interdit en production/);

  expect(()=>proof.guard({
    KOMERCE_ENV:'staging',
    KOMERCE_ALLOW_CJ_BILLING_HISTORY_READ:'1',
  })).toThrow('KOMERCE_CJ_SANDBOX=1 requis');
});

test('sanitizeRow ne conserve que les faits nécessaires',()=>{
  expect(proof.sanitizeRow({
    id:'B1',
    cjOrderId:'CJ1',
    typeDesc:'Order Payment',
    paymentTypeDesc:'Balance',
    status:'1',
    copeMoney:'62.07',
    amount:'-$62.07',
    afterTransactionMoney:'100.01',
    createDate:'2026-10-05 08:00:00',
    secret:'should-not-leak',
  })).toEqual({
    id:'B1',
    cj_order_id:'CJ1',
    type_desc:'Order Payment',
    payment_type_desc:'Balance',
    status:'1',
    cope_money:62.07,
    amount:'-$62.07',
    after_transaction_money:100.01,
    create_date:'2026-10-05 08:00:00',
  });
});

test('run lit billingHistory sans mutation et reste real_debit_verified=false',async()=>{
  const invoke=jest.fn()
    .mockResolvedValueOnce({result:true,data:{list:[{
      id:'B1',
      cjOrderId:'O1',
      typeDesc:'Order Payment',
      paymentTypeDesc:'Balance',
      status:'1',
      copeMoney:62.07,
      amount:'-$62.07',
    }]}})
    .mockResolvedValueOnce({result:true,data:{list:[]}});

  const out=await proof.run({
    KOMERCE_ENV:'staging',
    KOMERCE_ALLOW_CJ_BILLING_HISTORY_READ:'1',
    KOMERCE_CJ_SANDBOX:'1',
    KOMERCE_CJ_BILLING_ORDER_IDS:'O1,O2',
    CJ_ACCESS_TOKEN:'token',
  },{invoke});

  expect(invoke).toHaveBeenCalledTimes(2);
  expect(out).toMatchObject({
    proof:'CJ_BILLING_HISTORY_READONLY_SANDBOX',
    sandbox:true,
    read_only:true,
    real_debit_verified:false,
    matching_row_count:1,
    order_ids:['O1','O2'],
  });
});
