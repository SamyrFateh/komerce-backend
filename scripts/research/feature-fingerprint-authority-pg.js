#!/usr/bin/env node
'use strict';
/**
 * Feature Fingerprint — authority & conservation (v0.6 R&D).
 * Real logistics writer + PostgreSQL16, disposable komerce_test only.
 * Contracts are inferred from Orders owner identity vs Logistics projection:
 * parcel_items.order_item_id -> order_items.product_id and parcel_items.quantity <= order_items.quantity
 * These are hypotheses until business owner approves. No production/staging traffic.
 */
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{Pool}=require('pg');
const target=new URL(process.env.DATABASE_URL||'');
if(!['localhost','127.0.0.1'].includes(target.hostname)||target.pathname!=='/komerce_test'||process.env.NODE_ENV!=='test'||process.env.KOMERCE_DISABLE_CRONS!=='true')throw Error('Only disposable local komerce_test is permitted');
const ROOT=path.resolve(__dirname,'../..');
const file='services/parcel-item-mutation-service.js';
const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex');
const {assignParcelItem}=require(path.join(ROOT,file));
const uid=()=>crypto.randomUUID();
async function seed(c){
 const v={relais:uid(),order:uid(),item:uid(),product:uid(),otherProduct:uid(),parcel:uid(),ref:'FP-IDENTITY-'+uid().slice(0,10)};
 const m=(await c.query("SELECT id FROM markets WHERE code='KM'")).rows[0];
 assert.ok(m,'KM reference seed required');
 await c.query("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,'FP Authority','FP','+269200001','TEMP',$2)",[v.relais,m.id]);
 await c.query("INSERT INTO products(id,name,price_kmf,stock) VALUES($1,'FP correct',5000,10),($2,'FP different',6000,10)",[v.product,v.otherProduct]);
 await c.query("INSERT INTO orders(id,reference,relais_id,market_id,total_kmf,payment_mode,status) VALUES($1,$2,$3,$4,5000,'cash_relais','ordered')",[v.order,v.ref,v.relais,m.id]);
 await c.query("INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf) VALUES($1,$2,$3,1,5000)",[v.item,v.order,v.product]);
 await c.query("INSERT INTO parcels(id,order_id,relais_id,reference,status,type) VALUES($1,$2,$3,$4,'draft','standard')",[v.parcel,v.order,v.relais,v.ref+'-P']);
 return v;
}
async function observed(c,v){
 const {rows:[x]}=await c.query(`SELECT COUNT(pi.id)::int AS written,
   COUNT(pi.id) FILTER(WHERE pi.product_id<>oi.product_id)::int AS product_mismatch,
   COUNT(pi.id) FILTER(WHERE pi.quantity>oi.quantity)::int AS quantity_excess,
   COUNT(pi.id) FILTER(WHERE p.order_id<>oi.order_id)::int AS order_mismatch
   FROM parcel_items pi
   JOIN order_items oi ON oi.id=pi.order_item_id
   JOIN parcels p ON p.id=pi.parcel_id
   WHERE pi.parcel_id=$1`,[v.parcel]);
 return x;
}
async function main(){
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
 let c,began=false;
 const r={version:6,contracts:[{id:'product_identity_from_order_item',status:'INFERRED_NOT_APPROVED'},{id:'parcel_qty_not_exceed_order_qty',status:'INFERRED_NOT_APPROVED'}],origin:[file,'features/orders.feature.js','features/logistics.feature.js'],sourceHash:hash,cases:[],rollbackVerified:false};
 try{
  c=await pool.connect();assert.equal((await c.query('SELECT current_database() AS db')).rows[0].db,'komerce_test');
  await c.query('BEGIN');began=true;
  const v=await seed(c);await c.query('SAVEPOINT fp_authority_seed');
  for(let round=1;round<=2;round++)for(const variant of ['nominal','different_product','excess_quantity']){
   await c.query('ROLLBACK TO SAVEPOINT fp_authority_seed');
   const productId=variant==='different_product'?v.otherProduct:v.product;
   const qty=variant==='excess_quantity'?2:1;
   const before=await observed(c,v);
   const written=await assignParcelItem(c,{parcelId:v.parcel,orderItemId:v.item,productId,quantity:qty});
   const after=await observed(c,v);
   r.cases.push({round,variant,before,after,writeCount:written.rowCount,authorityViolation:after.product_mismatch>0||after.quantity_excess>0,grounding:'internal writer invocation, not HTTP route'});
  }
 }finally{try{if(c&&began){await c.query('ROLLBACK');r.rollbackVerified=true;}}finally{if(c)c.release();await pool.end()}}
 for(const x of r.cases.filter(x=>x.variant==='nominal')){assert.equal(x.writeCount,1);assert.deepEqual(x.after,{written:1,product_mismatch:0,quantity_excess:0,order_mismatch:0});}
 if(process.env.FP_EXPECT_AUTHORITY_GUARD==='true'){
   for(const x of r.cases.filter(x=>x.variant!=='nominal')){assert.equal(x.after.product_mismatch,0);assert.equal(x.after.quantity_excess,0);assert.equal(x.authorityViolation,false)}
 }
 r.verdict=r.cases.some(c=>c.authorityViolation)?'CROSS_ENTITY_AUTHORITY_MISMATCH_ACCEPTED':'NO_AUTHORITY_VIOLATION_OBSERVED';
 r.evidenceHash=crypto.createHash('sha256').update(JSON.stringify(r.cases)).digest('hex');
 fs.writeFileSync(process.env.FP_AUTHORITY_OUTPUT||'/tmp/feature-fingerprint-authority-pg-proof.json',JSON.stringify(r,null,2)+'\n');
 console.log(JSON.stringify({verdict:r.verdict,scenarios:r.cases.length,violations:r.cases.filter(c=>c.authorityViolation).length,rollback:r.rollbackVerified,hash:r.evidenceHash}));
}
main().catch(e=>{console.error('FP_AUTHORITY_REPLAY_FAILED',e.stack||e);process.exitCode=1;});
