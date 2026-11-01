'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({withTransaction:jest.fn()}));
jest.mock('../../services/cost-allocation/canonical-margin-writer',()=>({
  refreshCanonicalMarginForOrders:jest.fn().mockResolvedValue({enabled:true})
}));
const {reconcile,ReconciliationError}=require('../../services/international-n1-reconciliation');
const {refreshCanonicalMarginForOrders}=require('../../services/cost-allocation/canonical-margin-writer');
const M='11111111-1111-1111-1111-111111111111';
const S='22222222-2222-2222-2222-222222222222';
const C='33333333-3333-3333-3333-333333333333';
const P1='44444444-4444-4444-4444-444444444444',P2='55555555-5555-5555-5555-555555555555';
const O='66666666-6666-6666-6666-666666666666';
const I1='77777777-7777-7777-7777-777777777777';
const I2='88888888-8888-8888-8888-888888888888';
const market={id:M,code:'KM'}, admin={id:'admin-1',role:'admin'};
const freight='123.45';
function fake(options={}) {
  const statements=[],allocations=[];
  let previous=null, inserted=0;
  const ship={id:S,reference:'INT-KM-001',market_id:M,customs_shipment_id:C,
    customs_active:true,customs_market_id:M,freight_invoice_kmf:options.noFreight?null:freight,
    freight_invoice_ref:'FRET-1',transport_mode:options.air?'air':'sea',
    legacy_freight_kmf:options.legacyFreight||null};
  const charges=options.noFees?[]:[
    {id:'c1',fee_type:'handling',kind:'charge',amount_kmf:'12.34',proof_ref:'P-ARRIVAL'},
    {id:'c2',fee_type:'local_transport',kind:'charge',amount_kmf:'7.89',proof_ref:'P-LOCAL'},
  ];
  const client={query:jest.fn(async(sql,params=[])=>{
    const q=String(sql);statements.push({q,params});
    if(q.startsWith('SELECT s.*, cs.is_active'))return {rows:[ship]};
    if(q.startsWith('SELECT id, is_active, freight_kmf FROM customs_shipments'))
      return {rows:[{id:C,is_active:true,freight_kmf:options.legacyFreight||null}]};
    if(q.startsWith('SELECT fee_type,kind,amount_kmf,proof_ref,id FROM international_shipment_charges'))
      return {rows:charges};
    if(q.startsWith('SELECT fee_type,proof_ref,kind,amount_kmf FROM customs_shipment_fees'))
      return {rows:options.legacyFees||[]};
    if(q.startsWith('SELECT ip.parcel_id,ip.volume_cm3'))
      return {rows:[{parcel_id:P1,order_id:O,market_id:M,volume_cm3:1000000},
        {parcel_id:P2,order_id:O,market_id:M,volume_cm3:3000000}]};
    if(q.startsWith('SELECT COUNT(*)::int AS bad'))return {rows:[{bad:0}]};
    if(q.startsWith('SELECT pi.parcel_id,pi.order_item_id'))
      return {rows:[{parcel_id:P1,order_item_id:I1,order_id:O,quantity:2},
        {parcel_id:P2,order_item_id:I2,order_id:O,quantity:1}]};
    if(q.startsWith('SELECT snapshot_hash'))return {rows:previous?[previous]:[]};
    if(q.startsWith('SELECT COUNT(*)::int AS n FROM international_n1_allocation_links'))
      return {rows:[{n:previous?previous.allocation_rows:0}]};
    if(q.startsWith('INSERT INTO order_item_real_cost_allocations')){
      inserted+=1;allocations.push({amount:params[4],type:params[3],method:params[5],source:params[6]});
      return {rows:[{id:'allocation-'+inserted}]};
    }
    if(q.startsWith('INSERT INTO international_n1_reconciliations')){
      previous={snapshot_hash:params[1],allocation_rows:params[5]};
    }
    return {rows:[],rowCount:1};
  })};
  return {database:{withTransaction:fn=>fn(client)},statements,allocations,client};
}
beforeEach(()=>jest.clearAllMocks());
test('refuses cross-role and missing market before any SQL',async()=>{
  const x=fake();
  await expect(reconcile(market,{id:'user',role:'market_operator'},'INT-KM-001',x.database))
    .rejects.toMatchObject({code:'INTERNATIONAL_N1_FORBIDDEN',status:403});
  await expect(reconcile({id:null,code:'KM'},admin,'INT-KM-001',x.database))
    .rejects.toBeInstanceOf(ReconciliationError);
  expect(x.statements).toHaveLength(0);
});
test('conserves three actual N1 cost types down to cents, with source-owned links',async()=>{
  const x=fake();
  const r=await reconcile(market,admin,'INT-KM-001',x.database);
  expect(r).toMatchObject({status:'reconciled',idempotent:false,
    actual_n1_kmf:'143.68',freight_kmf:'123.45',arrival_kmf:'12.34',local_kmf:'7.89'});
  expect(Math.round(x.allocations.reduce((s,a)=>s+Number(a.amount),0)*100)).toBe(14368);
  expect(new Set(x.allocations.map(a=>a.type))).toEqual(
    new Set(['freight','port_transitaire','local_distribution']));
  expect(x.allocations.every(a=>a.source.startsWith('international_shipment'))).toBe(true);
  expect(x.statements.filter(s=>s.q.startsWith('INSERT INTO international_n1_allocation_links'))).toHaveLength(r.allocation_rows);
  expect(x.statements.some(s=>s.q.includes('UPDATE customs_shipments'))).toBe(false);
  expect(x.statements.some(s=>s.q.includes('DELETE FROM order_item_real_cost_allocations')&&s.q.includes('international_n1_allocation_links'))).toBe(true);
  expect(refreshCanonicalMarginForOrders).toHaveBeenCalledWith([O],{client:x.client});
});
test('replaying unchanged documents does not create another cost allocation',async()=>{
  const x=fake();
  await reconcile(market,admin,'INT-KM-001',x.database);
  const oldCount=x.allocations.length;
  const r=await reconcile(market,admin,'INT-KM-001',x.database);
  expect(r).toMatchObject({idempotent:true,actual_n1_kmf:'143.68'});
  expect(x.allocations).toHaveLength(oldCount);
});
test('fails closed when real freight is already known in customs',async()=>{
  const x=fake({legacyFreight:'100.00'});
  await expect(reconcile(market,admin,'INT-KM-001',x.database))
    .rejects.toMatchObject({code:'INTERNATIONAL_N1_DUPLICATE_FREIGHT'});
  expect(x.allocations).toHaveLength(0);
});
test('fails closed on overlapping fee families even if invoices differ',async()=>{
  const x=fake({legacyFees:[{fee_type:'handling',proof_ref:'OTHER-PROOF',kind:'charge',amount_kmf:20}]});
  await expect(reconcile(market,admin,'INT-KM-001',x.database))
    .rejects.toMatchObject({code:'INTERNATIONAL_N1_OVERLAPPING_CUSTOMS_FEES'});
  expect(x.allocations).toHaveLength(0);
});
test('air freight without contractual taxable-weight calibration is not invented',async()=>{
  const x=fake({air:true});
  await expect(reconcile(market,admin,'INT-KM-001',x.database))
    .rejects.toMatchObject({code:'INTERNATIONAL_N1_AIR_CALIBRATION_PENDING'});
  expect(x.allocations).toHaveLength(0);
});
test('source fee credit subtracts cost, never creates a negative N1 net',async()=>{
  const x=fake({noFreight:true});
  const original=x.client.query;
  x.client.query=jest.fn(async(sql,params)=>{
    if(String(sql).startsWith('SELECT fee_type,kind,amount_kmf,proof_ref,id FROM international_shipment_charges'))
      return {rows:[
        {id:'c1',fee_type:'handling',kind:'charge',amount_kmf:'20.00',proof_ref:'INV-1'},
        {id:'c2',fee_type:'handling',kind:'credit',amount_kmf:'5.00',proof_ref:'CREDIT-1'},
      ]};
    return original(sql,params);
  });
  const r=await reconcile(market,admin,'INT-KM-001',x.database);
  expect(r).toMatchObject({status:'partial_reconciliation',actual_n1_kmf:'15.00',arrival_kmf:'15.00',local_kmf:'0.00'});
});

test('unknown freight and no source charge can never become an actual zero',async()=>{
  const x=fake({noFreight:true,noFees:true});
  await expect(reconcile(market,admin,'INT-KM-001',x.database))
    .rejects.toMatchObject({code:'INTERNATIONAL_N1_NO_REAL_FACTS'});
  expect(x.allocations).toHaveLength(0);
});
