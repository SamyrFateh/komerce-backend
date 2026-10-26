#!/usr/bin/env node
'use strict';
/**
 * R&D ECO read-only Golden checkout authority A/B backed by transaction-local PG fixtures.
 * All fixture writes rolled back; no external traffic and no checkout/payment actions.
 */
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {Pool}=require('pg');
const {loadCheckoutOriginGate}=require('../../services/golden-checkout-thread');
const target=new URL(process.env.DATABASE_URL||'');
if(!['localhost','127.0.0.1'].includes(target.hostname)||target.pathname!=='/komerce_test'
 ||process.env.NODE_ENV!=='test'||process.env.KOMERCE_DISABLE_CRONS!=='true')
 throw Error('Only isolated local komerce_test, test mode, no crons');
const uuid=()=>crypto.randomUUID();
const sourceSha256=crypto.createHash('sha256')
 .update(fs.readFileSync(path.resolve(__dirname,'../../services/golden-checkout-thread.js'))).digest('hex');
async function fixture(db){
 const x={user:uuid(),recipient:uuid(),relay:uuid(),product:uuid(),sku:uuid(),order:uuid(),ref:'FP-GOLDEN-'+uuid().slice(0,8)};
 const market=(await db.query("SELECT id,code FROM markets WHERE code='CM' AND is_active=true LIMIT 1")).rows[0];
 assert.ok(market,'Active CM market required in canonical bootstrap');
 x.market=market.id;
 const phone='+269'+String(Math.floor(Math.random()*1e8)).padStart(8,'0');
 await db.query("INSERT INTO users(id,full_name,role,phone) VALUES($1,'Fingerprint customer','client',$2)",[x.user,phone]);
 await db.query("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,'FP Golden','FP','+269123456','TEMP',$2)",[x.relay,x.market]);
 await db.query("INSERT INTO recipients(id,user_id,full_name,phone,relais_id) VALUES($1,$2,'FP Recipient',$3,$4)",[x.recipient,x.user,phone,x.relay]);
 await db.query("INSERT INTO products(id,name,price_kmf,stock) VALUES($1,'FP Product',5000,10)",[x.product]);
 await db.query("INSERT INTO product_skus(id,product_id,sku,supplier_unit_ref,stock) VALUES($1,$2,'FP-UNIT','FPU',10)",[x.sku,x.product]);
 await db.query(`INSERT INTO orders(id,reference,user_id,recipient_id,relais_id,market_id,total_kmf,payment_mode,status)
   VALUES($1,$2,$3,$4,$5,$6,5000,'cash_relais','pending')`,
  [x.order,x.ref,x.user,x.recipient,x.relay,x.market]);
 await db.query("INSERT INTO order_items(order_id,product_id,sku_id,quantity,price_kmf,customs_category_key) VALUES($1,$2,$3,1,5000,'maison')",[x.order,x.product,x.sku]);
 const {rows:[o]}=await db.query('SELECT created_at FROM orders WHERE id=$1',[x.order]);
 // Earlier than any optional automatic history event, so it is the canonical birth.
 await db.query("INSERT INTO order_status_history(order_id,status,changed_by,note,created_at) VALUES($1,'pending',$2,'Commande créée',$3)",[x.order,x.user,new Date(o.created_at.getTime()-1000)]);
 await db.query(`INSERT INTO otp_codes(id,phone,code,expires_at,verified,consumed_at,purpose)
   SELECT COALESCE(MAX(id),0)+1,$1,'999999',now()+interval '1 day',true,$2,'login'
   FROM otp_codes`,[phone,new Date(o.created_at.getTime()-2000)]);
 const {rows:[base]}=await db.query(`SELECT o.id,o.reference,o.user_id,o.status::text AS status,
    o.payment_status::text AS payment_status,o.payment_mode,o.recipient_id,o.relais_id,
    o.total_kmf,o.stripe_payment_id,o.created_at,m.code AS market_code
    FROM orders o JOIN markets m ON m.id=o.market_id WHERE o.id=$1`,[x.order]);
 return {x,base};
}
async function main(){
 let client,began=false;
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,application_name:'golden-market-boundary-proof'});
 const proof={schema:'golden-cross-market-pg-proof/v1',execution:'CANONICAL_PROJECTION_WITH_REAL_PG',sourceSha256,
   evidenceLevel:'L4_ISOLATED',httpExecuted:false,financialEffectExecuted:false,rollbackVerified:false,cases:[]};
 try{
  client=await pool.connect();
  assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name,'komerce_test');
  await client.query('BEGIN');began=true;
  const {x,base}=await fixture(client);
  const common={orderReference:x.ref,productId:x.product,base,storefrontGate:{evidence:{price_kmf:5000}}};
  for(let repeat=1;repeat<=2;repeat++){
   for(const [variant,marketCode] of [['nominal','CM'],['cross_market','KM']]){
    const result=await loadCheckoutOriginGate(client,{...common,marketCode});
    proof.cases.push({repeat,variant,selected_market:marketCode,canonical_order_market:base.market_code,
      status:result.status,check:result.checks.find(k=>k.key==='order_matches_selected_market')?.ok??null,
      anomalyCount:result.anomalies?.length||0});
   }
  }
 } finally {
  try{if(began&&client){await client.query('ROLLBACK');proof.rollbackVerified=true;}}
  finally{if(client)client.release();await pool.end();}
 }
 assert.equal(proof.cases.length,4);
 for(const c of proof.cases.filter(x=>x.variant==='nominal')){
  assert.equal(c.status,'PROVED');assert.equal(c.check,true);
 }
 for(const c of proof.cases.filter(x=>x.variant==='cross_market')){
  assert.equal(c.status,'ANOMALIE');assert.equal(c.check,false);
 }
 proof.verdict='CONSISTENT_AFTER_AUTHORITY_GUARD';
 proof.digest=crypto.createHash('sha256').update(JSON.stringify(proof.cases)).digest('hex');
 fs.writeFileSync(process.env.FP_GOLDEN_PG_OUTPUT||'/tmp/golden-cross-market-pg-proof.json',JSON.stringify(proof,null,2)+'\n');
 console.log(JSON.stringify({verdict:proof.verdict,cases:proof.cases,rollbackVerified:proof.rollbackVerified,digest:proof.digest}));
}
main().catch(e=>{console.error('GOLDEN_PG_REPLAY_FAILED',e.stack||e);process.exitCode=1});
