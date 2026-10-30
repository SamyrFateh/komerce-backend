'use strict';
/**
 * V1.3: use the actual checked-in canonical schema, actual service writers and
 * actual parcel SSOT transition. All fixtures are in one disposable PG rollback.
 * Not HTTP route proof; not a 2-connection race; no business fix.
 */
const crypto=require('node:crypto');
const {assertLocalTestTarget}=require('./cli');
const id=()=>crypto.randomUUID();
async function seed(client,marketId,tag){
 const relay=id(),product=id(),order=id(),item=id();
 const reference='KBA13-'+tag+'-'+order.slice(0,11);
 await client.query(
  "INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,'KBA V13 isolated','KBA','+269000001','DISPOSABLE',$2)",
  [relay,marketId]);
 await client.query(
  "INSERT INTO products(id,name,price_kmf,stock) VALUES($1,'KBA V13 Product',5000,10)",[product]);
 await client.query(`INSERT INTO orders(id,reference,relais_id,market_id,total_kmf,payment_mode,status,payment_status)
  VALUES($1,$2,$3,$4,5000,'stripe_eur','ordered','paid')`,
 [order,reference,relay,marketId]);
 await client.query(`INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,fulfillment_source)
  VALUES($1,$2,$3,1,5000,'IMPORT')`,[item,order,product]);
 return {relay,product,order,item,reference,tag};
}
async function state(client,fixture){
 const {rows:orderRows}=await client.query('SELECT status FROM orders WHERE id=$1',[fixture.order]);
 const {rows:parcels}=await client.query(`SELECT p.id,p.status,p.reference,
  (SELECT COUNT(*)::int FROM parcel_items pi WHERE pi.parcel_id=p.id) AS membership_count
  FROM parcels p WHERE p.order_id=$1 ORDER BY p.created_at,p.id`,[fixture.order]);
 const {rows:members}=await client.query(`SELECT pi.parcel_id,p.status AS parcel_status,
  pi.order_item_id,pi.quantity FROM parcel_items pi
  JOIN parcels p ON p.id=pi.parcel_id JOIN order_items oi ON oi.id=pi.order_item_id
  WHERE oi.order_id=$1 ORDER BY pi.parcel_id`,[fixture.order]);
 const {rows:eligible}=await client.query(`SELECT o.id FROM orders o WHERE o.id=$1
  AND o.status IN ('ordered','preparation')
  AND NOT EXISTS (SELECT 1 FROM parcel_items pi
   JOIN order_items oi ON oi.id=pi.order_item_id
   JOIN parcels p ON p.id=pi.parcel_id AND p.status NOT IN ('cancelled')
   WHERE oi.order_id=o.id)
  AND EXISTS(SELECT 1 FROM order_items oi WHERE oi.order_id=o.id)`,[fixture.order]);
 return {
  orderStatus:orderRows[0]?.status||null,
  eligibleForDistributeAll:eligible.length===1,
  parcels:parcels.map(p=>({id:p.id,status:p.status,memberships:Number(p.membership_count)})),
  memberships:members.map(m=>({parcelId:m.parcel_id,status:m.parcel_status,
   orderItemId:m.order_item_id,quantity:Number(m.quantity)})),
 };
}
async function executeCanonicalSequence(env=process.env){
 assertLocalTestTarget(env);
 const {Pool}=require('pg');
 const pool=new Pool({connectionString:env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
 let c,started=false,rolledBack=false;
 const result={contract:'komerce-canonical-parcel-sequence-raw/v13',
  scope:'REAL_SERVICES_CANONICAL_POSTGRESQL_16_SINGLE_TRANSACTION',
  steps:[],canonicalSchema:true,liveDatabase:false,usedSkipValidation:false,
  routeHttpExecuted:false,twoConnectionRaceExecuted:false,productionIncidentConfirmed:false};
 try{
  c=await pool.connect();
  const {rows:[db]}=await c.query('SELECT current_database() AS name');
  if(db?.name!=='komerce_test')throw Error('TOOL_ERROR: wrong database');
  await c.query('BEGIN');started=true;
  await c.query("SET LOCAL statement_timeout='15000ms'");
  const {rows:[market]}=await c.query("SELECT id FROM markets WHERE code='KM' LIMIT 1");
  if(!market)throw Error('TOOL_ERROR: KM market bootstrap missing');
  // Import only after the verified local PG target, never elsewhere.
  const {distributeOrder}=require('../../services/auto-parcel');
  const {transitionParcelStatus}=require('../../services/parcel-operations');
  const nominal=await seed(c,market.id,'NOMINAL');
  let first=await distributeOrder(nominal.order,c);
  result.steps.push({scenario:'NOMINAL',action:'distribute',result:first,state:await state(c,nominal)});
  let second=await distributeOrder(nominal.order,c);
  result.steps.push({scenario:'NOMINAL',action:'retry_without_cancel',result:second,state:await state(c,nominal)});
  const affected=await seed(c,market.id,'CANCEL_RETRY');
  const a=await distributeOrder(affected.order,c);
  result.steps.push({scenario:'CANCEL_RETRY',action:'distribute',result:a,state:await state(c,affected)});
  if(!a.success||!a.parcel_id)throw Error('TOOL_ERROR: initial fixture could not distribute');
  const cancel=await transitionParcelStatus(c,a.parcel_id,'cancelled');
  result.steps.push({scenario:'CANCEL_RETRY',action:'cancel_via_ssot',
   result:cancel,state:await state(c,affected)});
  if(!cancel.ok)throw Error('TOOL_ERROR: canonical parcel cancellation refused');
  const b=await distributeOrder(affected.order,c);
  result.steps.push({scenario:'CANCEL_RETRY',action:'redistribute',result:b,state:await state(c,affected)});
  const d=await distributeOrder(affected.order,c);
  result.steps.push({scenario:'CANCEL_RETRY',action:'repeat_redistribute',result:d,state:await state(c,affected)});
  result.fixtures={nominalOrder:nominal.order,affectedOrder:affected.order,
   nominalOrderItem:nominal.item,affectedOrderItem:affected.item,
   originalParcel:a.parcel_id};
  await c.query('ROLLBACK');started=false;rolledBack=true;
  const {rows:[check]}=await c.query(
   'SELECT (SELECT count(*)::int FROM orders WHERE id=ANY($1::uuid[])) AS orders, (SELECT count(*)::int FROM order_items WHERE id=ANY($2::uuid[])) AS items',
   [[nominal.order,affected.order],[nominal.item,affected.item]]);
  if(Number(check.orders)!==0||Number(check.items)!==0)
   throw Error('TOOL_ERROR: rollback did not remove test fixtures');
  result.rollbackVerified=true;
  return result;
 }finally{
  if(c&&started)await c.query('ROLLBACK').catch(()=>{});
  if(c)c.release();
  await pool.end();
 }
}
module.exports={executeCanonicalSequence,seed,state};
