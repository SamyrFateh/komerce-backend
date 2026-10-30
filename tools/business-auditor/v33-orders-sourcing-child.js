#!/usr/bin/env node
'use strict';
/* V3.3 canonical Orders/Sourcing owners, isolated PostgreSQL clone per mode.
 * All assertions and expectations belong to a separate independent oracle.
 */
const crypto=require('node:crypto'),http=require('node:http'),https=require('node:https');
const env=process.env,mode=process.argv[2],url=new URL(env.DATABASE_URL||'');
if(!['ORDER','SOURCING'].includes(mode)||env.NODE_ENV!=='test'||
 env.KOMERCE_DISABLE_CRONS!=='true'||
 !['localhost','127.0.0.1','::1'].includes(url.hostname)||
 !/^\/kba_[0-9a-f]{18}$/.test(url.pathname))
 throw Error('V33_TOOL_ERROR: disposable local test DB only');
for(const m of [http,https]){
 m.request=()=>{throw Error('V33_NO_NETWORK')};
 m.get=()=>{throw Error('V33_NO_NETWORK')};
}
global.fetch=()=>{throw Error('V33_NO_NETWORK')};
const {Pool}=require('pg');
const pool=new Pool({connectionString:env.DATABASE_URL,max:3,connectionTimeoutMillis:5000});
const db=require('../../db');
const {transitionOrderStatus}=require('../../services/order-status-machine');
const {archiveMissingCandidatesFromCatalogImport}=require('../../services/sourcing-candidate-import-service');
const uuid=()=>crypto.randomUUID();
async function orderRows(id){
 const {rows:[o]}=await pool.query('SELECT id,status,ordered_at,updated_at FROM orders WHERE id=$1',[id]);
 const {rows:events}=await pool.query(
  'SELECT status,changed_by,note FROM order_status_history WHERE order_id=$1 ORDER BY created_at,id',[id]);
 return {order:o,events};
}
async function orderMode(){
 const client=await pool.connect(),ids={relay:uuid(),order:uuid(),actor:uuid()};
 try{
  await client.query('BEGIN');
  const {rows:[m]}=await client.query("SELECT id FROM markets WHERE code='KM'");
  if(!m)throw Error('V33_TOOL_ERROR: KM market missing');
  await client.query("INSERT INTO relais(id,name,phone,address,market_id) VALUES($1,'V33 Test Relay','+2699999','TEST',$2)",[ids.relay,m.id]);
  await client.query(
   "INSERT INTO orders(id,reference,relais_id,market_id,total_kmf,payment_mode,status) VALUES($1,$2,$3,$4,1000,'stripe_eur','confirmed')",
   [ids.order,'V33-O-'+uuid().slice(0,10),ids.relay,m.id]);
  await client.query('COMMIT');
  const before=await orderRows(ids.order);
  async function call(newStatus,role,source='patch'){
   try{
    const result=await transitionOrderStatus({orderId:ids.order,newStatus,
     actor:{id:null,role},source,dbClient:client});
    return {success:result.success===true,noop:result.noop===true,
     previousStatus:result.previousStatus||null,newStatus:result.newStatus||null,
     error:result.error||null};
   }catch(e){return {success:false,error:e.code||e.message,toolThrown:true}}
  }
  // Client-based transition service only uses owner SQL, with no notifications.
  const invalid=await call('shipped','admin');
  const unauthorized=await call('ordered','agent_relais');
  const afterRejected=await orderRows(ids.order);
  const accepted=await call('ordered','admin');
  const afterAccepted=await orderRows(ids.order);
  const replay=await call('ordered','admin');
  const rewind=await call('confirmed','system','scan');
  const final=await orderRows(ids.order);
  return {mode:'ORDER',ids,before,invalid,unauthorized,afterRejected,
   accepted,afterAccepted,replay,rewind,final};
 }finally{client.release()}
}
async function sourcingRows(name){
 const {rows:candidates}=await pool.query(
  'SELECT id,supplier_product_id,state,product_id,raw_payload FROM sourcing_candidates WHERE supplier_name=$1 ORDER BY supplier_product_id',[name]);
 const {rows:events}=await pool.query(
  'SELECT c.supplier_product_id,e.old_state,e.new_state,e.event_type FROM sourcing_candidate_events e JOIN sourcing_candidates c ON c.id=e.candidate_id WHERE c.supplier_name=$1 ORDER BY c.supplier_product_id,e.created_at',[name]);
 return {candidates,events};
}
async function sourcingMode(){
 const supplier='V33-'+uuid().slice(0,12),importId=uuid();
 const ids={supplier,importId};
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await c.query(
   "INSERT INTO sourcing_candidates(supplier_name,supplier_product_id,product_name,state,raw_payload) VALUES($1,'MISSING','Missing candidate','raw_imported','{}'::jsonb),($1,'KEEP','Present candidate','scanned','{}'::jsonb),($1,'PUBLISHED','Already imported','imported_to_catalog','{}'::jsonb),($1,'REJECTED','Already rejected','rejected','{}'::jsonb)",
   [supplier]);
  await c.query('COMMIT');
  const before=await sourcingRows(supplier);
  const archived=await archiveMissingCandidatesFromCatalogImport(c,{
   supplierName:supplier,importedIds:['KEEP'],userId:null,importId});
  const after=await sourcingRows(supplier);
  return {mode:'SOURCING',ids,before,archived,after};
 }finally{c.release()}
}
async function main(){
 try{
  const physical=mode==='ORDER'?await orderMode():await sourcingMode();
  console.log('BUSINESS_AUDIT_V33_PHYSICAL '+JSON.stringify({
   contract:'komerce-orders-sourcing-physical/v33',...physical,
   ownerInvoked:true,canonicalPg:true,noExternalNetwork:true,
   noProductionTouch:true,authenticatedHttpRouteTested:false,
   v45MutationApplied:env.KBA_V45_MUTANT_APPLIED==='YES'
  }));
 }finally{await Promise.allSettled([pool.end(),db.pool.end()])}
}
main().catch(e=>{console.error('BUSINESS_AUDIT_V33_CHILD_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
