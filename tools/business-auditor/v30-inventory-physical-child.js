#!/usr/bin/env node
'use strict';
/**
 * V3.0 physical inventory provenance: actual receiveItem on FULL canonical
 * disposable PostgreSQL clone. NO mocks of the inventory/DB owner.
 * Unrelated external networks denied. Router authentication is NOT executed.
 */
const crypto=require('node:crypto'),http=require('node:http'),https=require('node:https');
const env=process.env,mode=process.argv[2];
const url=new URL(env.DATABASE_URL||'');
if(!['NOMINAL','FOREIGN_ORDER'].includes(mode)||
 env.NODE_ENV!=='test'||env.KOMERCE_DISABLE_CRONS!=='true'||
 !['localhost','127.0.0.1','::1'].includes(url.hostname)||
 !/^\/kba_[0-9a-f]{18}$/.test(url.pathname))
 throw Error('V30_TOOL_ERROR: only a disposable local PG clone and known modes');
for(const m of [http,https]){
 m.request=()=>{throw Error('V30_NETWORK_FORBIDDEN')};
 m.get=()=>{throw Error('V30_NETWORK_FORBIDDEN')};
}
global.fetch=()=>{throw Error('V30_NETWORK_FORBIDDEN')};
const {Pool}=require('pg');
const db=require('../../db');
const {receiveItem}=require('../../services/inventory-service');
const pool=new Pool({connectionString:env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
const uuid=()=>crypto.randomUUID();
async function seed(){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const {rows:[market]}=await c.query("SELECT id FROM markets WHERE code='KM' LIMIT 1");
  if(!market)throw Error('V30_TOOL_ERROR: market KM missing from canonical fixture');
  const ids={relay:uuid(),product:uuid(),orderA:uuid(),orderB:uuid(),itemA:uuid(),itemB:uuid()};
  const nonce=uuid().slice(0,12);
  await c.query("INSERT INTO relais(id,name,phone,address,market_id) VALUES($1,'KBA V30 Inventory','+269100000','LOCAL',$2)",[ids.relay,market.id]);
  await c.query("INSERT INTO products(id,name,price_kmf,stock) VALUES($1,'KBA V30 stock item',5000,20)",[ids.product]);
  await c.query(
   "INSERT INTO orders(id,reference,relais_id,market_id,total_kmf,payment_mode,status) VALUES($1,$3,$5,$6,5000,'stripe_eur','confirmed'),($2,$4,$5,$6,5000,'stripe_eur','confirmed')",
   [ids.orderA,ids.orderB,'KBA30-A-'+nonce,'KBA30-B-'+nonce,ids.relay,market.id]);
  await c.query("INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf) VALUES($1,$3,$5,1,5000),($2,$4,$5,1,5000)",
   [ids.itemA,ids.itemB,ids.orderA,ids.orderB,ids.product]);
  await c.query('COMMIT');
  return ids;
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}
}
async function observe(ids){
 const c=await pool.connect();
 try{
  const {rows:items}=await c.query(
   'SELECT ii.id,ii.order_item_id,ii.order_id AS inventory_order,oi.order_id AS authoritative_order,ii.status FROM inventory_items ii JOIN order_items oi ON oi.id=ii.order_item_id WHERE ii.order_item_id=ANY($1::uuid[]) ORDER BY ii.id',
   [[ids.itemA,ids.itemB]]);
  const {rows:orders}=await c.query(
   'SELECT id,items_received,items_total,completion_ratio FROM orders WHERE id=ANY($1::uuid[]) ORDER BY id',
   [[ids.orderA,ids.orderB]]);
  return {rows:items,orderA:orders.find(x=>x.id===ids.orderA),
   orderB:orders.find(x=>x.id===ids.orderB)};
 }finally{c.release()}
}
async function main(){
 try{
  const ids=await seed(),before=await observe(ids);
  let owner={success:false,errorCode:null,errorStatus:null,response:null};
  try{
   const output=await receiveItem(mode==='NOMINAL'?
    {order_item_id:ids.itemA}:{order_item_id:ids.itemA,order_id:ids.orderB});
   owner={success:true,errorCode:null,errorStatus:null,
    response:{itemId:output?.item?.id,orderId:output?.item?.order_id,
     orderItemId:output?.item?.order_item_id,proposalStatus:output?.proposal?.status||null}};
  }catch(e){owner.errorCode=e.code||null;owner.errorStatus=e.status||null}
  const after=await observe(ids);
  console.log('BUSINESS_AUDIT_V30_INVENTORY '+JSON.stringify({
   contract:'komerce-inventory-canonical-physical/v30',
   mode,ids,before,after,owner,realOwnerCalled:true,realCanonicalSchema:true,
   noExternalNetwork:true,authMiddlewareExecuted:false,
   callerPayloadMode:mode==='NOMINAL'?'order_item_id_ONLY':'order_item_id_WITH_FOREIGN_order_id'
  }));
 }finally{await Promise.allSettled([pool.end(),db.pool.end()])}
}
main().catch(e=>{console.error('V30_CHILD_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
