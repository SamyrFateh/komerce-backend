'use strict';
/** @test-kind unit @test-runner jest @test-requires none
 * Real international shipping never relies on a browser market_id, and
 * source invoices do not silently create N1 financial allocations.
 */
jest.mock('../../db',()=>({query:jest.fn(),withTransaction:jest.fn()}));
const journey=require('../../services/international-shipment-journey');
const market={id:'11111111-1111-1111-1111-111111111111',code:'KM'};
const admin={id:'actor-admin',role:'admin'};
const hub={id:'actor-hub',role:'agent_hub'};
const forwarder={id:'actor-forwarder',role:'agent_transitaire'};
const uuid='22222222-2222-2222-2222-222222222222';
const base={id:uuid,reference:'INT-KM-001',market_id:market.id,stage:'hub_ready',
  transport_mode:'sea',forwarder_name:'Transitaire',freight_invoice_kmf:null,
  tracking_reference:null,bill_of_lading_ref:null,customs_shipment_id:null};
function fixture(stage='hub_ready',other={}) {
  const executed=[];
  const shipment={...base,stage,...other};
  const client={query:jest.fn(async(sql,params)=>{
    executed.push({sql:String(sql),params});
    if(String(sql).startsWith('SELECT * FROM international_shipments'))return {rows:[shipment]};
    if(String(sql).startsWith('SELECT status,customs_paid_kmf FROM customs_shipments'))
      return {rows:[{status:'declared',customs_paid_kmf:'1500'}]};
    if(String(sql).startsWith('SELECT id FROM customs_shipments'))
      return {rows:[{id:'33333333-3333-3333-3333-333333333333'}]};
    if(String(sql).includes('COUNT(*)::int AS n FROM customs_shipment_parcels'))return {rows:[{n:0}]};
    if(String(sql).includes('SELECT * FROM international_shipment_charges'))return {rows:[]};
    if(String(sql).includes('SELECT id FROM customs_shipment_fees'))return {rows:[]};
    if(String(sql).includes('AS net FROM international_shipment_charges'))return {rows:[{net:'100'}]};
    if(String(sql).includes('RETURNING id'))return {rows:[{id:'cost-1'}]};
    return {rows:[]};
  })};
  const db={withTransaction:jest.fn(fn=>fn(client))};
  return {db,client,executed,shipment};
}
function expectError(promise,code){return expect(promise).rejects.toMatchObject({code});}

test('only explicit roles, server market, proofs and valid states are accepted',async()=>{
  const x=fixture();
  await expectError(journey.transition(market,hub,'INT-KM-001',{to_stage:'arrived',proof_ref:'X'},x.db),'JOURNEY_ROLE_FORBIDDEN');
  await expectError(journey.transition(market,admin,'INT-KM-001',{to_stage:'arrived',proof_ref:'X'},x.db),'JOURNEY_STAGE_ORDER');
  await expectError(journey.transition(market,hub,'INT-KM-001',{to_stage:'handed_over'},x.db),'JOURNEY_INVALID_proof_ref');
  expect(x.executed.every(e=>!e.sql.includes('UPDATE international_shipments'))).toBe(true);
  await expectError(journey.transition({id:null,code:'KM'},admin,'INT-KM-001',{to_stage:'handed_over',proof_ref:'X'},x.db),'JOURNEY_MARKET_REQUIRED');
  await expectError(journey.transition(market,{id:'no',role:'market_operator'},'INT-KM-001',{to_stage:'handed_over',proof_ref:'X'},x.db),'JOURNEY_ROLE_FORBIDDEN');
});

