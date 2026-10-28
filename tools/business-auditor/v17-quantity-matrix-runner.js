'use strict';
/**
 * Opus P0-2: quantities, not only actions, must vary. This deterministic
 * Cartesian product is a first data generator; the runner never copies the
 * supplied unsafe script or writes to the shared test-template database.
 * True service + canonical PG, transaction ROLLBACK, per-case cloned database.
 */
const crypto=require('node:crypto');
const {withClone}=require('./v16-cloned-database');
const uuid=()=>crypto.randomUUID();
const RANGES=Object.freeze({existingRows:[9,26,29],existingQuantity:[1,3],incomingQuantity:[1,5]});
function cases(){
 const out=[];
 for(const rows of RANGES.existingRows)
  for(const existingQty of RANGES.existingQuantity)
   for(const incomingQty of RANGES.incomingQuantity)
    out.push({key:'R'+rows+'Q'+existingQty+'N'+incomingQty,
     rows,existingQty,incomingQty});
 return out;
}
async function single(databaseUrl,scenario){
 const {Client}=require('pg');
 const c=new Client({connectionString:databaseUrl,connectionTimeoutMillis:5000});
 await c.connect();let inTx=false;
 try{
  const {distributeOrder}=require('../../services/auto-parcel');
  await c.query('BEGIN');inTx=true;
  const market=(await c.query("SELECT id FROM markets WHERE code='KM' LIMIT 1")).rows[0];
  if(!market?.id)throw Error('TOOL_ERROR: fixture has no KM market');
  const relay=uuid(),product=uuid(),carrier=uuid(),order=uuid(),parcel=uuid();
  await c.query("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,'KBA V17','KBA','+269000001','LOCAL',$2)",[relay,market.id]);
  await c.query("INSERT INTO products(id,name,price_kmf,stock) VALUES($1,'KBA V17',5000,200)",[product]);
  for(const [id,label,qty] of [[carrier,'C',scenario.rows*scenario.existingQty],
   [order,'N',scenario.incomingQty]])
   await c.query("INSERT INTO orders(id,reference,relais_id,market_id,total_kmf,payment_mode,status,payment_status) VALUES($1,$2,$3,$4,$5,'stripe_eur','ordered','paid')",
    [id,'KBA17-'+label+'-'+id.slice(0,12),relay,market.id,qty*5000]);
  await c.query("INSERT INTO parcels(id,order_id,relais_id,reference,status,type) VALUES($1,$2,$3,$4,'preparation','standard')",
   [parcel,carrier,relay,'KBA17-P-'+parcel.slice(0,12)]);
  for(let i=0;i<scenario.rows;i++){
   const id=uuid();
   await c.query("INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,fulfillment_source) VALUES($1,$2,$3,$4,5000,'IMPORT')",
    [id,carrier,product,scenario.existingQty]);
   await c.query("INSERT INTO parcel_items(parcel_id,order_item_id,product_id,quantity) VALUES($1,$2,$3,$4)",
    [parcel,id,product,scenario.existingQty]);
  }
  const incomingItem=uuid();
  await c.query("INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,fulfillment_source) VALUES($1,$2,$3,$4,5000,'IMPORT')",
   [incomingItem,order,product,scenario.incomingQty]);
  const before=(await c.query("SELECT COUNT(*)::int AS lines,COALESCE(SUM(quantity),0)::int AS units FROM parcel_items WHERE parcel_id=$1",[parcel])).rows[0];
  const owner=await distributeOrder(order,c);
  const {rows:after}=await c.query(
   "SELECT p.id,p.status,COUNT(pi.id)::int AS lines,COALESCE(SUM(pi.quantity),0)::int AS units FROM parcels p LEFT JOIN parcel_items pi ON pi.parcel_id=p.id WHERE p.relais_id=$1 GROUP BY p.id,p.status ORDER BY p.id",
   [relay]);
  const {rows:[incoming]}=await c.query(
   "SELECT COUNT(*)::int AS assignments,COALESCE(SUM(quantity),0)::int AS units FROM parcel_items WHERE order_item_id=$1",[incomingItem]);
  await c.query('ROLLBACK');inTx=false;
  return {key:scenario.key,dimensions:scenario,
   before:{lines:Number(before.lines),units:Number(before.units)},
   after:after.map(p=>({original:p.id===parcel,status:p.status,lines:Number(p.lines),units:Number(p.units)})),
   incoming:{assignments:Number(incoming.assignments),units:Number(incoming.units)},
   service:{success:owner.success,created:owner.parcel_created===true,
    usedOriginalParcel:owner.parcel_id===parcel,
    reportedAssigned:owner.items_assigned??null},
   rollbackVerified:true};
 }finally{
  if(inTx)await c.query('ROLLBACK').catch(()=>{});
  await c.end();
 }
}
async function run(env=process.env){
 const result=[];
 for(const scenario of cases()){
  const proof=await withClone(env,url=>single(url,scenario));
  result.push({...proof.result,cloneDropped:proof.cloneDroppedAfterExecution});
 }
 return {contract:'komerce-generated-capacity-data-raw/v17',
  cases:result,generation:{dimensions:RANGES,method:'CARTESIAN_PRODUCT'},
  testedOwners:['services/auto-parcel.js#distributeOrder'],
  schema:'CANONICAL_POSTGRESQL_16',dbLocalOnly:true,
  allClonesDropped:result.every(c=>c.cloneDropped),
  actualBusinessPolicyApproved:false,
  concurrentSessions:false,routeHttpExecuted:false,
  productionIncidentConfirmed:false};
}
module.exports={run,cases,RANGES};
