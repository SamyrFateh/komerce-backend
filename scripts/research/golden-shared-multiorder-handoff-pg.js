#!/usr/bin/env node
'use strict';
/**
 * R&D ECO — shared parcel A+B: handoff scans versus economic parcel criterion.
 * The same true parcel contains order items from two distinct orders.
 * Safe: local komerce_test only, all fixtures inside one ROLLBACK.
 * No assertion equating "parcel flow closed" with proof of individual customer handoff.
 */
const crypto=require('node:crypto'),assert=require('node:assert/strict'),fs=require('node:fs'),{Pool}=require('pg');
const {listParcelsRepresentingOrder}=require('../../services/parcel-order-membership');
const {reconcileCustomerHandoff}=require('../../services/customer-handoff-reconciliation');
const {getOrderMaturity}=require('../../services/pricing-maturity');
const u=new URL(process.env.DATABASE_URL||'');
if(!['localhost','127.0.0.1'].includes(u.hostname)||u.pathname!=='/komerce_test'
 ||process.env.NODE_ENV!=='test'||process.env.KOMERCE_DISABLE_CRONS!=='true')
 throw Error('ISOLATED_LOCAL_KOMERCE_TEST_ONLY');
const id=()=>crypto.randomUUID();
async function seed(c,marketId,{status,proofA,proofB},round,scenario){
 const relay=id(),product=id(),A=id(),B=id(),itemA=id(),itemB=id(),parcel=id();
 await c.query("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,'FP Shared','FP','+269002030','TEMP',$2)",[relay,marketId]);
 await c.query("INSERT INTO products(id,name,price_kmf,stock) VALUES($1,'FP Product',5000,10)",[product]);
 for(const oid of [A,B]){
  await c.query("INSERT INTO orders(id,reference,relais_id,market_id,total_kmf,payment_mode,status,payment_status) VALUES($1,$2,$3,$4,5000,'stripe_eur',$5,'paid')",[oid,'FP-'+oid.slice(0,12),relay,marketId,status==='collected'?'collected':'available']);
 }
 for(const [item,oid] of [[itemA,A],[itemB,B]]){
  await c.query("INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,fulfillment_source) VALUES($1,$2,$3,1,5000,'IMPORT')",[item,oid,product]);
  // Positive relay snapshot makes parcel_flow_closed APPLICABLE.
  // No actual settlement is created: mature MUST remain false.
  await c.query(`INSERT INTO order_item_cost_imputations(order_id,order_item_id,product_id,quantity,sale_unit_price_kmf,sale_total_kmf,cost_breakdown)
    VALUES($1,$2,$3,1,5000,5000,$4::jsonb)`,[oid,item,product,JSON.stringify({landed_relay:{relay:200}})]);
 }
 await c.query("INSERT INTO parcels(id,order_id,relais_id,reference,status,type) VALUES($1,$2,$3,$4,$5,'standard')",[parcel,A,relay,'FP-MIX-'+parcel.slice(0,12),status]);
 for(const item of [itemA,itemB])await c.query("INSERT INTO parcel_items(parcel_id,order_item_id,product_id,quantity) VALUES($1,$2,$3,1)",[parcel,item,product]);
 for(const [orderId,isValid] of [[A,proofA],[B,proofB]]){
  if(!isValid)continue;
  await c.query(`INSERT INTO scans(order_id,parcel_id,step,scan_code,pickup_method,pickup_relais_id)
    VALUES($1,$2,'collected',$3,'PICKUP_CODE',$4)`,[orderId,parcel,'FP-SCAN-'+id().slice(0,10),relay]);
 }
 return {A,B,parcel,itemA,itemB,scenario,round,status};
}
async function observed(c,x,oid,label){
 const members=await listParcelsRepresentingOrder(c,oid,{columns:'p.id, p.status',excludeCancelled:true});
 const handoff=await reconcileCustomerHandoff(c,{orderId:oid});
 const maturity=await getOrderMaturity(oid,c);
 const criterion=maturity?.criteria?.find(v=>v.code==='parcel_flow_closed');
 assert.ok(criterion,'Economic parcel closure criterion missing');
 return {order:label,order_id:oid,parcel_id:x.parcel,canonicalMembership:members.length,
  handoff:handoff.verdict,handoffReason:handoff.reason,
  proofCount:handoff.proofs.length,invalidProofCount:handoff.invalid_proofs.length,
  maturityParcelCount:criterion.evidence.parcel_count,
  maturityCollectedCount:criterion.evidence.collected_parcel_count,
  parcelCriterionApplicable:criterion.applicable,parcelCriterionSatisfied:criterion.satisfied,
  fullyEconomicallyMature:maturity.mature,
  membershipParity:members.length===criterion.evidence.parcel_count};
}
async function main(){
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
 const cases=[
  {key:'BOTH_PROVED',status:'collected',proofA:true,proofB:true},
  {key:'ONLY_A_PROVED',status:'collected',proofA:true,proofB:false},
  {key:'AVAILABLE_UNCOLLECTED',status:'available',proofA:false,proofB:false},
  {key:'CANCELLED_UNCOLLECTED',status:'cancelled',proofA:false,proofB:false},
 ];
 const proof={schema:'fp-shared-multiorder-handoff-maturity/v1',contractApproval:'UNAPPROVED',
  evidenceLevel:'CANONICAL_READONLY_SERVICES_REAL_PG',
  doctrine:'parcel membership is shared; pickup proof must be order scoped; maturity parcel closure is not handoff proof',
  cases:[],rollbackVerified:false};
 let c,started=false;
 try{
  c=await pool.connect();assert.equal((await c.query('SELECT current_database() AS db')).rows[0].db,'komerce_test');
  await c.query('BEGIN');started=true;
  const market=(await c.query("SELECT id FROM markets WHERE code='KM' LIMIT 1")).rows[0];assert.ok(market);
  for(let round=1;round<=2;round++)for(const scenario of cases){
    const x=await seed(c,market.id,scenario,round,scenario.key);
    const a=await observed(c,x,x.A,'A'),b=await observed(c,x,x.B,'B');
    const row={round,scenario:scenario.key,carrier_order:'A',parcel_status:scenario.status,
      ordered_lines:2,actual_line_owners:['A','B'],A:a,B:b};
    proof.cases.push(row);
    // Approved local test oracles: independent facts (membership, proofs, stage).
    for(const v of [a,b]){
      assert.equal(v.membershipParity,true,'Order parcel membership must match maturity parcel count');
      assert.equal(v.parcelCriterionApplicable,true,'Relay fee snapshot makes parcel flow closure applicable');
      assert.equal(v.fullyEconomicallyMature,false,'No real relay settlement was created');
    }
    if(scenario.status==='cancelled'){
      for(const v of [a,b]){
        assert.equal(v.canonicalMembership,0);
        assert.equal(v.parcelCriterionSatisfied,false);
        assert.equal(v.handoff,'HANDOFF_PENDING');
      }
    }else{
      for(const v of [a,b])assert.equal(v.canonicalMembership,1);
      const closed=scenario.status==='collected';
      assert.equal(a.parcelCriterionSatisfied,closed);
      assert.equal(b.parcelCriterionSatisfied,closed);
    }
    if(scenario.key==='BOTH_PROVED'){
      assert.equal(a.handoff,'HANDOFF_MATCHED');assert.equal(b.handoff,'HANDOFF_MATCHED');
      assert.equal(a.proofCount,1);assert.equal(b.proofCount,1);
    }
    if(scenario.key==='ONLY_A_PROVED'){
      assert.equal(a.handoff,'HANDOFF_MATCHED');
      assert.equal(b.handoff,'HANDOFF_MISMATCH');
      assert.equal(b.handoffReason,'CUSTOMER_HANDOFF_COLLECTED_WITHOUT_PROOF');
      assert.equal(b.proofCount,0);
    }
    if(scenario.key==='AVAILABLE_UNCOLLECTED'){
      assert.equal(a.handoff,'HANDOFF_PENDING');assert.equal(b.handoff,'HANDOFF_PENDING');
    }
  }
 }finally{try{if(c&&started){await c.query('ROLLBACK');proof.rollbackVerified=true}}finally{if(c)c.release();await pool.end()}}
 proof.verdict='ALL_APPROVED_SCENARIOS_CONFORM' ;
 proof.digest=crypto.createHash('sha256').update(JSON.stringify(proof.cases)).digest('hex');
 fs.writeFileSync(process.env.FP_MULTIORDER_OUTPUT||'/tmp/fp-multiorder-cross-projections.json',JSON.stringify(proof,null,2)+'\n');
 console.log('FP_MULTIORDER_PROOF '+JSON.stringify({verdict:proof.verdict,caseCount:proof.cases.length,
  cases:proof.cases.map(x=>({scenario:x.scenario,A:{handoff:x.A.handoff,parcel:x.A.maturityParcelCount,closed:x.A.parcelCriterionSatisfied},
    B:{handoff:x.B.handoff,parcel:x.B.maturityParcelCount,closed:x.B.parcelCriterionSatisfied}})),
  rollbackVerified:proof.rollbackVerified}));
}
main().catch(err=>{console.error('FP_MULTIORDER_FAILED',err.stack||err);process.exitCode=1});
