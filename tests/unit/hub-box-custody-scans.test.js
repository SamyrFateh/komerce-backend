'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
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
      if(sql.includes('SELECT actor_id FROM hub_box_custody_scans'))return {rows:prior?[{actor_id:USER}]:[]};
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
  expect(result.event_type).toBe('HUB_HANDOVER');
  expect(db.queries.filter(q=>q.sql.includes('INSERT INTO hub_box_custody_scans'))).toHaveLength(1);
  expect(db.queries.filter(q=>q.sql.includes('UPDATE international_shipments'))).toHaveLength(0);
});
test('carrier cannot scan a COMBOX before Hub handover stage',async()=>{
  await expect(service.confirmBoxScan(market,actor('agent_transitaire'),'KM-SHIP-01',input('CARRIER_ACCEPTED'),fakeDb())).rejects.toMatchObject({code:'CUSTODY_SHIPMENT_STAGE'});
});
test('carrier acceptance requires preceding scan of same COMBOX',async()=>{
  await expect(service.confirmBoxScan(market,actor('agent_transitaire'),'KM-SHIP-01',input('CARRIER_ACCEPTED'),fakeDb('handed_over'))).rejects.toMatchObject({code:'CUSTODY_PRIOR_SCAN_REQUIRED'});
});
test('carrier loaded requires receipt proof and its exact stage',async()=>{
  const db=fakeDb('forwarder_received',true);
  const result=await service.confirmBoxScan(market,actor('agent_transitaire'),'KM-SHIP-01',input('CARRIER_LOADED'),db);
  expect(result.event_type).toBe('CARRIER_LOADED');
});
test('no role crossover and no implicit confirmation',async()=>{
  await expect(service.confirmBoxScan(market,actor('agent_transitaire'),'KM-SHIP-01',input('HUB_HANDOVER'),fakeDb())).rejects.toMatchObject({code:'CUSTODY_ACTOR_FORBIDDEN'});
  await expect(service.confirmBoxScan(market,actor('agent_hub'),'KM-SHIP-01',{...input('HUB_HANDOVER'),confirmed:false},fakeDb())).rejects.toMatchObject({code:'CUSTODY_CONFIRMATION_REQUIRED'});
});
test('manifest coverage refuses missing scans',async()=>{
  const db=fakeDb();
  await expect(service.requireScanCoverage({query:async(...a)=>db.withTransaction(q=>q.query(...a))},SHIP,'CARRIER_LOADED')).rejects.toMatchObject({code:'CUSTODY_MANIFEST_INCOMPLETE'});
});

test('Hub and transitaire acceptance require two independent actors',async()=>{
  await expect(
    service.confirmBoxScan(market,actor('agent_transitaire'),'KM-SHIP-01',input('CARRIER_ACCEPTED'),fakeDb('handed_over',true)),
  ).rejects.toMatchObject({code:'CUSTODY_DUAL_ACTOR_REQUIRED'});
});
