#!/usr/bin/env node
'use strict';
/**
 * Read-only Golden purchasing projection under controlled PostgreSQL fixtures.
 * Inserts fixtures ONLY within BEGIN/ROLLBACK on local komerce_test; no live data.
 * Extracts the exact purchasing SELECT from existing Golden owner; no new oracle
 * derived from current output: identity requirement is from P1-P7 Golden doctrine.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {Pool}=require('pg');
const {evaluatePurchaseCoverage}=require('../../services/golden-e2e-cockpit');
const u=new URL(process.env.DATABASE_URL||'');
if(!['127.0.0.1','localhost'].includes(u.hostname)||u.pathname!=='/komerce_test'
  ||process.env.NODE_ENV!=='test'||process.env.KOMERCE_DISABLE_CRONS!=='true')throw Error('DISPOSABLE_LOCAL_KOMERCE_TEST_ONLY');
const src=fs.readFileSync(path.resolve(__dirname,'../../services/golden-e2e-cockpit.js'),'utf8');
const prefix='SELECT oi.id AS order_item_id, oi.quantity AS ordered_qty,';
const start=src.indexOf(prefix),end=src.indexOf('`',start);
if(start<0||end<0)throw Error('Cannot extract owner SQL query; fail closed');
const canonicalSql=src.slice(start,end);
const sourceSha256=crypto.createHash('sha256').update(src).digest('hex');
const id=()=>crypto.randomUUID();
async function seed(c,valid,marketId){
 const x={order:id(),item:id(),relay:id(),product:id(),soldSku:id(),otherSku:id(),supplier:id(),po:id(),line:id()};
 await c.query("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,'FP SKU','FP','+269100010','TEMP',$2)",[x.relay,marketId]);
 await c.query("INSERT INTO products(id,name,price_kmf,stock) VALUES($1,'FP Order Product',5000,10)",[x.product]);
 await c.query("INSERT INTO product_skus(id,product_id,sku,stock) VALUES($1,$3,'FP-SOLD',10),($2,$3,'FP-OTHER',10)",[x.soldSku,x.otherSku,x.product]);
 await c.query("INSERT INTO orders(id,reference,relais_id,market_id,total_kmf,payment_mode,status) VALUES($1,$2,$3,$4,5000,'cash_relais','ordered')",[x.order,'FP-SKU-'+x.order.slice(0,12),x.relay,marketId]);
 await c.query('INSERT INTO order_items(id,order_id,product_id,sku_id,quantity,price_kmf) VALUES($1,$2,$3,$4,1,5000)',[x.item,x.order,x.product,x.soldSku]);
 await c.query("INSERT INTO suppliers(id,name,platform) VALUES($1,'FP Supplier','local')",[x.supplier]);
 const bought=valid?x.soldSku:x.otherSku;
 await c.query("INSERT INTO purchase_orders(id,order_id,order_item_id,product_sku_id,supplier_id,supplier_sku,qty,status) VALUES($1,$2,$3,$4,$5,'FP',1,'confirmed')",[x.po,x.order,x.item,bought,x.supplier]);
 await c.query(`INSERT INTO purchase_lines(id,purchase_order_id,order_item_id,supplier_id,product_sku_id,supplier_sku,supplier_unit_ref,quantity,procurement_hub_ref)
 VALUES($1,$2,$3,$4,$5,'FP','FP-UNIT',1,'DXB')`,[x.line,x.po,x.item,x.supplier,bought]);
 return {...x,bought};
}
async function main(){
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
 const report={schema:'FP_PURCHASE_SKU_CROSS_PATH/v1',source:'services/golden-e2e-cockpit.js',
  sourceSha256,sqlReadFromOwner:true,oracleApproval:'DOCTRINE_REVIEW_REQUIRED',
  expected:'purchasing PASS requires quantity AND purchased SKU identity matching sold order_item SKU',
  cases:[],rollbackVerified:false,protocol:'real PostgreSQL 16 isolated, no HTTP/staging'};
 let c,open=false;
 try{
  c=await pool.connect();
  assert.equal((await c.query('SELECT current_database() AS name')).rows[0].name,'komerce_test');
  await c.query('BEGIN');open=true;
  const market=(await c.query("SELECT id FROM markets WHERE code='KM' LIMIT 1")).rows[0];
  assert.ok(market,'KM bootstrap absent');
  for(let round=1;round<=2;round++)for(const [variant,valid] of [['nominal',true],['wrong_sku',false]]){
   const fixture=await seed(c,valid,market.id);
   const r=await c.query(canonicalSql,[fixture.order]);
   const coverage=evaluatePurchaseCoverage(r.rows);
   const skuMatches=fixture.soldSku===fixture.bought;
   report.cases.push({round,variant,skuMatches,
     canonicalQuantity:r.rows.map(x=>({ordered:Number(x.ordered_qty),purchased:Number(x.purchased_qty),paid:Number(x.paid_qty)})),
     purchasingStepPassed:coverage.purchasing,expectedPassed:skuMatches,
     contradiction:coverage.purchasing!==skuMatches});
  }
 }finally{try{if(c&&open){await c.query('ROLLBACK');report.rollbackVerified=true;}}finally{if(c)c.release();await pool.end();}}
 for(const row of report.cases.filter(x=>x.variant==='nominal'))assert.equal(row.purchasingStepPassed,true);
 if(process.env.FP_EXPECT_SKU_GUARD==='true'){
  for(const row of report.cases.filter(x=>x.variant==='wrong_sku'))assert.equal(row.purchasingStepPassed,false,'SKU substitution must not pass Golden Purchasing');
 }
 report.verdict=report.cases.some(x=>x.contradiction)?'SKU_AUTHORITY_CONTRADICTION_OBSERVED':'NO_SKU_CONTRADICTION_OBSERVED';
 report.digest=crypto.createHash('sha256').update(JSON.stringify(report.cases)).digest('hex');
 fs.writeFileSync(process.env.FP_SKU_OUTPUT||'/tmp/golden-purchasing-sku-proof.json',JSON.stringify(report,null,2)+'\n');
 console.log('FP_PURCHASING_SKU_PROOF '+JSON.stringify({verdict:report.verdict,cases:report.cases,rollbackVerified:report.rollbackVerified}));
}
main().catch(e=>{console.error('FP_PURCHASING_SKU_FAILED',e.stack||e);process.exitCode=1});
