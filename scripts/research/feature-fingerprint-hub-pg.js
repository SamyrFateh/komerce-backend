#!/usr/bin/env node
'use strict';
// R&D ECO: real Komerce JS route and writers, actual disposable PostgreSQL,
// outer ROLLBACK; middleware/auth and complete HTTP stack not exercised.
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const crypto=require('node:crypto'), assert=require('node:assert/strict');
const {Pool}=require('pg');
const ROOT=path.resolve(__dirname,'../..');
const dbUrl=new URL(process.env.DATABASE_URL||'');
if(!['127.0.0.1','localhost'].includes(dbUrl.hostname)||dbUrl.pathname!=='/komerce_test')throw Error('Refusing non-local/non-test DB');
if(process.env.NODE_ENV!=='test'||process.env.KOMERCE_DISABLE_CRONS!=='true')throw Error('Test-only environment required');
const sources=['routes/hub-dashboard.js','services/parcel-item-mutation-service.js','services/parcel-mutation-service.js'];
const provenance=Object.fromEntries(sources.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,p))).digest('hex')]));
const route=fs.readFileSync(path.join(ROOT,sources[0]),'utf8');
const logistics=require(path.join(ROOT,sources[1])),parcelWriter=require(path.join(ROOT,sources[2]));
const start=route.indexOf("router.post('/orders/:id/create-parcel'");
const end=route.indexOf("router.post('/orders/:id/auto-prepare'",start);
if(start<0||end<0)throw Error('Route slice not found; refusing guessed extraction');
if(!/ON\s+CONFLICT\s+DO\s+NOTHING/i.test(fs.readFileSync(path.join(ROOT,sources[1]),'utf8')))throw Error('Writer behavior changed');
function routeHandler(client,reference){
  let handle;
  vm.runInNewContext(route.slice(start,end),{
    router:{post:(p,...handlers)=>{if(p==='/orders/:id/create-parcel')handle=handlers.at(-1);}},
    hubAuth:[],db:client,generateParcelRef:async()=>reference,
    createHubParcel:parcelWriter.createHubParcel,
    assignWholeOrderItemToParcel:logistics.assignWholeOrderItemToParcel,
    require:(n)=>{
      if(n==='../services/parcel-security')return {generateExternalCode:()=> 'ECO-EXT',generateSealCode:()=> 'ECO-SEAL'};
      throw Error('Disallowed route-slice import: '+n);
    },console
  },{filename:sources[0],timeout:1500});
  if(typeof handle!=='function')throw Error('Real handler not registered');
  return async(orderId,actorId,itemIds)=>{
    let code=null,body=null,nextError=null;
    const res={status(n){code=n;return this;},json(v){body=v;return this;}};
    await handle({body:{item_ids:itemIds},params:{id:orderId},user:{id:actorId}},res,e=>{nextError=e||Error('next called');});
    if(nextError)throw nextError;
    return {status:code,items_assigned:body?.items_assigned,parcel_created:!!body?.parcel?.id};
  };
}
const id=()=>crypto.randomUUID();
async function fixture(client){
  const x={relay:id(),product:id(),a:id(),b:id(),lineA:id(),lineB:id(),actor:id(),reference:'FP-ECO-'+id().slice(0,10)};
  const market=await client.query("SELECT id FROM markets WHERE code='KM' LIMIT 1");
  assert.ok(market.rows[0],'KM market seed required');x.market=market.rows[0].id;
  await client.query("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,'Feature FP Hub','FP','+269100000','TEMP',$2)",[x.relay,x.market]);
  await client.query("INSERT INTO users(id,full_name,role) VALUES($1,'FP Hub Actor','agent_hub')",[x.actor]);
  await client.query("INSERT INTO products(id,name,price_kmf,stock) VALUES($1,'FP fixture',5000,20)",[x.product]);
  await client.query("INSERT INTO orders(id,reference,relais_id,market_id,total_kmf,payment_mode,status) VALUES($1,$3,$5,$6,5000,'stripe_eur','confirmed'),($2,$4,$5,$6,5000,'stripe_eur','confirmed')",[x.a,x.b,'FP-A-'+id().slice(0,10),'FP-B-'+id().slice(0,10),x.relay,x.market]);
  await client.query("INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf) VALUES($1,$3,$5,1,5000),($2,$4,$5,1,5000)",[x.lineA,x.lineB,x.a,x.b,x.product]);
  return x;
}
async function observe(client,x){
  const {rows:[r]}=await client.query(`SELECT COUNT(DISTINCT p.id)::int AS parcels,
    COUNT(pi.id)::int AS memberships,
    COUNT(pi.id) FILTER(WHERE oi.order_id=$2)::int AS foreign_memberships
    FROM parcels p LEFT JOIN parcel_items pi ON pi.parcel_id=p.id
    LEFT JOIN order_items oi ON oi.id=pi.order_item_id WHERE p.reference=$1`,[x.reference,x.b]);
  const {rows:[c]}=await client.query('SELECT COUNT(*)::int AS n FROM order_comments WHERE order_id=$1 AND text LIKE $2',[x.a,'Colis '+x.reference+'%']);
  return {parcelCount:r.parcels,membershipCount:r.memberships,foreignMembershipCount:r.foreign_memberships,commentCount:c.n};
}
async function main(){
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,application_name:'feature-fingerprint-eco-proof'});
  const client=await pool.connect();
  const result={version:5,execution:'REAL_POSTGRESQL_WITH_CHECKOUT_SOURCE',authExecuted:false,fullHttpExecuted:false,
    source:provenance,contract:{id:'response-items-assigned-corresponds-to-persisted-memberships',approved:false},
    cases:[],repetitions:2,rollbackVerified:false};
  let began=false;
  try{
    const {rows:[identity]}=await client.query('SELECT current_database() AS db');
    assert.equal(identity.db,'komerce_test');
    await client.query('BEGIN');began=true;
    const x=await fixture(client);
    await client.query('SAVEPOINT fp_seed');
    const run=routeHandler(client,x.reference);
    for(let repetition=1;repetition<=2;repetition++){
      for(const [label,items] of [['nominal',[x.lineA]],['foreign_order',[x.lineB]],['duplicate',[x.lineA,x.lineA]]]){
        await client.query('ROLLBACK TO SAVEPOINT fp_seed');
        const before=await observe(client,x);
        const response=await run(x.a,x.actor,items);
        const after=await observe(client,x);
        result.cases.push({repetition,label,inputCount:items.length,response,before,after,
          contradiction:response.status===201&&response.items_assigned!==after.membershipCount});
      }
    }
  }finally{
    try{if(began){await client.query('ROLLBACK');result.rollbackVerified=true;}}
    finally{client.release();await pool.end();}
  }
  const nominal=result.cases.filter(c=>c.label==='nominal');
  assert.equal(nominal.length,2);
  for(const c of nominal){
    assert.equal(c.response.status,201);
    assert.equal(c.response.items_assigned,1);
    assert.equal(c.after.membershipCount,1);
    assert.equal(c.contradiction,false);
  }
  result.verdict=result.cases.some(c=>c.contradiction)?'UNAPPROVED_CONTRADICTION':'NO_VIOLATION_OBSERVED';
  result.evidenceHash=crypto.createHash('sha256').update(JSON.stringify(result.cases.map(x=>({label:x.label,inputCount:x.inputCount,response:x.response,after:x.after,contradiction:x.contradiction})))).digest('hex');
  const out=path.resolve(process.env.FP_OUTPUT||'/tmp/feature-fingerprint-pg-proof.json');
  fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({verdict:result.verdict,rollbackVerified:result.rollbackVerified,
    nominal:nominal.length,contradictions:result.cases.filter(c=>c.contradiction).length,evidenceHash:result.evidenceHash}));
}
main().catch(err=>{console.error('REPLAY_FAILED',err.stack||err.message);process.exitCode=1;});
