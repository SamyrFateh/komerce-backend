'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
// The financial authority is the shipment, never the article.
jest.mock('../../db',()=>({withTransaction:jest.fn()}));
const {reconcile,ReconciliationError}=require('../../services/international-n1-reconciliation');
const M='11111111-1111-1111-1111-111111111111';
const S='22222222-2222-2222-2222-222222222222';
const C='33333333-3333-3333-3333-333333333333';
const market={id:M,code:'KM'},admin={id:'admin-1',role:'admin'};
function fixture(options={}){
  const queries=[];let prior=null;
  const shipment={id:S,reference:'KM-EXP-1',market_id:M,stage:options.stage||'arrived',
    customs_shipment_id:C,customs_active:true,customs_market_id:M,
    customs_paid_kmf:options.unknownTax?null:'30.00',
    freight_invoice_kmf:options.unknownFreight?null:'123.45',
    freight_invoice_ref:'FRET-1',transport_mode:'sea',customs_freight_kmf:null};
  const fees=options.fees||[
    {id:'fee1',fee_type:'handling',kind:'charge',amount_kmf:'12.34',proof_ref:'HANDLING-1'},
    {id:'fee2',fee_type:'local_transport',kind:'charge',amount_kmf:'7.89',proof_ref:'LOCAL-1'},
  ];
  const customsFees=options.customsFees||[];
  const client={query:jest.fn(async(sql,params=[])=>{
    const q=String(sql);queries.push({q,params});
    if(q.startsWith('SELECT s.*, cs.is_active'))return {rows:[shipment]};
    if(q.startsWith('SELECT h.physical_unit_id'))return {rows:options.noBoxes?[]:[
      {physical_unit_id:'box1',market_id:M,outcome_type:null,state:'DISPATCHED'},
      {physical_unit_id:'box2',market_id:M,outcome_type:null,state:'DISPATCHED'}]};
    if(q.startsWith('SELECT id,is_active,freight_kmf,customs_paid_kmf,status FROM customs_shipments'))
      return {rows:[{id:C,is_active:true,freight_kmf:options.duplicateFreight?'100.00':null,
        customs_paid_kmf:options.unknownTax?null:'30.00',status:'declared'}]};
    if(q.startsWith('SELECT id,fee_type,kind,amount_kmf,proof_ref FROM international_shipment_charges'))
      return {rows:fees};
    if(q.startsWith('SELECT id,fee_type,kind,amount_kmf,proof_ref FROM customs_shipment_fees'))
      return {rows:customsFees};
    if(q.startsWith('SELECT snapshot_hash,financial_closed_at'))
      return {rows:prior?[prior]:[]};
    if(q.startsWith('INSERT INTO international_n1_reconciliations')){
      prior={snapshot_hash:params[1],financial_closed_at:params[10]?'now':null};
    }
    return {rows:[],rowCount:1};
  })};
  return {database:{withTransaction:fn=>fn(client)},queries,client};
}
test('marché et admin sont vérifiés avant accès SQL',async()=>{
  const x=fixture();
  await expect(reconcile(market,{id:'operator',role:'market_operator'},'KM-EXP-1',x.database))
    .rejects.toMatchObject({code:'SHIPMENT_COST_FORBIDDEN',status:403});
  await expect(reconcile({id:null,code:'KM'},admin,'KM-EXP-1',x.database))
    .rejects.toBeInstanceOf(ReconciliationError);
  expect(x.queries).toHaveLength(0);
});
test('coûts réels documentés par EXPÉDITION, zéro allocation produit ou marge réécrite',async()=>{
  const x=fixture();
  const r=await reconcile(market,admin,'KM-EXP-1',x.database);
  expect(r).toMatchObject({status:'partial',idempotent:false,documented_total_kmf:'173.68',
    customs_kmf:'30.00',freight_kmf:'123.45',local_kmf:'7.89',allocation_rows:0});
  expect(x.queries.filter(q=>q.q.startsWith('INSERT INTO international_n1_reconciliations'))).toHaveLength(1);
  expect(x.queries.every(q=>!/order_item_real_cost_allocations|international_n1_allocation_links|canonical_margin|parcel_items/i.test(q.q))).toBe(true);
  expect(x.queries.every(q=>!q.q.includes('UPDATE customs_shipments'))).toBe(true);
});
test('relecture du même dossier idempotente et sans double comptage',async()=>{
  const x=fixture();
  await reconcile(market,admin,'KM-EXP-1',x.database);
  const r=await reconcile(market,admin,'KM-EXP-1',x.database);
  expect(r).toMatchObject({idempotent:true,documented_total_kmf:'173.68'});
  expect(x.queries.filter(q=>q.q.startsWith('INSERT INTO international_n1_reconciliations'))).toHaveLength(1);
});
test('douane et transport ne peuvent comptabiliser deux fois le fret',async()=>{
  await expect(reconcile(market,admin,'KM-EXP-1',fixture({duplicateFreight:true}).database))
    .rejects.toMatchObject({code:'SHIPMENT_COST_DUPLICATE_FREIGHT'});
});
test('douane et transport ne peuvent enregistrer deux fois les mêmes frais',async()=>{
  const x=fixture({customsFees:[{id:'d1',fee_type:'handling',kind:'charge',amount_kmf:'10.00',proof_ref:'D-1'}]});
  await expect(reconcile(market,admin,'KM-EXP-1',x.database))
    .rejects.toMatchObject({code:'SHIPMENT_COST_DUPLICATE_FEE_FAMILY'});
});
test('le fret inconnu reste NULL même si les autres postes sont connus',async()=>{
  const x=fixture({unknownFreight:true});
  const r=await reconcile(market,admin,'KM-EXP-1',x.database);
  expect(r).toMatchObject({status:'partial',freight_kmf:null,documented_total_kmf:'50.23',
    missing:expect.arrayContaining(['freight'])});
});
test('sans KOM-BOX, aucune valeur économique annoncée',async()=>{
  await expect(reconcile(market,admin,'KM-EXP-1',fixture({noBoxes:true}).database))
    .rejects.toMatchObject({code:'SHIPMENT_COST_BOX_SCOPE'});
});
test('clôture économique uniquement après relais, factures complètes et preuve',async()=>{
  await expect(reconcile(market,admin,'KM-EXP-1',fixture().database,{close:true,proof_ref:'CL-1'}))
    .rejects.toMatchObject({code:'SHIPMENT_COST_RELAY_REQUIRED'});
  await expect(reconcile(market,admin,'KM-EXP-1',fixture({stage:'relay_received',unknownFreight:true}).database,
    {close:true,proof_ref:'CL-1'}))
    .rejects.toMatchObject({code:'SHIPMENT_COST_INCOMPLETE'});
  const done=await reconcile(market,admin,'KM-EXP-1',fixture({stage:'relay_received'}).database,
    {close:true,proof_ref:'CLOSE-2026'});
  expect(done).toMatchObject({status:'closed',financial_closed:true,allocation_rows:0});
});
test('le coût réel d’un transport aérien peut être constaté sans répartition au poids fictif',async()=>{
  const r=await reconcile(market,admin,'KM-EXP-1',fixture().database);
  expect(r.documented_total_kmf).toBe('173.68');
});
