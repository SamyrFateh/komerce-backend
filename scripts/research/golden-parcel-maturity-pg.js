#!/usr/bin/env node
'use strict';
// R&D: compare canonical parcel membership and economic maturity on same order.
// Only disposable PostgreSQL 16. All seed writes rolled back.
const crypto=require('node:crypto'),assert=require('node:assert/strict'),fs=require('node:fs'),{Pool}=require('pg');
const {getOrderMaturity}=require('../../services/pricing-maturity');
const {listParcelsRepresentingOrder}=require('../../services/parcel-order-membership');
const url=new URL(process.env.DATABASE_URL||'');
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/komerce_test'||process.env.NODE_ENV!=='test'||process.env.KOMERCE_DISABLE_CRONS!=='true')throw Error('ISOLATED TEST DB ONLY');
const id=()=>crypto.randomUUID();
async function fixture(c,sharing,mId){
 const a=id(),b=id(),item=id(),prod=id(),relais=id(),parcel=id();
 await c.query("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,'FP maturity','FP','+269000001','TEMP',$2)",[relais,mId]);
 await c.query("INSERT INTO products(id,name,price_kmf,stock) VALUES($1,'FP',5000,10)",[prod]);
 for(const oid of [a,b])await c.query("INSERT INTO orders(id,reference,relais_id,market_id,total_kmf,payment_mode,status,payment_status) VALUES($1,$2,$3,$4,5000,'stripe_eur','collected','paid')",[oid,'FP-'+oid.slice(0,14),relais,mId]);
 await c.query("INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,fulfillment_source) VALUES($1,$2,$3,1,5000,'IMPORT')",[item,b,prod]);
 await c.query("INSERT INTO parcels(id,order_id,relais_id,reference,status,type) VALUES($1,$2,$3,$4,'collected','standard')",[parcel,sharing?a:b,relais,'FP-P-'+parcel.slice(0,12)]);
 await c.query("INSERT INTO parcel_items(parcel_id,order_item_id,product_id,quantity) VALUES($1,$2,$3,1)",[parcel,item,prod]);
 return {a,b,item,parcel};
}
async function main(){
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
 let c,begun=false;
 const out={schema:'fp-parcel-membership-economic-maturity/v1',
  source:['services/parcel-order-membership.js','services/pricing-maturity.js'],
  expected:'one parcel representing order B must count for order B even if carrier parcels.order_id=A',
  proofLevel:'ISOLATED_PG_REAL_SERVICES',cases:[],rollbackVerified:false};
 try{
  c=await pool.connect();assert.equal((await c.query('SELECT current_database() name')).rows[0].name,'komerce_test');
  await c.query('BEGIN');begun=true;
  const market=(await c.query("SELECT id FROM markets WHERE code='KM' LIMIT 1")).rows[0];assert.ok(market);
  for(let round=1;round<=2;round++)for(const sharing of [false,true]){
   const x=await fixture(c,sharing,market.id);
   const physical=await listParcelsRepresentingOrder(c,x.b,{columns:'p.id, p.status',excludeCancelled:true});
   const maturity=await getOrderMaturity(x.b,c);
   const criterion=maturity.criteria.find(k=>k.code==='parcel_flow_closed');
   assert.ok(criterion,'maturity parcel criterion absent');
   const evidence=criterion.evidence;
   out.cases.push({round,scenario:sharing?'shared_carrier_A_line_B':'owned_carrier_B_line_B',
    canonicalMembership:physical.length,maturityParcelCount:evidence.parcel_count,
    maturityCollectedCount:evidence.collected_parcel_count,
    divergent:physical.length!==evidence.parcel_count});
  }
 }finally{try{if(begun&&c){await c.query('ROLLBACK');out.rollbackVerified=true}}finally{if(c)c.release();await pool.end()}}
 for(const x of out.cases.filter(x=>x.scenario==='owned_carrier_B_line_B')){assert.equal(x.canonicalMembership,1);assert.equal(x.maturityParcelCount,1);}
 if(process.env.FP_EXPECT_PARCEL_MEMBERSHIP_GUARD==='true')for(const x of out.cases)assert.equal(x.divergent,false);
 out.verdict=out.cases.some(x=>x.divergent)?'MATURITY_PARCEL_MEMBERSHIP_ASYMMETRY':'NO_MEMBERSHIP_ASYMMETRY';
 out.digest=crypto.createHash('sha256').update(JSON.stringify(out.cases)).digest('hex');
 fs.writeFileSync(process.env.FP_MATURITY_OUTPUT||'/tmp/fp-maturity-membership.json',JSON.stringify(out,null,2)+'\n');
 console.log('FP_MATURITY_MEMBERSHIP_PROOF '+JSON.stringify({verdict:out.verdict,cases:out.cases,rollbackVerified:out.rollbackVerified}));
}
main().catch(e=>{console.error('FP_MATURITY_PROOF_FAILED',e.stack||e);process.exitCode=1});
