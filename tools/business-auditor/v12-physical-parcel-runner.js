'use strict';
/**
 * Independent physical SQL witness for actual auto-parcel service.
 * Only writes PG TEMP tables in a local komerce_test transaction.
 * Owner lookup reads are deliberately stubbed; this is NOT full real-schema
 * persistence or two-connection concurrency certification.
 */
const {assertLocalTestTarget}=require('./cli');
// Import the live writer only after the strict local database gate has passed.
async function runScenario(pg,preseed,distributeOrder) {
 await pg.query('BEGIN');
 let active=true;
 try{
  await pg.query('SET LOCAL search_path TO pg_temp, public');
  await pg.query("SET LOCAL statement_timeout='15000ms'");
  await pg.query(`CREATE TEMP TABLE parcel_items (
   id text DEFAULT 'temp-member',
   parcel_id text NOT NULL,
   order_item_id text NOT NULL,
   quantity integer NOT NULL CHECK (quantity > 0),
   product_id text NOT NULL,
   CONSTRAINT unique_order_item_per_parcel UNIQUE (order_item_id)
  ) ON COMMIT DROP`);
  const item='V12-ITEM',target='V12-OPEN-PARCEL';
  if(preseed)await pg.query(`INSERT INTO parcel_items (parcel_id,order_item_id,quantity,product_id)
   VALUES ('V12-CANCELLED-PARCEL','V12-ITEM',1,'V12-PRODUCT')`);
  const before=Number((await pg.query('SELECT count(*)::int AS n FROM parcel_items')).rows[0].n);
  const writes=[],sqlKinds=[];
  const client={query:async(sql,params=[])=>{
   const q=String(sql);
   if(q.includes('SELECT o.id, o.reference'))return {rows:[{
    id:'V12-ORDER',reference:'V12-ORDER',status:'ordered',
    relais_id:'V12-RELAY',relais_island:'Anjouan',total_kmf:1200
   }]};
   if(q.includes('SELECT pi.id FROM parcel_items')&&q.includes('JOIN order_items'))return {rows:[]};
   if(q.includes('SELECT id, quantity, product_id FROM order_items'))return {rows:[{
    id:item,quantity:1,product_id:'V12-PRODUCT'
   }]};
   if(q.includes('SELECT p.id, p.reference')&&q.includes('LATERAL'))return {rows:[{
    id:target,reference:'V12-OPEN',item_count:0,order_count:0
   }]};
   if(q.includes('INSERT INTO parcel_items')&&q.includes('ON CONFLICT DO NOTHING')){
    sqlKinds.push('INSERT_MEMBERSHIP_CONFLICT_TOLERANT');
    const result=await pg.query(q,params);
    writes.push(result.rowCount);
    return result;
   }
   throw Error('TOOL_ERROR: unexpected auto-parcel query; fixture cannot explain '+q.slice(0,75));
  }};
  const result=await distributeOrder('V12-ORDER',client);
  const after=Number((await pg.query('SELECT count(*)::int AS n FROM parcel_items')).rows[0].n);
  const inTarget=Number((await pg.query('SELECT count(*)::int AS n FROM parcel_items WHERE parcel_id=$1',[target])).rows[0].n);
  await pg.query('ROLLBACK');active=false;
  return {caseId:preseed?'CONFLICT_EXISTING_CANCELLED_MEMBERSHIP':'NOMINAL_NEW_MEMBERSHIP',
   before,after,created:after-before,inTarget,
   reported:result.items_assigned,serviceSuccess:result.success,
   affectedRows:writes,sqlKinds,preseed,
   transactionRolledBack:true};
 }finally{if(active)await pg.query('ROLLBACK').catch(()=>{})}
}
async function runPhysical(env=process.env) {
 assertLocalTestTarget(env);
 const {Pool}=require('pg');
 const pool=new Pool({connectionString:env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
 try{
  const client=await pool.connect();
  try{
   const {distributeOrder}=require('../../services/auto-parcel');
   const nominal=await runScenario(client,false,distributeOrder);
   const adverse=await runScenario(client,true,distributeOrder);
   return {contract:'komerce-raw-pg-membership-witness/v12',
    method:'REAL_SERVICE_PG_TEMP_WRITES_WITH_STUBBED_LOOKUPS',
    cases:[nominal,adverse],
    database:'DISPOSABLE_LOCAL_POSTGRES_ONLY',
    fullCanonicalSchemaStateProven:false,
    multiSessionConcurrentProof:false,
    productionIncidentConfirmed:false};
  }finally{client.release()}
 }finally{await pool.end()}
}
module.exports={runPhysical,runScenario};