test('Hub remise confirmed atomically, without marking parcel or customs cleared',async()=>{
  const x=fixture();
  const res=await journey.transition(market,hub,'INT-KM-001',{to_stage:'handed_over',proof_ref:'HUB-HANDOVER-1'},x.db);
  expect(res).toEqual({reference:'INT-KM-001',from_stage:'hub_ready',stage:'handed_over'});
  expect(x.db.withTransaction).toHaveBeenCalledTimes(1);
  expect(x.executed.some(q=>q.sql.includes('UPDATE international_shipments SET stage'))).toBe(true);
  expect(x.executed.some(q=>q.sql.includes('international_shipment_events')&&
    q.params.includes('HUB-HANDOVER-1'))).toBe(true);
  expect(x.executed.some(q=>/UPDATE parcels|customs_cleared_at|order_item_real_cost_allocations/.test(q.sql))).toBe(false);
  expect(x.executed[0].params).toEqual([market.id,'INT-KM-001']);
});

test('container tracking is mandatory before confirming shipment, and is editable with history',async()=>{
  const x=fixture('forwarder_received');
  await expectError(journey.transition(market,forwarder,'INT-KM-001',{to_stage:'in_transit',proof_ref:'SHIP-1'},x.db),'JOURNEY_TRACKING_REQUIRED');
  const y=fixture('forwarder_received');
  const result=await journey.updateTracking(market,forwarder,'INT-KM-001',
    {tracking_reference:'BOL-2026-1',container_reference:'MSCU1234567',
      estimated_arrival_date:'2026-12-01',proof_ref:'BOL-PROOF'},y.db);
  expect(result.tracking_reference).toBe('BOL-2026-1');
  expect(y.executed.some(q=>q.sql.startsWith('UPDATE international_shipments')&&q.params.includes('BOL-2026-1'))).toBe(true);
  expect(y.executed.some(q=>q.sql.includes('international_shipment_events')&&q.params.includes('BOL-PROOF'))).toBe(true);
  await expectError(journey.updateTracking(market,forwarder,'INT-KM-001',{proof_ref:'X',estimated_arrival_date:'2026-02-31'},y.db),'JOURNEY_INVALID_DATE');
});

test('release requires related customs and real mainlevee proof, not just transport invoice',async()=>{
  const x=fixture('arrived');
  await expectError(journey.transition(market,admin,'INT-KM-001',
    {to_stage:'customs_released',proof_ref:'MAINLEVEE-001'},x.db),'JOURNEY_CUSTOMS_REQUIRED');
  const y=fixture('arrived',{customs_shipment_id:'33333333-3333-3333-3333-333333333333'});
  const result=await journey.transition(market,admin,'INT-KM-001',
    {to_stage:'customs_released',proof_ref:'MAINLEVEE-001'},y.db);
  expect(result.stage).toBe('customs_released');
  expect(y.executed.some(q=>q.sql.includes('SELECT status,customs_paid_kmf FROM customs_shipments'))).toBe(true);
  expect(y.executed.some(q=>q.params&&q.params.includes('MAINLEVEE-001'))).toBe(true);
});

test('freight invoice only after forwarder receipt, with actual amount plus evidence and no double allocation',async()=>{
  await expectError(journey.recordFreight(market,admin,'INT-KM-001',
    {invoice_ref:'F-1',amount_kmf:'15000'},fixture().db),'JOURNEY_FORWARDER_RECEIPT_REQUIRED');
  const x=fixture('forwarder_received');
  const result=await journey.recordFreight(market,admin,'INT-KM-001',
    {invoice_ref:'F-1',amount_kmf:'15000',volume_m3:'1.25',rate_kmf_per_m3:'12000'},x.db);
  expect(result.cost_reconciliation).toBe('not_reconciled');
  expect(x.executed.some(q=>q.sql.includes('freight_invoice_kmf=$3')&&q.params[2]==='15000')).toBe(true);
  expect(x.executed.some(q=>/order_item_real_cost_allocations|UPDATE customs_shipments|cost_components/.test(q.sql))).toBe(false);
  await expectError(journey.recordFreight(market,admin,'INT-KM-001',
    {invoice_ref:'F-1',amount_kmf:'15000'},fixture('forwarder_received',{freight_invoice_kmf:'15000'}).db),
  'JOURNEY_FREIGHT_ALREADY_RECORDED');
});

