'use strict';
/**
 * V1.6 Opus counter-expertise: "can the oracle recognize a correct fix?"
 * Real owner services, three physical PG clients, 29 preexisting memberships.
 * Scenarios are isolated in their OWN fully cloned local PostgreSQL databases.
 * Unlike V1.5, the gate does not require any final result to be 31.
 */
const {Pool}=require('pg');
const {withClone}=require('./v16-cloned-database');
const {setup,observe}=require('./v15-concurrency-runner');
const LIMIT=30;
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function rendezvous(monitor,waitPids,{timeoutMs=9000,watchLocks=true}={}) {
 let arrived=0,releasedArrivals=null,settled=false,serialized=false,resolve,reject;
 const promise=new Promise((yes,no)=>{resolve=yes;reject=no});
 const finish=(error)=>{
  if(settled)return;
  settled=true;
  releasedArrivals=arrived; // freeze the actual synchronized read count
  if(error)reject(error);else resolve();
 };
 async function watch(){
  const deadline=Date.now()+timeoutMs;
  while(!settled&&Date.now()<deadline){
   if(watchLocks){
    const {rows}=await monitor.query(
     'SELECT pid,wait_event_type FROM pg_stat_activity WHERE pid=ANY($1::int[])',[waitPids]);
    if(rows.some(x=>x.wait_event_type==='Lock')){
     serialized=true;
     finish();
     break;
    }
   }
   await sleep(60);
  }
  if(!settled)finish(Error('TOOL_ERROR: no second read or PG lock wait before barrier deadline'));
 }
 return {
  wait:async()=>{
   if(settled)return promise; // a later serialized read did NOT overlap
   arrived++;
   if(arrived>=2)finish();
   else if(arrived===1)void watch().catch(finish);
   return promise;
  },
  meta:()=>({arrived:releasedArrivals===null?arrived:releasedArrivals,serialized})
 };
}
function intercept(c,gate) {
 return {query:async(sql,params=[])=>{
  const result=await c.query(sql,params);
  if(String(sql).includes('LEFT JOIN LATERAL')&&
     String(sql).includes('COALESCE(agg.item_count'))
   await gate.wait();
  return result;
 }};
}
async function invoke(order,c,distributeOrder,gate,mutant){
 if(!mutant)return distributeOrder(order,gate?intercept(c,gate):c);
 // Controlled mutant is OUTSIDE the production owner. It simulates a correct
 // per-relay critical section without changing the oracle or application file.
 await c.query('SELECT pg_advisory_lock(99911::bigint)');
 try {return await distributeOrder(order,gate?intercept(c,gate):c)}
 finally {await c.query('SELECT pg_advisory_unlock(99911::bigint)')}
}
function classifyPromise(o,order) {
 return {order,status:o.status,...(o.status==='fulfilled'?
  {value:o.value}:{code:o.reason?.code||'UNCLASSIFIED',
   message:String(o.reason?.message||'').slice(0,120)})};
}
async function scenario(databaseUrl,mode){
 const pool=new Pool({connectionString:databaseUrl,max:3,connectionTimeoutMillis:6000});
 const clients=[];
 try{
  for(let i=0;i<3;i++)clients.push(await pool.connect());
  const [monitor,a,b]=clients;
  const {distributeOrder,MAX_ITEMS_PER_PARCEL}=require('../../services/auto-parcel');
  if(MAX_ITEMS_PER_PARCEL!==LIMIT)
   throw Error('TOOL_ERROR: capacity assumption changed');
  const ids=await setup(monitor);
  const before=await observe(monitor,ids);
  if(before.total!==29||before.parcels.length!==1||before.parcels[0].members!==29)
   throw Error('TOOL_ERROR: seed not exactly 29 physical memberships');
  let outcome,gateMeta={arrived:0,serialized:false};
  if(mode==='SEQUENTIAL'){
   const first=await invoke(ids.A,a,distributeOrder,null,false);
   const second=await invoke(ids.B,b,distributeOrder,null,false);
   outcome=[{status:'fulfilled',value:first},{status:'fulfilled',value:second}];
  }else {
   const isLocked=mode==='SERIALIZED_MUTANT';
   if(mode!=='UNLOCKED_RACE'&&!isLocked)
    throw Error('TOOL_ERROR: unknown concurrent experiment');
   const {rows:[pidA]}=await a.query('SELECT pg_backend_pid() AS pid');
   const {rows:[pidB]}=await b.query('SELECT pg_backend_pid() AS pid');
   const gate=rendezvous(monitor,[pidA.pid,pidB.pid],{watchLocks:true});
   outcome=await Promise.allSettled([
    invoke(ids.A,a,distributeOrder,gate,isLocked),
    invoke(ids.B,b,distributeOrder,gate,isLocked)
   ]);
   gateMeta=gate.meta();
  }
  const after=await observe(monitor,ids);
  return {mode,before,after,gate:gateMeta,
   outcomes:outcome.map((o,i)=>classifyPromise(o,i?'B':'A')),
   orderA:ids.A,orderB:ids.B,originalParcel:ids.firstParcel,
   assumedCapacitySemantics:'COUNT_PARCEL_ITEM_ROWS_AS_OWNER_CURRENT_CODE',
   productionOwnerModified:false};
 }finally {
  for(const c of clients)c.release();
  await pool.end();
 }
}
async function run(env=process.env){
 const cases=[];
 for(const mode of ['SEQUENTIAL','UNLOCKED_RACE','SERIALIZED_MUTANT']){
  const value=await withClone(env,url=>scenario(url,mode));
  cases.push({...value.result,dbCloned:true,cloneDropped:value.cloneDroppedAfterExecution});
 }
 return {contract:'komerce-opus-healing-experiment-raw/v16',
  cases,dbIsolation:'CREATE_DATABASE_TEMPLATE_KOMERCE_TEST_DROP_PER_CASE',
  allClonesDropped:cases.every(c=>c.cloneDropped===true),
  realCanonicalSchema:true,realOwnerInvoked:true,productionOwnerModified:false,
  routeHttpExecuted:false,productionIncidentConfirmed:false};
}
module.exports={rendezvous,scenario,run};
