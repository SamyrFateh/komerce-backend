'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * F3 Stripe : PSP fake only; no real capture or refund request.
 */
const mockClaim = jest.fn();
const mockReserveInTx = jest.fn();
const mockReconcile = jest.fn();
jest.mock('../../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../../services/refund-intent-ledger', () => {
  const actual=jest.requireActual('../../services/refund-intent-ledger');
  return { ...actual,
    claimRefundIntent: (...a)=>mockClaim(...a),
    reserveRefundIntentInTransaction: (...a)=>mockReserveInTx(...a),
  };
});
jest.mock('../../services/refund-intent-reconciliation', () => ({
  reconcileRefundIntent: (...a)=>mockReconcile(...a),
}));
jest.mock('../../services/refund-service',()=>({recordExternalRefund:jest.fn()}));
jest.mock('../../services/payment-service',()=>({markRefunded:jest.fn()}));
jest.mock('../../services/order-status-machine',()=>({
  transitionOrderStatus:jest.fn(),appendOrderHistoryNote:jest.fn()
}));
jest.mock('../../services/documents/refund-receipt',()=>({issue:jest.fn()}));
jest.mock('../../utils/alerts',()=>({createAlert:jest.fn()}));
jest.mock('../../utils/logger',()=>{
  const fn=()=>({info:jest.fn(),warn:jest.fn(),error:jest.fn(),debug:jest.fn()});
  return {child:fn,forModule:fn};
});
const db=require('../../db');
const {claimRefundIntent}=require('../../services/refund-intent-ledger');
const {recordExternalRefund}=require('../../services/refund-service');
const {markRefunded}=require('../../services/payment-service');
const {appendOrderHistoryNote,transitionOrderStatus}=require('../../services/order-status-machine');
const {createAlert}=require('../../utils/alerts');
const receipt=require('../../services/documents/refund-receipt');
const {
  stripeSandboxAllowed,reserveStripeBusinessRefund,executeReservedStripeRefund,
  reconcileUncertainStripeRefund,
}=require('../../services/stripe-refund-authority');

const INTENT='11111111-2222-4333-8444-555555555555';
const ORDER='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ACTOR='11111111-aaaa-4bbb-8ccc-222222222222';
const ENV={KOMERCE_ENV:'staging',FINANCE_DURABLE_REFUNDS_ENABLED:'1',
  STRIPE_SECRET_KEY:'sk_test_fake_key_not_used'};
let tx=false,status='reserved',sum='25.00',amount='25.00';
let sql=[];
const stripe={refunds:{create:jest.fn(),retrieve:jest.fn()}};
const order={id:ORDER,market_id:'market-1',payment_status:'paid',payment_mode:'stripe_eur',
  stripe_payment_id:'pi_orig',total_eur:'100.00'};
