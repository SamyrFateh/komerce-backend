'use strict';
/**
 * Pilot adapter: same owner function twice on two orders and a canonical
 * near-capacity parcel. V1.8 engine does not know business capacity; fixture
 * and normalization are domain-specific and reusable across pair schedules.
 */
const {withClone}=require('./v16-cloned-database');
const {setup,observe}=require('./v15-concurrency-runner');
const {rendezvous,intercept}=require('./v16-healing-runner');
function normalize(state,ids){
 return {parcels:state.parcels.map(p=>({status:p.status,members:p.members})),
  assignedByOrder:state.assignedByOrder.map(p=>({
   target:p.order===ids.A?'A':p.order===ids.B?'B':'UNKNOWN',members:p.members})),
  total:state.total};
}
async function scenario(url,mode){
 const {Pool}=require('pg');
 const pool=new Pool({connectionString:url,max:3,connectionTimeoutMillis:6000});
 const clients=[];
 try{
  for(let i=0;i<3;i++)clients.push(await pool.connect());
  const [monitor,a,b]=clients;
  const {distributeOrder}=require('../../services/auto-parcel');
  const ids=await setup(monitor);
  const before=normalize(await observe(monitor,ids),ids);
  if(before.total!==29||before.parcels.length!==1||
     before.parcels[0].members!==29)throw Error('TOOL_ERROR: canonical seed malformed');
  let outcomes,gateMeta={arrived:0,serialized:false};
  if(mode==='AB'||mode==='BA'){
   const actors=mode==='AB'?
    [{id:ids.A,client:a,target:'A'},{id:ids.B,client:b,target:'B'}]:
    [{id:ids.B,client:b,target:'B'},{id:ids.A,client:a,target:'A'}];
   outcomes=[];
   for(const actor of actors){
    try{outcomes.push({target:actor.target,status:'fulfilled',
      value:await distributeOrder(actor.id,actor.client)})}
    catch(e){outcomes.push({target:actor.target,status:'rejected',
      code:e.code||'UNCLASSIFIED'})}
   }
  }else if(mode==='PARALLEL'){
   const {rows:[pa]}=await a.query('SELECT pg_backend_pid() AS pid');
   const {rows:[pb]}=await b.query('SELECT pg_backend_pid() AS pid');
   const gate=rendezvous(monitor,[pa.pid,pb.pid],{watchLocks:true});
   const operations=await Promise.allSettled([
    distributeOrder(ids.A,intercept(a,gate)),
    distributeOrder(ids.B,intercept(b,gate))
   ]);
   outcomes=operations.map((o,i)=>o.status==='fulfilled'?
    {target:i?'B':'A',status:'fulfilled',value:o.value}:
    {target:i?'B':'A',status:'rejected',code:o.reason?.code||'UNCLASSIFIED'});
   gateMeta=gate.meta();
  }else throw Error('TOOL_ERROR: unsupported adapter operation ordering');
  return {mode,before,after:normalize(await observe(monitor,ids),ids),
   outcomes,gate:gateMeta,adapter:'AUTO_PARCEL_TWO_ORDERS'};
 }finally{
  for(const c of clients)c.release();
  await pool.end();
 }
}
async function explore(env=process.env){
 const cases=[];
 for(const mode of ['AB','BA','PARALLEL']){
  const isolated=await withClone(env,url=>scenario(url,mode));
  cases.push({...isolated.result,cloneDropped:isolated.cloneDroppedAfterExecution});
 }
 return {contract:'komerce-adapter-serializability-raw/v18',
  method:'PHYSICAL_PG_CANONICAL_THREE_CLONES',
  allClonesDropped:cases.every(x=>x.cloneDropped),
  cases,productionIncidentConfirmed:false,routeHttpExecuted:false,
  selectionMode:'MANUAL_PILOT_ADAPTER',
  knownBugAtDesignTime:true};
}
module.exports={normalize,scenario,explore};
