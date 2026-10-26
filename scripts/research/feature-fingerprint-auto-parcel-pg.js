#!/usr/bin/env node
'use strict';
/** Independent R&D experiment for OUTPUT_EFFECT_MISMATCH: active membership vs reported items_assigned.
 * Uses exact production service, disposable PostgreSQL 16, minimal setup, outer ROLLBACK.
 * This is not an end-to-end HTTP or business acceptance test.
 */
const fs=require('node:fs'), path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {Pool}=require('pg');
const dbUrl=new URL(process.env.DATABASE_URL||'');
if(!['localhost','127.0.0.1'].includes(dbUrl.hostname)||dbUrl.pathname!=='/komerce_test'||process.env.NODE_ENV!=='test'||process.env.KOMERCE_DISABLE_CRONS!=='true')
 throw Error('Local disposable komerce_test required, with crons disabled');
const ROOT=path.resolve(__dirname,'../..');
const SOURCE='services/auto-parcel.js',src=fs.readFileSync(path.join(ROOT,SOURCE),'utf8');
const sourceHash=crypto.createHash('sha256').update(src).digest('hex');
const {distributeOrder}=require(path.join(ROOT,SOURCE));
const uid=()=>crypto.randomUUID();
async function makeSeed(db){
 const v={relay:uid(),product:uid(),order:uid(),item:uid(),ref:'FP-AP-'+uid().slice(0,12)};
 const {rows:[m]}=await db.query("SELECT id FROM markets WHERE code='KM'");assert.ok(m,'market KM missing');
 await db.query("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,'FP auto-parcel','FP','+269100001','TEMP',$2)",[v.relay,m.id]);
 await db.query("INSERT INTO products(id,name,price_kmf,stock) VALUES($1,'FP dummy',5000,20)",[v.product]);
 await db.query("INSERT INTO orders(id,reference,relais_id,market_id,total_kmf,payment_mode,status) VALUES($1,$2,$3,$4,5000,'stripe_eur','ordered')",[v.order,v.ref,v.relay,m.id]);
 await db.query("INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf) VALUES($1,$2,$3,1,5000)",[v.item,v.order,v.product]);
 return v;
}
async function snapshot(db,v){
 const {rows:[r]}=await db.query(`SELECT
  COUNT(pi.id) FILTER(WHERE p.status <> 'cancelled')::int AS active,
  COUNT(pi.id) FILTER(WHERE p.status = 'cancelled')::int AS cancelled,
  COUNT(DISTINCT p.id) FILTER(WHERE p.status <> 'cancelled')::int AS active_parcels
  FROM parcels p LEFT JOIN parcel_items pi ON pi.parcel_id=p.id
  LEFT JOIN order_items oi ON oi.id=pi.order_item_id
  WHERE (oi.order_id=$1 OR p.order_id=$1)`,[v.order]);
 return {active:r.active,cancelled:r.cancelled,active_parcels:r.active_parcels};
}
async function main(){
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,application_name:'feature-fingerprint-auto-parcel'});
 let client,began=false;const report={version:1,codeSource:SOURCE,sourceSha256:sourceHash,postgres:true,fullHttp:false,scenarioCount:0,contract:'items_assigned is new active persisted assignments',approved:false,cases:[],rollbackVerified:false};
 try{
  client=await pool.connect();
  assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name,'komerce_test');
  const constraint=await client.query("SELECT 1 FROM pg_constraint WHERE conname='unique_order_item_per_parcel'");
  assert.ok(constraint.rowCount>0,'Expected unique order_item invariant absent');
  await client.query('BEGIN');began=true;
  const v=await makeSeed(client);
  await client.query('SAVEPOINT fp_autoparcel_seed');
  for(let rep=1;rep<=2;rep++)for(const scenario of ['nominal','cancelled_parcel']){
   await client.query('ROLLBACK TO SAVEPOINT fp_autoparcel_seed');
   if(scenario==='cancelled_parcel'){
    const {rows:[p]}=await client.query("INSERT INTO parcels(reference,order_id,relais_id,status,type) VALUES($1,$2,$3,'cancelled','standard') RETURNING id",[v.ref+'-C',v.order,v.relay]);
    await client.query('INSERT INTO parcel_items(parcel_id,order_item_id,product_id,quantity) VALUES($1,$2,$3,1)',[p.id,v.item,v.product]);
   }
   const before=await snapshot(client,v);
   const result=await distributeOrder(v.order,client);
   const after=await snapshot(client,v);
   const delta=after.active-before.active;
   const announced=Number(result.items_assigned||0);
   const contradiction=result.success===true && !result.already_assigned && !result.queued && announced!==delta;
   report.cases.push({rep,scenario,request:{orderItems:1},before,after,
    response:{success:result.success,already_assigned:!!result.already_assigned,queued:!!result.queued,parcel_created:!!result.parcel_created,items_assigned:announced},
    actualNewActive:delta,contradiction});
  }
 }finally{
  try{if(began&&client){await client.query('ROLLBACK');report.rollbackVerified=true}}finally{if(client)client.release();await pool.end()}
 }
 report.scenarioCount=report.cases.length;
 const nom=report.cases.filter(c=>c.scenario==='nominal');
 assert.equal(nom.length,2);for(const c of nom){assert.equal(c.actualNewActive,1);assert.equal(c.response.items_assigned,1);assert.equal(c.contradiction,false)}
 if(process.env.FP_EXPECT_FAIL_CLOSED==='true'){
  const cancelled=report.cases.filter(c=>c.scenario==='cancelled_parcel');
  assert.equal(cancelled.length,2);
  for(const c of cancelled){
    assert.equal(c.response.success,false,'cancelled parcel must not be announced distributed');
    assert.equal(c.actualNewActive,0);
    assert.equal(c.after.active_parcels,0,'refused redistributions must not create ghost parcels');
    assert.equal(c.contradiction,false);
  }
 }
 report.verdict=report.cases.some(c=>c.contradiction)?'UNAPPROVED_CONTRADICTION':'NO_VIOLATION_OBSERVED';
 report.evidenceHash=crypto.createHash('sha256').update(JSON.stringify(report.cases)).digest('hex');
 const out=path.resolve(process.env.FP_AUTOPARCEL_OUTPUT||'/tmp/feature-fingerprint-auto-parcel-pg-proof.json');
 fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({verdict:report.verdict,rollbackVerified:report.rollbackVerified,contradictions:report.cases.filter(c=>c.contradiction).length,cases:report.scenarioCount,evidenceHash:report.evidenceHash}));
}
main().catch(err=>{console.error('AUTO_PARCEL_REPLAY_FAILED',err.stack||err.message);process.exitCode=1;});
