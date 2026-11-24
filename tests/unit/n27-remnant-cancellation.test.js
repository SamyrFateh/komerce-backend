'use strict';
/** @test-kind unit
 * @test-runner jest
 * @test-requires none
 * N27 readback is phase-aware and its writer delegates to the local liability owner.
 */
jest.mock('../../services/item-refund-reservation-service', () => ({
  readVerifiedShortageCandidates: jest.fn(),
}));
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/local-item-refund-reservation', () => ({
  reserveLocalShortage: jest.fn(),
}));
const { readVerifiedShortageCandidates } = require('../../services/item-refund-reservation-service');
const { reserveLocalShortage } = require('../../services/local-item-refund-reservation');
const { readN27RemnantContext, reserveN27Remnant } = require('../../services/n27-remnant-cancellation-service');

const ORDER='11111111-1111-4111-8111-111111111111';
const ITEM1='22222222-2222-4222-8222-222222222222';
const ITEM2='33333333-3333-4333-8333-333333333333';
const INCIDENT='44444444-4444-4444-8444-444444444444';
const admin={id:'55555555-5555-4555-8555-555555555555',role:'admin'};

beforeEach(()=>jest.clearAllMocks());

function baseContext(){
  return {order:{id:ORDER,reference:'K0N27A',payment_mode:'cash_relais',payment_status:'paid'},blocked:false,
    items:[
      {id:ITEM1,product_name:'Article partiellement remis',quantity:3,qty_collected:1,qty_refunded:0},
      {id:ITEM2,product_name:'Article en transport',quantity:2,qty_collected:0,qty_refunded:0},
    ],
    candidates:[
      {order_item_id:ITEM1,incident_id:INCIDENT,available_quantity:2,verified_missing:2,proof:'supplier_shortage'},
      {order_item_id:ITEM2,incident_id:INCIDENT,available_quantity:2,verified_missing:2,proof:'relay_receipt'},
    ]};
}

describe('N27 remaining quantity decision',()=>{
  test('only F1 verified shortage is reservable; collected quantity stays excluded',async()=>{
    readVerifiedShortageCandidates.mockResolvedValue(baseContext());
    const db={query:jest.fn().mockResolvedValue({rows:[
      {order_item_id:ITEM1,supplier_pending:false,transport_pending:false},
      {order_item_id:ITEM2,supplier_pending:false,transport_pending:true},
    ]})};
    const result=await readN27RemnantContext({orderReference:'K0N27A',actor:admin,db});
    expect(result.items[0]).toMatchObject({phase:'F1',qty_collected:1,uncollected_quantity:2});
    expect(result.items[1]).toMatchObject({phase:'F3',blocked_reason:'transport_pending'});
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({order_item_id:ITEM1,phase:'F1',available_quantity:2});
    expect(readVerifiedShortageCandidates).toHaveBeenCalledWith({
      orderReference:'K0N27A',actor:admin,db,allowLocal:true,
    });
  });

  test('F2 supplier commitment is not exposed as cancellable',async()=>{
    readVerifiedShortageCandidates.mockResolvedValue(baseContext());
    const db={query:jest.fn().mockResolvedValue({rows:[
      {order_item_id:ITEM1,supplier_pending:true,transport_pending:false},
      {order_item_id:ITEM2,supplier_pending:false,transport_pending:false},
    ]})};
    const result=await readN27RemnantContext({orderReference:'K0N27A',actor:admin,db});
    expect(result.items[0]).toMatchObject({phase:'F2',blocked_reason:'supplier_commitment_pending'});
    expect(result.candidates.map(row=>row.order_item_id)).not.toContain(ITEM1);
  });

  test('reserve reuses local liability owner and requires its transactional F1 recheck',async()=>{
    reserveLocalShortage.mockResolvedValue({reservationId:'reservation-1',status:'reserved',paid:false});
    const args={orderId:ORDER,orderItemId:ITEM1,incidentId:INCIDENT,
      operationKey:'66666666-6666-4666-8666-666666666666',quantity:1,
      reason:'Manquant confirmé au relais',actor:admin};
    await reserveN27Remnant(args);
    expect(reserveLocalShortage).toHaveBeenCalledWith({...args,
      reason:'N27 — Manquant confirmé au relais',requireReleasedSupply:true,
      db:require('../../db')});
  });

  test('non-admin cannot reserve a N27 liability',async()=>{
    await expect(reserveN27Remnant({actor:{role:'agent_hub'}}))
      .rejects.toMatchObject({status:403,code:'N27_ADMIN_REQUIRED'});
    expect(reserveLocalShortage).not.toHaveBeenCalled();
  });
});