test('arrival costs and relay transport cannot be posted prematurely or without proof',async()=>{
  const x=fixture('in_transit');
  await expectError(journey.recordCost(market,admin,'INT-KM-001',
    {fee_type:'handling',amount_kmf:'1200',proof_ref:'PORT-1',idempotency_key:'PORT-1'},x.db),
  'JOURNEY_ARRIVAL_REQUIRED');
  await expectError(journey.recordCost(market,admin,'INT-KM-001',
    {fee_type:'local_transport',amount_kmf:'1200',proof_ref:'TR-1',idempotency_key:'TR-1'},fixture('arrived').db),
  'JOURNEY_RELEASE_REQUIRED');
  const y=fixture('arrived');
  const result=await journey.recordCost(market,admin,'INT-KM-001',
    {fee_type:'handling',amount_kmf:'1200',proof_ref:'PORT-1',idempotency_key:'PORT-1'},y.db);
  expect(result).toMatchObject({idempotent:false,cost_reconciliation:'not_reconciled'});
  expect(y.executed.some(q=>q.sql.includes('INSERT INTO international_shipment_charges'))).toBe(true);
  expect(y.executed.some(q=>/order_item_real_cost_allocations/.test(q.sql))).toBe(false);
  await expectError(journey.recordCost(market,admin,'INT-KM-001',
    {fee_type:'customs_duties',amount_kmf:'1200',proof_ref:'X',idempotency_key:'X'},y.db),
  'JOURNEY_FEE_UNKNOWN');
});

test('creating real journey requires exact parcel provenance and prevents duplicated membership',async()=>{
  const x=fixture();
  x.client.query.mockImplementation(async(sql,params)=>{
    x.executed.push({sql:String(sql),params});
    if(String(sql).includes('FROM parcels p JOIN orders o'))return {rows:[]};
    return {rows:[]};
  });
  await expectError(journey.create(market,admin,{reference:'INT-001',forwarder_name:'T',
      transport_mode:'sea',parcel_refs:['PCL-1'],proof_ref:'H-1'},x.db),
    'JOURNEY_PARCELS_NOT_READY');
  const y=fixture();
  y.client.query.mockImplementation(async(sql,params)=>{
    y.executed.push({sql:String(sql),params});
    if(String(sql).includes('FROM parcels p JOIN orders o'))
      return {rows:[{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',reference:'PCL-1',status:'collected',volume_cm3:'5000'}]};
    if(String(sql).includes('SELECT parcel_id FROM international_shipment_parcels'))return {rows:[]};
    if(String(sql).includes('INSERT INTO international_shipments'))return {rows:[base]};
    return {rows:[]};
  });
  const result=await journey.create(market,admin,{
    reference:'INT-001',forwarder_name:'Transitaire',transport_mode:'sea',
    parcel_refs:['PCL-1'],volume_m3:'0.005',freight_rate_kmf_per_m3:'10000',
    proof_ref:'H-1'},y.db);
  expect(result.parcels).toBe(1);
  expect(y.executed.some(q=>q.sql.includes('INSERT INTO international_shipment_parcels'))).toBe(true);
  expect(y.executed.every(q=>!q.sql.includes('UPDATE orders'))).toBe(true);
});

test('schema has FK and audit-only financial boundary, no automatic N1 double counting',()=>{
  const fs=require('fs'),path=require('path');
  const migration=fs.readFileSync(path.join(__dirname,'../../migrations/354_international_shipment_journey.sql'),'utf8');
  expect(migration).toContain('CONSTRAINT uq_international_parcel UNIQUE(parcel_id)');
  expect(migration).toContain('international_shipment_charges');
  expect(migration).toContain('BEFORE UPDATE OR DELETE');
  expect(migration).not.toMatch(/INSERT INTO public\.order_item_real_cost_allocations/);
});
