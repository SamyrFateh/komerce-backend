'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../utils/logger',()=>({child:()=>({info:jest.fn(),warn:jest.fn(),error:jest.fn()})}));
jest.mock('../../services/product-admin-service',()=>({adjustStock:jest.fn()}));
jest.mock('../../services/local-stock-service',()=>({
  consumeAllocationsForOrder:jest.fn(),releaseAllocationsForOrder:jest.fn()
}));
jest.mock('../../services/client-notification-service',()=>({
  emitOrderMilestone:jest.fn(),resolveOrderMilestones:jest.fn()
}));
jest.mock('../../services/order-physical-coverage-service',()=>({
  getOrderPhysicalCoverage:jest.fn().mockResolvedValue({covered:true,uncovered:[]})
}));
jest.mock('../../services/customs-shipment-service',()=>({
  isCustomsDeclaredForOrder:jest.fn().mockResolvedValue({allowed:true}),
  confirmCustomsShipmentsForOrder:jest.fn().mockResolvedValue(undefined)
}));
const {transitionOrderStatus}=require('../../services/order-status-machine');
const RELAY='00000000-0000-0000-0000-000000000022';
const ORDER='00000000-0000-0000-0000-000000000011';
const actor={id:'00000000-0000-0000-0000-000000000033',role:'agent_relais',relais_id:RELAY};
const SCAN='00000000-0000-0000-0000-000000000066';

function context({status='confirmed',paid='paid',proof=true,total=1,local=1}={}) {
  const query=jest.fn(async(sql)=>{
    if (/SELECT o.id, o.status/.test(sql))return {rows:[{
      id:ORDER,status,payment_status:paid,payment_mode:'cash_relais',
      relais_id:RELAY,pickup_secret_hash:'existing-secret-hash',user_id:'user',reference:'R',relais_name:'Relais'
    }]};
    if (/SELECT id FROM scans/.test(sql))return {rows:proof?[{id:SCAN}]:[]};
    if (/COUNT\(\*\)::int AS total/.test(sql))return {rows:[{total,local}]};
    return {rows:[],rowCount:1};
  });
  return {query};
}
const go=(db,params={})=>transitionOrderStatus({
  orderId:ORDER,newStatus:'available',actor,source:'local_relay_receipt',
  scanId:SCAN,note:'Réception locale attestée',dbClient:db,...params
});
test('accepts only a paid, local-only receipt with a signed scan, and writes canonical history',async()=>{
  const q=context();
  const r=await go(q);
  expect(r).toMatchObject({success:true,previousStatus:'confirmed',newStatus:'available'});
  expect(q.query.mock.calls.some(([sql])=>/UPDATE orders SET/.test(sql))).toBe(true);
  expect(q.query.mock.calls.some(([sql])=>/INSERT INTO order_status_history/.test(sql))).toBe(true);
  expect(q.query.mock.calls.some(([sql])=>/SELECT id FROM scans/.test(sql))).toBe(true);
});
test('rejects cross-relay or missing actor, without updating order',async()=>{
  const q=context();
  const r=await go(q,{actor:{...actor,relais_id:'foreign-relay'}});
  expect(r.code).toBe('LOCAL_RECEIPT_FORBIDDEN');
  expect(q.query.mock.calls.some(([sql])=>/UPDATE orders SET/.test(sql))).toBe(false);
});
test('rejects fake physical proof or import/mixed order',async()=>{
  const q=context({proof:false});
  expect((await go(q)).code).toBe('LOCAL_RECEIPT_PROOF_INVALID');
  const mixed=context({total:2,local:1});
  expect((await go(mixed)).code).toBe('LOCAL_RECEIPT_PROOF_INVALID');
  expect(mixed.query.mock.calls.some(([sql])=>/UPDATE orders SET/.test(sql))).toBe(false);
});
test('cannot use local source to skip payment or trigger collected',async()=>{
  const q=context({paid:'pending'});
  expect((await go(q)).code).toBe('LOCAL_RECEIPT_FORBIDDEN');
  const paid=context();
  expect((await go(paid,{newStatus:'collected'})).code).toBe('LOCAL_RECEIPT_FORBIDDEN');
});