function input(extra={}) {return {db,env:ENV,stripe,orderId:ORDER,intentId:INTENT,actorId:ACTOR,...extra};}
beforeEach(()=>{
  jest.clearAllMocks();tx=false;status='reserved';sum='25.00';amount='25.00';sql=[];
  db.query.mockImplementation(async (q)=>{
    sql.push(q);
    if(q.includes('SELECT id,order_id,provider,status,provider_ref FROM refund_execution_intents'))
      return {rows:[{id:INTENT,order_id:ORDER,provider:'stripe',status,provider_ref:null}]};
    if(q.includes("UPDATE refund_execution_intents SET status='unknown'")) {
      status='unknown';return {rows:[{id:INTENT}],rowCount:1};
    }
    throw new Error('Unexpected pool query '+q);
  });
  db.connect.mockImplementation(async()=>({
    query:jest.fn(async q=>{
      sql.push(q);
      if(q==='BEGIN'){tx=true;return {rows:[]};}
      if(q==='COMMIT'||q==='ROLLBACK'){tx=false;return {rows:[]};}
      if(q.includes('FROM orders o JOIN refund_execution_intents i')){
        return {rows:[{order_id:ORDER,order_status:'cancelled',payment_status:'paid',
          total_kmf:50000,total_eur:'100.00',stripe_payment_id:'pi_orig',
          provider:'stripe',intent_status:'confirmed',provider_ref:'re_ok',
          capture_ref:'pi_orig',amount_eur:amount,operation_key:'cancel:order:'+ORDER}]};
      }
      if(q.includes('FROM refunds WHERE order_id=$1 AND refund_type=$2')) return {rows:[]};
      if(q.includes('AS eur FROM refunds')) return {rows:[{eur:sum}]};
      throw new Error('Unexpected settlement SQL '+q);
    }),
    release:jest.fn(),
  }));
  mockClaim.mockResolvedValue({id:INTENT,providerRequestKey:'kmr-ref-'+INTENT,
    capture_ref:'pi_orig',amount_eur:'25.00'});
  mockReserveInTx.mockResolvedValue({intentId:INTENT,status:'reserved'});
  mockReconcile.mockResolvedValue({status:'confirmed',complete:true});
  stripe.refunds.create.mockImplementation(async ()=>{
    if(tx) throw new Error('PSP called during transaction');
    return {id:'re_ok',status:'succeeded'};
  });
  recordExternalRefund.mockResolvedValue('refund-row-1');
  appendOrderHistoryNote.mockResolvedValue(undefined);
  markRefunded.mockResolvedValue({changed:true});
  transitionOrderStatus.mockResolvedValue({success:true});
  receipt.issue.mockResolvedValue(undefined);
  createAlert.mockResolvedValue(undefined);
});
test('sandbox gate is closed in production, no PSP call',async()=>{
  expect(stripeSandboxAllowed({...ENV,KOMERCE_ENV:'production'})).toBe(false);
  const result=await executeReservedStripeRefund(input({
    env:{...ENV,KOMERCE_ENV:'production'}
  }));
  expect(result.status).toBe(202);
  expect(result.body.requires_activation).toBe(true);
  expect(stripe.refunds.create).not.toHaveBeenCalled();
  expect(mockClaim).not.toHaveBeenCalled();
});
test('reservation validates capture and amount before committing',async()=>{
  const client={query:jest.fn()};
  await reserveStripeBusinessRefund(client,{
    order,amountEur:'25.00',operationKey:'cancel:order:'+ORDER,initiatedBy:ACTOR
  });
  expect(mockReserveInTx).toHaveBeenCalledWith(client,expect.objectContaining({
    orderId:ORDER,provider:'stripe',captureRef:'pi_orig',amountEur:'25.00'
  }));
  await expect(reserveStripeBusinessRefund(client,{
    order:{...order,stripe_payment_id:null},amountEur:'25.00',
    operationKey:'cancel:order:'+ORDER,initiatedBy:ACTOR
  })).rejects.toMatchObject({code:'REFUND_STRIPE_CAPTURE_MISSING'});
});
test('timeout persists unknown, new invocation never reposts',async()=>{
  stripe.refunds.create.mockRejectedValueOnce(new Error('timeout after PSP accepted'));
  const first=await executeReservedStripeRefund(input());
  expect(first.status).toBe(202);
  expect(first.body.refund_status).toBe('unknown');
  expect(sql.some(q=>q.includes("status='unknown'"))).toBe(true);
  expect(mockClaim).toHaveBeenCalledTimes(1);
  const second=await executeReservedStripeRefund(input());
  expect(second.status).toBe(202);
  expect(second.body.refund_status).toBe('unknown');
  expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  expect(createAlert).toHaveBeenCalledWith(db,expect.objectContaining({
    severity:'high',type:'refund_provider_reconciliation_required',
  }));
});
test('verified partial: one journal, no refunded status, receipt after commit',async()=>{
  const result=await executeReservedStripeRefund(input());
  expect(result).toMatchObject({status:200,body:{refund_status:'confirmed',partial:true}});
  expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  expect(stripe.refunds.create).toHaveBeenCalledWith(expect.objectContaining({
    payment_intent:'pi_orig',amount:2500,
  }),expect.objectContaining({idempotencyKey:'kmr-ref-'+INTENT}));
  expect(mockClaim.mock.invocationCallOrder[0])
    .toBeLessThan(stripe.refunds.create.mock.invocationCallOrder[0]);
  expect(mockReconcile).toHaveBeenCalledWith(expect.objectContaining({
    intentId:INTENT,providerRefundId:'re_ok',stripe,db
  }));
  expect(recordExternalRefund).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({
    orderId:ORDER,amountEur:25,amountKmf:12500,method:'stripe',
    refundType:'stripe_intent:'+INTENT,
  }));
  expect(markRefunded).not.toHaveBeenCalled();
  expect(transitionOrderStatus).not.toHaveBeenCalled();
  expect(appendOrderHistoryNote).toHaveBeenCalledTimes(1);
  expect(sql).toContain('COMMIT');
  expect(receipt.issue).toHaveBeenCalledWith('refund-row-1',{issuedBy:ACTOR});
});
test('verified complete: payment and order refunded in same short SQL transaction',async()=>{
  sum='100.00';amount='100.00';
  mockClaim.mockResolvedValueOnce({id:INTENT,providerRequestKey:'kmr-ref-'+INTENT,
    capture_ref:'pi_orig',amount_eur:'100.00'});
  const result=await executeReservedStripeRefund(input());
  expect(result).toMatchObject({status:200,body:{partial:false}});
  expect(markRefunded).toHaveBeenCalledTimes(1);
  expect(transitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({
    orderId:ORDER,newStatus:'refunded',source:'refund_external'
  }));
});
test('reconciliation is admin-only and GET-only, no duplicate Stripe POST',async()=>{
  status='unknown';
  await expect(reconcileUncertainStripeRefund({
    ...input(),actor:{id:ACTOR,role:'client'},providerRefundId:'re_ok'
  })).rejects.toMatchObject({code:'REFUND_STRIPE_ADMIN_REQUIRED'});
  const result=await reconcileUncertainStripeRefund({
    ...input(),actor:{id:ACTOR,role:'admin'},providerRefundId:'re_ok'
  });
  expect(result.status).toBe(200);
  expect(mockReconcile).toHaveBeenCalledTimes(1);
  expect(stripe.refunds.create).not.toHaveBeenCalled();
});
