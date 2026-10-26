#!/usr/bin/env node
'use strict';
// Feature fingerprint R&D — provider/physical-offer market authority.
// Real createPhysicalOffer body in VM (its db binding is disposable PG client).
// Only internal service semantics; no HTTP reachability implied.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{Pool}=require('pg');
const url=new URL(process.env.DATABASE_URL||'');
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/komerce_test'||process.env.NODE_ENV!=='test'||process.env.KOMERCE_DISABLE_CRONS!=='true')throw Error('Disposable local komerce_test required');
const ROOT=path.resolve(__dirname,'../..');
const source=fs.readFileSync(path.join(ROOT,'services/providers-service.js'),'utf8');
const start=source.indexOf('async function createPhysicalOffer('),end=source.indexOf('async function getPhysicalOffer(',start);
if(start<0||end<0)throw Error('Service extraction boundary missing');
const sha=crypto.createHash('sha256').update(source).digest('hex'),uid=()=>crypto.randomUUID();
function realServiceWithInjectedDb(client){
 const context={
  db:client,PROVIDER_STATUS:{ACTIVE:'active'},PHYSICAL_OFFER_STATUS:{DRAFT:'draft'},
  getProvider:async providerId=>(await client.query('SELECT * FROM providers WHERE id=$1',[providerId])).rows[0]||null,
  Error,
 };
 return vm.runInNewContext('('+source.slice(start,end).trim()+')',context,{timeout:1000});
}
async function experiment(){
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
 const report={schema:'fingerprint-providers-authority-ab/v1',source:'services/providers-service.js',sourceSha256:sha,mode:'real-service-body+injected-real-transactional-db',httpTested:false,contractApproved:false,cases:[],rollbackVerified:false};
 let c,open=false;
 try{
  c=await pool.connect(); assert.equal((await c.query('SELECT current_database() AS db')).rows[0].db,'komerce_test');
  await c.query('BEGIN');open=true;
  const markets=await c.query("SELECT id,code FROM markets WHERE code IN ('KM','CM') AND is_active=true");
  let a=markets.rows.find(x=>x.code==='KM'),b=markets.rows.find(x=>x.code==='CM');
  assert.ok(a,'Active KM market absent');
  if(!b){
   b=(await c.query("INSERT INTO markets(code,name,currency,lifecycle_status,is_active) VALUES ('ZZ','Fingerprint secondary test','XAF','ACTIVE',true) RETURNING id,code")).rows[0];
  }
  const provider=uid();
  await c.query("INSERT INTO providers(id,name,phone,market_id,status) VALUES($1,'FP Test Provider','+269987654',$2,'active')",[provider,a.id]);
  await c.query('SAVEPOINT fp_provider_seed');
  const create=realServiceWithInjectedDb(c);
  for(let repeat=1;repeat<=2;repeat++)for(const variant of ['nominal_same_market','foreign_market']){
    await c.query('ROLLBACK TO SAVEPOINT fp_provider_seed');
    const chosen=variant==='foreign_market'?b:a;
    let response=null,thrown=null;
    try{response=await create({providerId:provider,title:'FP isolated physical offer',marketId:chosen.id});}catch(e){thrown=String(e.message);}
    const {rows}=await c.query("SELECT po.id, po.market_id, p.market_id AS provider_market_id FROM physical_offers po JOIN providers p ON p.id=po.provider_id WHERE po.provider_id=$1",[provider]);
    report.cases.push({repeat,variant,providerMarket:a.code,targetMarket:chosen.code,attemptAccepted:!!response,throwMessage:thrown,writtenRows:rows.length,marketMismatch:rows.some(x=>x.market_id!==x.provider_market_id)});
  }
 }finally{
  try{if(c&&open){await c.query('ROLLBACK');report.rollbackVerified=true}}finally{if(c)c.release();await pool.end()}
 }
 for(const x of report.cases.filter(x=>x.variant==='nominal_same_market')){assert.equal(x.attemptAccepted,true);assert.equal(x.writtenRows,1);assert.equal(x.marketMismatch,false);}
 if(process.env.FP_EXPECT_PROVIDER_GUARD==='true'){
  for(const x of report.cases.filter(x=>x.variant==='foreign_market')){assert.equal(x.attemptAccepted,false,'cross-market insert must refuse');assert.equal(x.writtenRows,0);assert.equal(x.marketMismatch,false);}
 }
 report.verdict=report.cases.some(x=>x.marketMismatch)?'CROSS_MARKET_PROVIDER_OFFER_CONTRADICTION':'NO_CROSS_MARKET_VIOLATION';
 report.digest=crypto.createHash('sha256').update(JSON.stringify(report.cases)).digest('hex');
 fs.writeFileSync(process.env.FP_PROVIDER_OUTPUT||'/tmp/feature-fingerprint-provider-market-pg-proof.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({verdict:report.verdict,cases:report.cases.length,violations:report.cases.filter(x=>x.marketMismatch).length,rollbackVerified:report.rollbackVerified,digest:report.digest}));
}
experiment().catch(e=>{console.error('FP_PROVIDER_TEST_FAILED',e.stack||e);process.exitCode=1});
