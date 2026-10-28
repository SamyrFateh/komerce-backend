'use strict';
/**
 * Two-order, shared-relay canonical PostgreSQL runner.
 * Executes generated sequences (not a hard-coded known bug), and records
 * the service return and physical database state after EVERY operator.
 * Every scenario is rolled back to its own SAVEPOINT, then final ROLLBACK.
 */
const crypto=require('node:crypto');
const {assertLocalTestTarget}=require('./cli');
const {generatePlans}=require('./v14-sequence-planner');
const uuid=()=>crypto.randomUUID();
const ACTIONS=Object.freeze({
 ASSIGN_A:async({client,ids,distributeOrder})=>distributeOrder(ids.A,client),
 ASSIGN_B:async({client,ids,distributeOrder})=>distributeOrder(ids.B,client),
 CANCEL_OPEN:async({client,ids,transitionParcelStatus})=>{
  const {rows}=await client.query(`SELECT id FROM parcels
   WHERE relais_id=$1 AND status IN ('draft','preparation') ORDER BY created_at DESC,id DESC LIMIT 1`,[ids.relay]);
  if(rows.length!==1)return {skipped:true,reason:'NO_OPEN_PARCEL'};
  return transitionParcelStatus(client,rows[0].id,'cancelled');
 }
});
async function seed(client,marketId){
 const relay=uuid(),product=uuid(),A=uuid(),B=uuid();
 const items={A:uuid(),B:uuid()};
 await client.query("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,'KBA V14 relay','KBA','+269000001','LOCAL TEST',$2)",[relay,marketId]);
 await client.query("INSERT INTO products(id,name,price_kmf,stock) VALUES($1,'KBA V14 item',5000,10)",[product]);
 for(const [label,order] of [['A',A],['B',B]]){
  await client.query(`INSERT INTO orders(id,reference,relais_id,market_id,total_kmf,payment_mode,status,payment_status)
   VALUES($1,$2,$3,$4,5000,'stripe_eur','ordered','paid')`,
   [order,'KBA14-'+label+'-'+order.slice(0,15),relay,marketId]);
  await client.query(`INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,fulfillment_source)
   VALUES($1,$2,$3,1,5000,'IMPORT')`,[items[label],order,product]);
 }
 return {relay,product,A,B,items};
}
async function snapshot(client,ids){
 const {rows:orders}=await client.query(
  'SELECT id,status FROM orders WHERE id=ANY($1::uuid[]) ORDER BY id',[[ids.A,ids.B]]);
 const {rows:parcels}=await client.query(`SELECT p.id,p.order_id,p.status,
   (SELECT COUNT(*)::int FROM parcel_items pi WHERE pi.parcel_id=p.id) AS members
  FROM parcels p WHERE p.relais_id=$1 ORDER BY p.created_at,p.id`,[ids.relay]);
 const {rows:members}=await client.query(`SELECT pi.parcel_id,pi.order_item_id,
  oi.order_id,pi.quantity,p.status AS parcel_status
  FROM parcel_items pi JOIN order_items oi ON oi.id=pi.order_item_id
  JOIN parcels p ON p.id=pi.parcel_id
  WHERE oi.order_id=ANY($1::uuid[]) ORDER BY pi.parcel_id,pi.order_item_id`,[[ids.A,ids.B]]);
 return {orders:orders.map(x=>({order:x.id,status:x.status})),
  parcels:parcels.map(x=>({id:x.id,carrier:x.order_id,status:x.status,members:Number(x.members)})),
  members:members.map(x=>({parcel:x.parcel_id,item:x.order_item_id,order:x.order_id,
   quantity:Number(x.quantity),parcelStatus:x.parcel_status}))};
}
function failure(e){
 return {threw:true,code:typeof e.code==='string'?e.code:'UNCLASSIFIED',
  // No sensitive or unbounded provider messages in archive.
  message:String(e.message||'').slice(0,160)};
}
async function runOne(client,plan,marketId,owners){
 await client.query('SAVEPOINT kba_v14_case');
 try{
  const ids=await seed(client,marketId);
  const steps=[];
  const initial=await snapshot(client,ids);
  for(const action of plan.actions){
   await client.query('SAVEPOINT kba_v14_step');
   let result;
   try{
    result=await ACTIONS[action]({client,ids,...owners});
    await client.query('RELEASE SAVEPOINT kba_v14_step');
   }catch(e){
    await client.query('ROLLBACK TO SAVEPOINT kba_v14_step');
    await client.query('RELEASE SAVEPOINT kba_v14_step');
    result=failure(e);
   }
   steps.push({action,target:action==='ASSIGN_A'?ids.A:action==='ASSIGN_B'?ids.B:null,
    result,state:await snapshot(client,ids)});
  }
  return {id:plan.id,actions:plan.actions,ids:{A:ids.A,B:ids.B,relay:ids.relay,
   itemA:ids.items.A,itemB:ids.items.B},initial,steps};
 }finally{
  await client.query('ROLLBACK TO SAVEPOINT kba_v14_case');
  await client.query('RELEASE SAVEPOINT kba_v14_case');
 }
}
async function explore(env=process.env,{maxDepth=4}={}){
 assertLocalTestTarget(env);
 const {Pool}=require('pg');
 const pool=new Pool({connectionString:env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
 let c,began=false;
 try{
  c=await pool.connect();
  const {rows:[db]}=await c.query('SELECT current_database() AS name');
  if(db?.name!=='komerce_test')throw Error('TOOL_ERROR: database mismatch');
  await c.query('BEGIN');began=true;
  await c.query("SET LOCAL statement_timeout='15000ms'");
  const {rows:[market]}=await c.query("SELECT id FROM markets WHERE code='KM' LIMIT 1");
  if(!market)throw Error('TOOL_ERROR: KM market fixture missing');
  const {distributeOrder}=require('../../services/auto-parcel');
  const {transitionParcelStatus}=require('../../services/parcel-operations');
  const plans=generatePlans(maxDepth);
  const cases=[];
  for(const plan of plans)cases.push(await runOne(c,plan,market.id,
   {distributeOrder,transitionParcelStatus}));
  await c.query('ROLLBACK');began=false;
  return {contract:'komerce-business-sequence-exploration-raw/v14',
   depth:maxDepth,generatedCases:plans.length,
   actionAlphabet:Object.keys(ACTIONS),cases,
   scope:'CANONICAL_PG_REAL_OWNERS_SINGLE_CONNECTION',
   dbLocalOnly:true,rollbackVerified:true,
   allCasesSavepointRolledBack:true,routeHttpExecuted:false,
   concurrentTransactionsExecuted:false,productionIncidentConfirmed:false};
 }finally{
  if(c&&began)await c.query('ROLLBACK').catch(()=>{});
  if(c)c.release();
  await pool.end();
 }
}
module.exports={explore,snapshot,seed,runOne,ACTIONS};
