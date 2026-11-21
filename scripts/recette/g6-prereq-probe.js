#!/usr/bin/env node
/** @komerce-arch-lite
 * @role g6-prereq-probe
 * @domain orders
 * @layer script
 * @owner backend-core
 * @purpose Owner-only READ ONLY probe of M03 data prerequisites per market (no Chromium, no write).
 * @db-read products, markets, relais, product_market_price_drafts, product_market_exposure, product_skus, product_suppliers, suppliers, local_stock, local_stock_allocations
 * @db-write none
 * @impact-areas staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {marketProfile}=require('./canonical/market-profile');
const {readSellable,classify}=require('./canonical/m03-prereq');
const {readMultiSkuProducts}=require('./canonical/negative-scenarios');
const OUT=path.resolve(__dirname,'../../test-results/g6-prereq-probe/report.json');
function guard(env){
 if(env.GITHUB_EVENT_NAME!=='issues'||env.GITHUB_ACTOR!==env.GITHUB_REPOSITORY_OWNER||
  env.GITHUB_REPOSITORY!=='SamyrFateh/komerce-backend'||env.KOMERCE_ENV!=='staging'||
  !String(env.PGOPTIONS||'').includes('default_transaction_read_only=on'))
  throw Error('G6_PREREQ_PROBE_OWNER_STAGING_READONLY_GUARD');
}
async function main({env=process.env,db=require('../../db')}={}){
 fs.mkdirSync(path.dirname(OUT),{recursive:true});
 const market=marketProfile(env).code;
 const state={schema:'komerce-g6-prereq-probe/1',scenario_id:'M03',market,verdict:'NOT_PROVEN',db_write:false,chromium:false};
 const save=()=>fs.writeFileSync(OUT,JSON.stringify(state,null,2)+'\n');
 save();
 let client;
 try{
  guard(env);
  client=await db.getClient();
  await client.query('BEGIN READ ONLY');
  Object.assign(state,classify(await readSellable(client,market)));
  // N33 (G6-G4A) : produit vendable à >= 2 SKU distincts ; lecture seule, verdict additif (M03 inchangé).
  const multi=await readMultiSkuProducts(client,market);
  state.multi_sku={count:multi.length,candidates:multi.slice(0,10).map(p=>p.product_ref),
   verdict:multi.length?'N33_READY':'PREREQ_MISSING_MULTI_SKU'};
  // N21/N22 (G6-G4B) : au moins 2 relais actifs dans le marché ; lecture seule, verdict additif.
  const {rows:[rl]}=await client.query(`SELECT count(*)::int AS n FROM relais r JOIN markets m ON m.id=r.market_id AND m.code=$1 WHERE r.is_active=TRUE`,[market]);
  state.second_relay={active_relays:rl.n,verdict:rl.n>=2?'N21_READY':'PREREQ_MISSING_SECOND_RELAY'};
  await client.query('ROLLBACK');
  save();return state;
 }catch(e){
  state.verdict='BLOCKED';state.error=String(e.message).slice(0,300);save();throw e;
 }finally{if(client)client.release();await db.pool.end()}
}
if(require.main===module)main().catch(e=>{console.error('[G6_PREREQ] '+e.message);process.exitCode=2});
module.exports={main,guard};
