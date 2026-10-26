#!/usr/bin/env node
'use strict';
// R&D: actual unsold resolve route handler + actual PostgreSQL 16, outer ROLLBACK.
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {Pool}=require('pg');
const dbUrl=new URL(process.env.DATABASE_URL||'');
if(!['localhost','127.0.0.1'].includes(dbUrl.hostname)||dbUrl.pathname!=='/komerce_test'||process.env.NODE_ENV!=='test'||process.env.KOMERCE_DISABLE_CRONS!=='true')
  throw Error('Refusing to run outside disposable local komerce_test');
const ROOT=path.resolve(__dirname,'../..'), sourcePath='routes/unsold.js';
const source=fs.readFileSync(path.join(ROOT,sourcePath),'utf8');
const sourceSha256=crypto.createHash('sha256').update(source).digest('hex');
const start=source.indexOf("router.post('/:id/resolve'");
const end=source.indexOf("router.get('/:id/whatsapp'",start);
if(start<0||end<0)throw Error('Could not find canonical resolve handler');
function actualHandler(db){
 let fn;
 vm.runInNewContext(source.slice(start,end),{
    router:{post:(p,...m)=>{if(p==='/:id/resolve')fn=m.at(-1)}},
    db,authenticate:()=>{},requireAdmin:()=>{},console,
 },{filename:sourcePath,timeout:1000});
 if(typeof fn!=='function')throw Error('Handler extract failure');
 return async(id,status)=>{
   let code=200,body,err;
   await fn({params:{id},body:{status,resolved_price_kmf:1100,reseller_id:null,notes:null}},
     {status(s){code=s;return this},json(v){body=v;return this}},e=>{err=e||Error('next called')});
   if(err)throw err;
   return {code,body:{status:body?.status,resolvedAt:body?.resolved_at==null?null:String(body.resolved_at)}};
 };
}
const uid=()=>crypto.randomUUID();
async function fixture(db){
 const f={relay:uid(),order:uid(),item:uid(),ref:'FP-UNS-'+uid().slice(0,10)};
 const market=(await db.query("SELECT id FROM markets WHERE code='KM'")).rows[0];assert.ok(market,'KM missing');
 await db.query("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,'FP unsold','FP','+269100000','TEMP',$2)",[f.relay,market.id]);
 await db.query("INSERT INTO orders(id,reference,relais_id,market_id,total_kmf,payment_mode,status) VALUES($1,$2,$3,$4,4000,'cash_relais','available')",[f.order,f.ref,f.relay,market.id]);
 await db.query("INSERT INTO unsold_items(id,order_id,product_name,original_price_kmf,unsold_price_kmf,status) VALUES($1,$2,'FP product',4000,3000,'available')",[f.item,f.order]);
 return f;
}
async function read(db,id){
 const {rows:[r]}=await db.query("SELECT status,resolved_at,resolved_price_kmf FROM unsold_items WHERE id=$1",[id]);
 return {status:r.status,resolved_at:r.resolved_at==null?null:r.resolved_at.toISOString(),resolved_price_kmf:r.resolved_price_kmf==null?null:Number(r.resolved_price_kmf)};
}
async function main(){
 let client,began=false;
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
 const report={version:1,kind:'TERMINAL_STATE_IMMUTABILITY',source:sourcePath,sourceSha256,
  contractSource:'features/unsold-resolution.feature.js classification lifecycle: available -> four terminal states, irreversible',
  contractApproved:false,authExecuted:false,fullHttpExecuted:false,cases:[],rollbackVerified:false};
 try{
  client=await pool.connect(); assert.equal((await client.query('SELECT current_database() AS db')).rows[0].db,'komerce_test');
  await client.query('BEGIN');began=true;
  const f=await fixture(client);
  await client.query('SAVEPOINT fp_unsold_base');
  const run=actualHandler(client);
  for(let rep=1;rep<=2;rep++){
   for(const scenario of ['nominal_available_to_terminal','mutation_terminal_to_terminal']){
    await client.query('ROLLBACK TO SAVEPOINT fp_unsold_base');
    if(scenario==='mutation_terminal_to_terminal'){
       await client.query("UPDATE unsold_items SET status='sold_whatsapp',resolved_at='2026-01-02T00:00:00Z',resolved_price_kmf=1800 WHERE id=$1",[f.item]);
    }
    const before=await read(client,f.item);
    const response=await run(f.item,scenario==='nominal_available_to_terminal'?'sold_whatsapp':'destroyed');
    const after=await read(client,f.item);
    report.cases.push({rep,scenario,before,response,after,contradiction:before.status!=='available'&&(after.status!==before.status||after.resolved_at!==before.resolved_at)});
   }
  }
 }finally{
  try{if(client&&began){await client.query('ROLLBACK');report.rollbackVerified=true}}finally{if(client)client.release();await pool.end()}
 }
 assert.equal(report.cases.length,4);
 for(const c of report.cases.filter(c=>c.scenario==='nominal_available_to_terminal')){assert.equal(c.response.code,200);assert.equal(c.after.status,'sold_whatsapp');assert.equal(c.contradiction,false)}
 if(process.env.FP_EXPECT_TERMINAL_GUARD==='true'){
  for(const c of report.cases.filter(c=>c.scenario==='mutation_terminal_to_terminal')){assert.equal(c.response.code,409);assert.equal(c.after.status,c.before.status);assert.equal(c.after.resolved_at,c.before.resolved_at);assert.equal(c.contradiction,false)}
 }
 report.verdict=report.cases.some(c=>c.contradiction)?'UNAPPROVED_TERMINAL_CONTRADICTION':'NO_VIOLATION_OBSERVED';
 report.evidenceHash=crypto.createHash('sha256').update(JSON.stringify(report.cases)).digest('hex');
 const target=path.resolve(process.env.FP_UNSOLD_OUTPUT||'/tmp/feature-fingerprint-unsold-terminal-pg-proof.json');
 fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({verdict:report.verdict,cases:report.cases.length,violations:report.cases.filter(c=>c.contradiction).length,rollback:report.rollbackVerified,hash:report.evidenceHash}));
}
main().catch(e=>{console.error('UNSOLD_TERMINAL_REPLAY_FAILED',e.stack||e);process.exitCode=1});
