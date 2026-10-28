'use strict';
/**
 * V1.9 pilot replay AB, AB' (determinism), BA and A||B.
 * Optionally seed only a CANCELLED parcel to expose nextParcelRef conflict.
 * The exact same real auto-parcel service runs in each disposable PG clone.
 */
const {withClone}=require('./v16-cloned-database');
const {setup,observe}=require('./v15-concurrency-runner');
const {rendezvous,intercept}=require('./v16-healing-runner');
const {normalize}=require('./v18-serializability-runner');
const {MODES}=require('./v19-serializability-predicate');
async function scenario(url,mode,fixture){
 const {Pool}=require('pg');
 const pool=new Pool({connectionString:url,max:3,connectionTimeoutMillis:6000});
 const clients=[];
 try{
  for(let i=0;i<3;i++)clients.push(await pool.connect());
  const [monitor,a,b]=clients;
  const {distributeOrder}=require('../../services/auto-parcel');
  const ids=await setup(monitor);
  if(fixture==='CANCELLED_EXISTING_PARCEL'){
   await monitor.query("UPDATE parcels SET status='cancelled' WHERE id=$1",[ids.firstParcel]);
  }else if(fixture!=='NEAR_CAPACITY'){
   throw Error('TOOL_ERROR: unrecognized test fixture');
  }
  const before=normalize(await observe(monitor,ids),ids);
  if(before.total!==29||before.parcels.length!==1||before.parcels[0].members!==29)
   throw Error('TOOL_ERROR: physical starting state is not 29');
  const actorList=mode==='BA'?[{target:'B',id:ids.B,client:b},
   {target:'A',id:ids.A,client:a}]:[{target:'A',id:ids.A,client:a},
   {target:'B',id:ids.B,client:b}];
  let outcomes=[],gate={arrived:0,serialized:false};
  if(mode==='PARALLEL'){
   const pa=(await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   const pb=(await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   const rendez=rendezvous(monitor,[pa,pb],{watchLocks:true,timeoutMs:12000});
   const parallel=await Promise.allSettled(actorList.map(x=>
    distributeOrder(x.id,intercept(x.client,rendez))));
   outcomes=parallel.map((x,i)=>x.status==='fulfilled'?
    {target:actorList[i].target,status:'fulfilled',value:x.value}:
    {target:actorList[i].target,status:'rejected',code:x.reason?.code||'UNCLASSIFIED'});
   gate=rendez.meta();
  }else if(['AB','AB_REPEAT','BA'].includes(mode)){
   for(const x of actorList){
    try{
     const result=await distributeOrder(x.id,x.client);
     outcomes.push({target:x.target,status:'fulfilled',value:result});
    }catch(e){
     outcomes.push({target:x.target,status:'rejected',code:e?.code||'UNCLASSIFIED'});
    }
   }
  }else throw Error('TOOL_ERROR: unrecognized schedule');
  return {mode,fixture,before,after:normalize(await observe(monitor,ids),ids),
   outcomes,gate};
 }finally{
  for(const c of clients)c.release();
  await pool.end();
 }
}
async function explore(env=process.env,{fixture='NEAR_CAPACITY'}={}){
 const cases=[];
 for(const mode of MODES){
  const x=await withClone(env,url=>scenario(url,mode,fixture));
  cases.push({...x.result,cloneDropped:x.cloneDroppedAfterExecution});
 }
 return {contract:'komerce-opus-full-serializability-raw/v19',
  cases,adapter:'AUTO_PARCEL_TWO_ORDERS',fixture,selectionMode:'MANUAL_CALIBRATION',
  dbIsolation:'ONE_LOCAL_CANONICAL_TEMPLATE_CLONE_PER_EXECUTION',
  allClonesDropped:cases.every(c=>c.cloneDropped===true),
  retryPolicy:null,routeHttpExecuted:false,productionIncidentConfirmed:false};
}
module.exports={scenario,explore};
