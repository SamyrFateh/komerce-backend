#!/usr/bin/env node
'use strict';
/**
 * R&D V2.7 independent physical witness: real auto-parcel owner, real canonical
 * schema and TWO PostgreSQL sessions on a disposable kba_* clone.
 *
 * A separate database client inserts the membership after the owner's initial
 * NOT EXISTS check, immediately before the real ON CONFLICT DO NOTHING INSERT.
 * No source/migration/production modification, no simulated rowCount.
 */
const crypto=require('node:crypto'),path=require('node:path');
const uuid=()=>crypto.randomUUID();
const url=new URL(process.env.DATABASE_URL||'');
if(process.env.NODE_ENV!=='test'||process.env.KOMERCE_DISABLE_CRONS!=='true'||
 !['localhost','127.0.0.1','::1'].includes(url.hostname)||
 !/^\/kba_[a-f0-9]{18}$/.test(url.pathname))
 throw Error('V27_TOOL_ERROR: local disposable PG clone only');
const mode=process.argv[2];
if(!['NOMINAL','LATE_COLLISION','REPORT_ONLY','RECONCILE_RESULT','CANCELLED_MEMBERSHIP'].includes(mode))
 throw Error('V27_TOOL_ERROR: unknown scenario');
const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000});
const {distributeOrder}=require('../../services/auto-parcel');
async function seed(c){
 const x={order:uuid(),item:uuid(),product:uuid(),relay:uuid(),
  openParcel:uuid(),cancelledParcel:uuid()};
 const {rows:[market]}=await c.query("SELECT id FROM markets WHERE code='KM' LIMIT 1");
 if(!market)throw Error('V27_TOOL_ERROR: missing KM market');
 await c.query("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,'KBA V27 relay','R&D','+269000','LOCAL',$2)",[x.relay,market.id]);
 await c.query("INSERT INTO products(id,name,price_kmf,stock) VALUES($1,'KBA V27 product',5000,10)",[x.product]);
 await c.query("INSERT INTO orders(id,reference,relais_id,market_id,total_kmf,payment_mode,status,payment_status) VALUES($1,$2,$3,$4,5000,'stripe_eur','ordered','paid')",
  [x.order,'KBA27-'+x.order.slice(0,12),x.relay,market.id]);
 await c.query("INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,fulfillment_source) VALUES($1,$2,$3,1,5000,'IMPORT')",
  [x.item,x.order,x.product]);
 await c.query("INSERT INTO parcels(id,order_id,relais_id,reference,status,type) VALUES($1,$2,$3,$4,'preparation','standard')",
  [x.openParcel,x.order,x.relay,'KBA27-OPEN-'+x.openParcel.slice(0,12)]);
 if(mode==='CANCELLED_MEMBERSHIP'){
  await c.query("INSERT INTO parcels(id,order_id,relais_id,reference,status,type) VALUES($1,$2,$3,$4,'cancelled','standard')",
   [x.cancelledParcel,x.order,x.relay,'KBA27-OLD-'+x.cancelledParcel.slice(0,12)]);
  await c.query('INSERT INTO parcel_items(parcel_id,order_item_id,product_id,quantity) VALUES($1,$2,$3,1)',
   [x.cancelledParcel,x.item,x.product]);
 }
 return x;
}
async function observe(c,x){
 const {rows:membership}=await c.query(
  'SELECT pi.parcel_id,p.status,pi.quantity FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id WHERE pi.order_item_id=$1 ORDER BY p.status',
  [x.item]);
 const {rows:[dbOrder]}=await c.query('SELECT status FROM orders WHERE id=$1',[x.order]);
 return {membership:membership.map(z=>({parcelId:z.parcel_id,status:z.status,quantity:z.quantity})),
   activeCount:membership.filter(z=>z.status!=='cancelled').length,
   openCount:membership.filter(z=>z.parcel_id===x.openParcel).length,
   orderStatus:dbOrder.status};
}
async function main(){
 const owner=await pool.connect(),other=await pool.connect();
 try{
  const x=await seed(other);
  const before=await observe(other,x);
  let injected=false,ownerInserted=0,ownerInsertCalls=0;
  const physicalRows=[];
  const query=async (sql,args)=>{
   const text=String(sql);
   const isOwnerInsert=/INSERT\s+INTO\s+parcel_items\b/i.test(text) &&
    /ON\s+CONFLICT\s+DO\s+NOTHING/i.test(text);
   if(isOwnerInsert&&!injected&&['LATE_COLLISION','REPORT_ONLY','RECONCILE_RESULT'].includes(mode)){
    injected=true;
    // Dedicated second connection commits the competing write BEFORE the
    // owner's real insert. The owner performed its preflight on first session.
    await other.query('INSERT INTO parcel_items(parcel_id,order_item_id,product_id,quantity) VALUES($1,$2,$3,1)',
     [x.openParcel,x.item,x.product]);
   }
   const r=await owner.query(sql,args);
   if(isOwnerInsert){
    ownerInsertCalls++;
    ownerInserted+=r.rowCount;
    physicalRows.push(r.rowCount);
   }
   return r;
  };
  const actual=await distributeOrder(x.order,{query});
  const after=await observe(other,x);
  const response={...actual};
  if(mode==='REPORT_ONLY'||mode==='RECONCILE_RESULT'){
   // Deliberately weak result-only mutants: do not claim they are fixes.
   response.items_assigned=ownerInserted;
   if(mode==='RECONCILE_RESULT'&&ownerInserted===0&&after.activeCount===1)
    response.already_assigned=true;
  }
  const {rows:uniqueKeys}=await other.query(
   "SELECT indexname,indexdef FROM pg_indexes WHERE tablename='parcel_items' AND indexdef ILIKE '%UNIQUE%' ORDER BY indexname");
  console.log('BUSINESS_AUDIT_V27_PHYSICAL '+JSON.stringify({
   mode,realOwnerCalled:true,realCanonicalSchema:true,sessionCount:2,
   injectedBeforeOwnerInsert:injected,fixture:{itemCount:1},
   sourceResponse:actual,response,before,after,ownerInserted,
   ownerInsertCalls,physicalRows,
   actualIndexes:uniqueKeys.map(z=>({name:z.indexname,definition:z.indexdef})),
   noProductionTouch:true,authMiddlewareExecuted:false}));
 }finally{owner.release();other.release();await pool.end()}
}
main().catch(e=>{console.error('BUSINESS_AUDIT_V27_CHILD_ERROR '+(e.stack||e.message));process.exitCode=2});
