'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const service=require('../../services/hub-box-custody-scans');

const SHIP='11111111-1111-4111-8111-111111111111';
const BOX='22222222-2222-4222-8222-222222222222';
const LABEL='33333333-3333-4333-8333-333333333333';
const USER='44444444-4444-4444-8444-444444444444';
const MARKET='55555555-5555-4555-8555-555555555555';
const RELAY='66666666-6666-4666-8666-666666666666';
const QR='KQ1_'+'A'.repeat(32);
function fakeDb(stage='hub_ready',prior=false) {
  const queries=[];
  return {
    queries,
    async withTransaction(fn){return fn({query:async(sql,args)=>{
      queries.push({sql,args});
      if(sql.includes('FROM international_shipments WHERE reference='))return {rows:[{id:SHIP,stage}]};
      if(sql.includes('FROM hub_scan_labels l'))return {rows:[{
        id:LABEL,target_type:'COMBOX',physical_unit_id:BOX,market_id:MARKET,relais_id:RELAY
      }]};
      if(sql.includes('FROM international_shipment_hub_units h')&&sql.includes('FOR UPDATE OF u'))
        return {rows:[{id:BOX,state:'DISPATCHED',outcome_type:null}]};
      if(sql.includes('SELECT 1 FROM hub_box_custody_scans'))return {rows:prior?[{exists:true}]:[]};
      if(sql.includes('INSERT INTO hub_box_custody_scans'))
        return {rows:[{id:'proof-id',occurred_at:'2026-11-24T08:28:00Z'}]};
      if(sql.includes('COUNT(*)::int AS total'))return {rows:[{total:2,missing:1}]};
      throw Error('Unexpected query '+sql);
    }})}
  };
}
const actor=role=>({id:USER,role});
const market={id:MARKET,code:'KM'};
const input=event_type=>({event_type,proof_ref:'PROOF-001',qr_code:QR,confirmed:true});
test('Hub confirmation records QR custody evidence, but not a shipment transition',async()=>{
  const db=fakeDb();const result=await service.confirmBoxScan(market,actor('agent_hub'),'KM-SHIP-01',input('HUB_HANDOVER'),db);
  assert.equal(result.event_type,'HUB_HANDOVER');
  assert.equal(db.queries.filter(q=>q.sql.includes('INSERT INTO hub_box_custody_scans')).length,1);
  assert.equal(db.queries.filter(q=>q.sql.includes('UPDATE international_shipments')).length,0);
});
test('carrier cannot scan a COMBOX before Hub handover stage',async()=>{
  await assert.rejects(service.confirmBoxScan(market,actor('agent_transitaire'),'KM-SHIP-01',input('CARRIER_ACCEPTED'),fakeDb()),{code:'CUSTODY_SHIPMENT_STAGE'});
});
test('carrier acceptance requires preceding scan of same COMBOX',async()=>{
  await assert.rejects(service.confirmBoxScan(market,actor('agent_transitaire'),'KM-SHIP-01',input('CARRIER_ACCEPTED'),fakeDb('handed_over')),{code:'CUSTODY_PRIOR_SCAN_REQUIRED'});
});
test('carrier loaded requires receipt proof and its exact stage',async()=>{
  const db=fakeDb('forwarder_received',true);
  const result=await service.confirmBoxScan(market,actor('agent_transitaire'),'KM-SHIP-01',input('CARRIER_LOADED'),db);
  assert.equal(result.event_type,'CARRIER_LOADED');
});
test('no role crossover and no implicit confirmation',async()=>{
  await assert.rejects(service.confirmBoxScan(market,actor('agent_transitaire'),'KM-SHIP-01',input('HUB_HANDOVER'),fakeDb()),{code:'CUSTODY_ACTOR_FORBIDDEN'});
  await assert.rejects(service.confirmBoxScan(market,actor('agent_hub'),'KM-SHIP-01',{...input('HUB_HANDOVER'),confirmed:false},fakeDb()),{code:'CUSTODY_CONFIRMATION_REQUIRED'});
});
test('manifest coverage refuses missing scans',async()=>{
  const db=fakeDb();
  await assert.rejects(service.requireScanCoverage({query:async(...a)=>db.withTransaction(q=>q.query(...a))},SHIP,'CARRIER_LOADED'),{code:'CUSTODY_MANIFEST_INCOMPLETE'});
});
