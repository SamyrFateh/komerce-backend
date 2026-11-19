/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
jest.mock('../../db',()=>({getClient:jest.fn()}));
jest.mock('../../services/order-status-machine',()=>({transitionOrderStatus:jest.fn()}));
jest.mock('../../services/parcel-operations',()=>({transitionParcelStatus:jest.fn()}));
jest.mock('../../services/hub-physical-identity',()=>({transitionPhysicalUnit:jest.fn()}));
jest.mock('../../services/incident-write-service',()=>({createHubPhysicalReconciliationIncident:jest.fn()}));
const db=require('../../db');
const {transitionOrderStatus}=require('../../services/order-status-machine');
const {transitionParcelStatus}=require('../../services/parcel-operations');
const {transitionPhysicalUnit}=require('../../services/hub-physical-identity');
const {createHubPhysicalReconciliationIncident}=require('../../services/incident-write-service');
const {assertScope,closeG6HubOrder}=require('../../services/g6-hub-recipe-closure');
const ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ACTOR={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',role:'admin'};
const ORDER={id:ID,reference:'KG6REC',status:'preparation',simulation_scope:'G6-BUYER',payment_mode:'cash_relais',wallet_applied_kmf:0};
describe('G6 Hub closure no provider/PSP',()=>{
  let client,data;
  beforeEach(()=>{
    jest.resetAllMocks();
    data={order:{...ORDER},parcels:[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',status:'preparation'}],
      units:[{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',state:'PACKED',outcome_type:null}],shared:[],linked:[],shipments:[]};
    client={release:jest.fn(),query:jest.fn(async sql=>{
      if(sql.includes('FROM orders WHERE id=$1 FOR UPDATE'))return {rows:[data.order]};
      if(sql.includes('FROM parcels WHERE order_id=$1'))return {rows:data.parcels};
      if(sql.includes('UNION SELECT u.id'))return {rows:data.units};
      if(sql.includes('a.order_id<>$2'))return {rows:data.shared};
      if(sql.includes('FROM hub_box_bags'))return {rows:data.linked};
      if(sql.includes('FROM international_shipment_hub_units'))return {rows:data.shipments};
      return {rows:[]};
    })};
    db.getClient.mockResolvedValue(client);
    transitionParcelStatus.mockResolvedValue({ok:true});
    transitionOrderStatus.mockResolvedValue({success:true,newStatus:'cancelled',cancelEffects:{walletReversalAmount:0}});
    transitionPhysicalUnit.mockResolvedValue({unit:{state:'QUARANTINED'}});
    createHubPhysicalReconciliationIncident.mockResolvedValue({id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'});
  });
  test('refus explicite hors G6, non-admin, wallet non nul',()=>{
    expect(()=>assertScope({...ORDER,simulation_scope:'LIVE'},ACTOR,'Motif valide')).toThrow(expect.objectContaining({code:'G6_HUB_NOT_RECIPE'}));
    expect(()=>assertScope(ORDER,{role:'agent_hub',id:ACTOR.id},'Motif valide')).toThrow(expect.objectContaining({code:'G6_HUB_ADMIN_ONLY'}));
    expect(()=>assertScope({...ORDER,wallet_applied_kmf:1},ACTOR,'Motif valide')).toThrow(expect.objectContaining({code:'G6_HUB_MONEY_UNSAFE'}));
  });
  test('clôture : quarantaine physique, annule colis par SSOT et commande par SSOT, sans PSP',async()=>{
    const result=await closeG6HubOrder(ID,{actor:ACTOR,reason:'Fin campagne G6'});
    expect(result).toMatchObject({status:'cancelled',external_calls:0,psp_refund:false,units_quarantined:1});
    expect(transitionPhysicalUnit).toHaveBeenCalledWith(client,expect.objectContaining({toState:'QUARANTINED',unitId:data.units[0].id}));
    expect(createHubPhysicalReconciliationIncident).toHaveBeenCalledWith(client,expect.objectContaining({physicalUnitId:data.units[0].id,subtype:'g6_hub_recipe_quarantine',orderId:ID}));
    expect(transitionParcelStatus).toHaveBeenCalledWith(client,data.parcels[0].id,'cancelled',expect.anything());
    expect(transitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({dbClient:client,source:'g6_hub_recipe',newStatus:'cancelled'}));
    expect(client.query.mock.calls.map(x=>x[0])).toContain('COMMIT');
  });
  for(const [name,property,value,code] of [
    ['scope','order',{...ORDER,simulation_scope:null},'G6_HUB_NOT_RECIPE'],
    ['outside Hub','parcels',[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',status:'in_transit'}],'G6_HUB_PARCEL_LEFT_HUB'],
    ['shared','shared',[{}],'G6_HUB_UNIT_SHARED'],
    ['immutable bag','linked',[{}],'G6_HUB_BOX_IMMUTABLE'],
    ['shipment','shipments',[{}],'G6_HUB_SHIPMENT_ASSIGNED'],
    ['no physical evidence','units',[],'G6_HUB_PHYSICAL_PROOF_MISSING']
  ]){
    test('refuses '+name+' without mutation',async()=>{
      data[property]=value;
      await expect(closeG6HubOrder(ID,{actor:ACTOR,reason:'Fin campagne G6'})).rejects.toMatchObject({code});
      expect(transitionOrderStatus).not.toHaveBeenCalled();
      expect(transitionParcelStatus).not.toHaveBeenCalled();
      expect(transitionPhysicalUnit).not.toHaveBeenCalled();
      expect(client.query.mock.calls.map(x=>x[0])).toContain('ROLLBACK');
    });
  }
});
