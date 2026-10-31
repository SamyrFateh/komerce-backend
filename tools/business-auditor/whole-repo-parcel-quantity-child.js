#!/usr/bin/env node
'use strict';
/**
 * Independent physical reproduction after whole-repo risk inspection.
 * Real distribute → sync → cancel → sync, disposable PostgreSQL 16 only.
 */
const http=require('node:http'),https=require('node:https');
const url=new URL(process.env.DATABASE_URL||'');
if(!['localhost','127.0.0.1','::1'].includes(url.hostname)||
 !/^\/kba_[0-9a-f]{18}$/.test(url.pathname)||
 process.env.NODE_ENV!=='test'||process.env.KOMERCE_DISABLE_CRONS!=='true')
 throw Error('WHOLE_REPO_PARCEL_TOOL_ERROR: disposable local DB only');
for(const m of [http,https]){
 m.request=()=>{throw Error('NO_NETWORK')};
 m.get=()=>{throw Error('NO_NETWORK')};
}
global.fetch=()=>{throw Error('NO_NETWORK')};
const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000});
const appdb=require('../../db');
const {seed}=require('./v14-sequence-explorer');
const {distributeOrder}=require('../../services/auto-parcel');
const {transitionParcelStatus}=require('../../services/parcel-operations');
const {syncOrderFromParcels}=require('../../services/scan-engine');
async function snapshot(c,ids){
 const sql=[
  'SELECT oi.id::text AS item_id, oi.order_id::text AS order_id,',
  'COALESCE(oi.qty_allocated,0)::int AS qty_allocated,',
  'COALESCE(oi.qty_packed,0)::int AS qty_packed,',
  'COALESCE(oi.qty_shipped,0)::int AS qty_shipped,',
  'COALESCE(oi.qty_received,0)::int AS qty_received,',
  'COALESCE(oi.qty_collected,0)::int AS qty_collected,',
  '(SELECT COALESCE(SUM(pi.qty_allocated),0)::int',
  'FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id',
  "WHERE pi.order_item_id=oi.id AND p.status<>'cancelled') AS actual_allocated_active,",
  '(SELECT COUNT(*)::int FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id',
  "WHERE pi.order_item_id=oi.id AND p.status<>'cancelled') AS membership_count_active",
  'FROM order_items oi WHERE oi.id=$1'
 ].join(' ');
 const {rows:[row]}=await c.query(sql,[ids.items.A]);
 if(!row||row.order_id!==ids.A||row.item_id!==ids.items.A)
  throw Error('CANONICAL_ROW_IDENTITY_MISSING');
 return row;
}
async function main(){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await c.query("SET LOCAL statement_timeout='15000ms'");
  const {rows:[m]}=await c.query("SELECT id FROM markets WHERE code='KM'");
  if(!m)throw Error('KM_MARKET_MISSING');
  const ids=await seed(c,m.id);
  const allocation=await distributeOrder(ids.A,c);
  const {rows:[p]}=await c.query([
   'SELECT p.id,p.status, COUNT(pi.id)::int AS item_count',
   'FROM parcels p JOIN parcel_items pi ON pi.parcel_id=p.id',
   "WHERE pi.order_item_id=$1 AND p.status<>'cancelled'",
   'GROUP BY p.id,p.status ORDER BY p.id LIMIT 1'
  ].join(' '),[ids.items.A]);
  if(!p||p.item_count<1||!allocation)
   throw Error('REAL_ALLOCATION_NOT_CREATED');
  // Establish a physically valid, allocated parcel line as the scanner would
  // observe after an allocation/packing step. auto-parcel creates membership
  // but intentionally leaves qty_allocated at its schema default of zero.
  // This is SQL fixture setup, NOT a claim that the packed HTTP path was run.
  const qtySet=await c.query(
   'UPDATE parcel_items SET qty_allocated=quantity WHERE parcel_id=$1 AND order_item_id=$2 RETURNING qty_allocated',
   [p.id,ids.items.A]);
  if(qtySet.rowCount!==1||Number(qtySet.rows[0].qty_allocated)<1)
   throw Error('PHYSICAL_ALLOCATED_QUANTITY_FIXTURE_NOT_VALID');
  await syncOrderFromParcels(c,ids.A);
  const before=await snapshot(c,ids);
  const cancelled=await transitionParcelStatus(c,p.id,'cancelled');
  if(cancelled?.ok!==true)throw Error('REAL_CANCEL_NOT_ACCEPTED '+JSON.stringify(cancelled));
  const intermediate=await snapshot(c,ids);
  await syncOrderFromParcels(c,ids.A);
  const after=await snapshot(c,ids);
  if(before.qty_allocated<1||before.actual_allocated_active<1||
     after.membership_count_active!==0||after.actual_allocated_active!==0)
   throw Error('INDEPENDENT_REPRODUCTION_PRECONDITIONS_FAILED '+JSON.stringify({before,intermediate,after,allocation}));
  console.log('WHOLE_REPO_PARCEL_PHYSICAL '+JSON.stringify({
   contract:'komerce-real-parcel-resync-observation/v1',
   scenario:'ASSIGN_SYNC_CANCEL_LAST_ACTIVE_PARCEL_RESYNC',
   ownerServices:['services/auto-parcel.js','services/parcel-operations.js',
    'services/scan-engine.js'],
   realOwnersExecuted:true,canonicalPg:true,networkBlocked:true,
   containsNoProductionData:true,before,intermediate,after,
   allocatedParcelFixturePreparedBySQL:true,
   parcelAllocationHttpPathExecuted:false,
   allReadsFromPostgres:true,realCancellationAccepted:true
  }));
 }finally{
  await c.query('ROLLBACK').catch(()=>{});
  c.release();
  await Promise.allSettled([pool.end(),appdb.pool.end()]);
 }
}
main().catch(e=>{console.error('WHOLE_REPO_PARCEL_CHILD_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
