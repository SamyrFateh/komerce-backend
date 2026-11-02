'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({getClient:jest.fn()}));
jest.mock('../../utils/logger',()=>({child:()=>({info:jest.fn(),warn:jest.fn(),error:jest.fn()})}));
jest.mock('../../services/client-notification-service',()=>({emitPickupReady:jest.fn().mockResolvedValue(null)}));
jest.mock('../../utils/reference',()=>({generateParcelRef:jest.fn().mockResolvedValue('KOM-P-2026-000999')}));
jest.mock('../../services/order-status-machine',()=>({transitionOrderStatus:jest.fn()}));
jest.mock('../../services/parcel-item-mutation-service',()=>({addParcelItemTraced:jest.fn().mockResolvedValue({row:{id:'assigned'}})}));
jest.mock('../../services/parcel-operations',()=>({transitionParcelStatus:jest.fn().mockResolvedValue({ok:true})}));
jest.mock('../../services/order-item-availability-service',()=>({setOrderItemAvailabilityStatus:jest.fn().mockResolvedValue(undefined)}));

const db=require('../../db');
const clientNotifications=require('../../services/client-notification-service');
const {transitionOrderStatus}=require('../../services/order-status-machine');
const {setOrderItemAvailabilityStatus}=require('../../services/order-item-availability-service');
const {addParcelItemTraced}=require('../../services/parcel-item-mutation-service');
const {transitionParcelStatus}=require('../../services/parcel-operations');
const {recordLocalRelayReceipt}=require('../../services/local-relay-receipt-service');

const ORDER='00000000-0000-0000-0000-000000000011';
const RELAY='00000000-0000-0000-0000-000000000022';
const MARKET='00000000-0000-0000-0000-000000000077';
const actor={id:'00000000-0000-0000-0000-000000000033',role:'agent_relais',relais_id:RELAY};
const item={id:'00000000-0000-0000-0000-000000000044',product_id:'00000000-0000-0000-0000-000000000055',quantity:2,fulfillment_source:'LOCAL_STOCK'};
let client;

function setup({status='confirmed',paid='paid',items=[item],consumed=2,allocationProduct=item.product_id,allocationMarket=MARKET,existing=[]}={}) {
  client={release:jest.fn(),query:jest.fn(async(sql)=>{
    if (/^SELECT o.id, o.reference, o.status/.test(sql))
      return {rows:[{id:ORDER,reference:'KOM-2026-1',relais_id:RELAY,user_id:'u',market_id:MARKET,relais_name:'Relais',status,payment_status:paid}]};
    if (/^SELECT id,product_id,quantity/.test(sql))return {rows:items};
    if (sql.includes('FROM local_stock_allocations lsa'))return {rows:[{product_id:allocationProduct,market_id:allocationMarket,consumed}]};
    if (/^SELECT p.id FROM parcels/.test(sql))return {rows:existing};
    if (/INSERT INTO scans/.test(sql))return {rows:[{id:'00000000-0000-0000-0000-000000000066'}]};
    return {rows:[],rowCount:1};
  })};
  db.getClient.mockResolvedValue(client);
  transitionOrderStatus.mockResolvedValue({success:true,newStatus:'available'});
  return client;
}
beforeEach(()=>{
  jest.clearAllMocks();
  setup();
});
const execute=(more={})=>recordLocalRelayReceipt({
  orderId:ORDER,actor,physicalReceived:true,...more
});
const written=(pattern)=>client.query.mock.calls.some(([sql])=>pattern.test(sql));

test('refuse a receipt without signed physical attestation before accessing DB',async()=>{
  const r=await execute({physicalReceived:false});
  expect(r.body.code).toBe('LOCAL_RECEIPT_PROOF_REQUIRED');
  expect(db.getClient).not.toHaveBeenCalled();
});
test('cross-relay agent cannot attest the order',async()=>{
  const r=await execute({actor:{...actor,relais_id:'other'}});
  expect(r.status).toBe(403);
  expect(r.body.code).toBe('LOCAL_RECEIPT_RELAY_FORBIDDEN');
  expect(written(/INSERT INTO/)).toBe(false);
});
test('unpaid order is never made available',async()=>{
  setup({paid:'pending'});
  const r=await execute();
  expect(r.body.code).toBe('LOCAL_RECEIPT_ORDER_NOT_READY');
  expect(written(/INSERT INTO/)).toBe(false);
});
test('mixed order receives only local lines and preserves import provenance',async()=>{
  const imported={...item,id:'import',fulfillment_source:'IMPORT',quantity:1};
  setup({items:[item,imported],consumed:2});
  const r=await execute();
  expect(r.status).toBe(200);
  expect(addParcelItemTraced).toHaveBeenCalledTimes(1);
  expect(addParcelItemTraced).toHaveBeenCalledWith(client,expect.objectContaining({parcelId:expect.any(String),orderItemId:item.id,quantity:2,actorId:actor.id}));
  expect(written(/UPDATE parcel_items SET qty_allocated/)).toBe(true);
  expect(transitionParcelStatus).toHaveBeenCalledWith(client,expect.any(String),'available',{skipValidation:true});
});
test('unknown provenance or fully imported order fails closed',async()=>{
  setup({items:[{...item,fulfillment_source:null}]});
  expect((await execute()).body.code).toBe('LOCAL_RECEIPT_INVALID_PROVENANCE');
  setup({items:[{...item,fulfillment_source:'IMPORT'}]});
  expect((await execute()).body.code).toBe('LOCAL_RECEIPT_INVALID_PROVENANCE');
});
test('paid allocation must match local quantity',async()=>{
  setup({consumed:1});
  const r=await execute();
  expect(r.body.code).toBe('LOCAL_RECEIPT_ALLOCATION_MISMATCH');
  expect(written(/INSERT INTO/)).toBe(false);
});
test('allocation of equal quantity but wrong SKU or market is refused',async()=>{
  setup({consumed:2,allocationProduct:'other-product'});
  expect((await execute()).body.code).toBe('LOCAL_RECEIPT_ALLOCATION_MISMATCH');
  setup({consumed:2,allocationMarket:'other-market'});
  expect((await execute()).body.code).toBe('LOCAL_RECEIPT_ALLOCATION_MISMATCH');
  expect(written(/INSERT INTO/)).toBe(false);
});
test('never duplicates an existing parcel',async()=>{
  setup({existing:[{id:'already'}]});
  const r=await execute();
  expect(r.body.code).toBe('LOCAL_RECEIPT_PARCEL_ALREADY_EXISTS');
  expect(written(/INSERT INTO/)).toBe(false);
});
test('local paid receipt is atomic, parcel-scoped, and uses canonical status machine',async()=>{
  const r=await execute({note:'reçu et compté'});
  expect(r).toMatchObject({ok:true,body:{status:'available',receipt_scan_id:expect.any(String)}});
  expect(client.query.mock.calls[0][0]).toBe('BEGIN');
  expect(written(/FROM orders o JOIN relais r ON r.id=o.relais_id WHERE o.id=\$1 FOR UPDATE OF o/)).toBe(true);
  expect(written(/INSERT INTO parcels/)).toBe(true);
  expect(addParcelItemTraced).toHaveBeenCalledTimes(1);
  expect(written(/INSERT INTO scans/)).toBe(true);
  expect(written(/INSERT INTO parcel_events/)).toBe(true);
  expect(written(/purchase_orders|international_shipments|customs_shipments/i)).toBe(false);
  expect(written(/UPDATE parcel_items SET qty_allocated/)).toBe(true);
  expect(setOrderItemAvailabilityStatus).toHaveBeenCalledWith(client,item.id,'available');
  expect(transitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({
    orderId:ORDER,newStatus:'available',source:'local_relay_receipt',dbClient:client,
    actor,scanId:'00000000-0000-0000-0000-000000000066',
  }));
  expect(written(/^COMMIT$/)).toBe(true);
  expect(client.release).toHaveBeenCalledTimes(1);
  expect(clientNotifications.emitPickupReady).toHaveBeenCalledWith(expect.objectContaining({orderId:ORDER,orderReference:'KOM-2026-1',relaisName:'Relais'}));
});
test('status machine refusal rolls back parcel, scan and availability together',async()=>{
  transitionOrderStatus.mockResolvedValue({success:false,error:'not eligible'});
  const r=await execute();
  expect(r).toMatchObject({status:409,body:{error:'not eligible'}});
  expect(written(/^ROLLBACK$/)).toBe(true);
  expect(written(/^COMMIT$/)).toBe(false);
  expect(client.release).toHaveBeenCalledTimes(1);
});
