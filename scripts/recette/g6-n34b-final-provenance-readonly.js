#!/usr/bin/env node
/** @komerce-arch-lite
 * @role g6-n34b-final-provenance-readonly
 * @domain sourcing
 * @layer test
 * @owner backend-core
 * @purpose Reattest same real supplier across original candidate and existing Catalogue product; demonstrate live real supplier selector without a second import.
 * @db-read suppliers, sourcing_candidates, products
 * @db-write none
 * @impact-areas staging-only, sourcing, catalog
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),db=require('../../db');
const {marketProfile}=require('./canonical/market-profile'),{confirmTarget}=require('./target-guard');
const {centralHubIdentity,explicitSupplierProvenance}=require('./canonical/n34-source-oracles');
const {login}=require('./g6-canonical-forwarder-chromium');
const {humanGoto,humanClick,humanSelect}=require('./canonical/actors/human-gestures');
const {fullError}=require('./canonical/observability');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const OUT=path.resolve('test-results/g6-n34b-final-readonly');
const COHORT=Object.freeze({
 candidate:'4e362b24-dc2b-4dcf-ac7b-fdad9b36e4a3',
 product:'938d29e4-e94d-440b-829f-b2065f569f34',
 supplier:'00f5609d-9bb0-4559-b688-8dc28db2f5ae',
 reference:'KSC-000828'
});
const report={schema:'komerce-g6-n34b-revalidation/1',scenario_id:'N34b',
 market:env.G6_TARGET_MARKET,verdict:'NOT_PROVEN',scenario_bound:false,
 db_write:false,external_supplier_calls:0,external_payment_executed:false,
 production_permitted:false,steps:[],original_positive_run:45023874015,
 evidence_scope:'GLOBAL_SUPPLIER_IDENTITY_ORIGINAL_KM_FIXTURE'};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const check=(v,c)=>{if(!v)throw Error('G6_N34B_FINAL_'+c)};
function guard(){return env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&
 env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
 env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&
 env.STAGING_BASE_URL===BASE&&['KM','CM','CG'].includes(env.G6_TARGET_MARKET)&&
 String(env.PGOPTIONS||'').includes('default_transaction_read_only=on')&&env.G6_N34_FINAL_READONLY==='1'}
async function main(){
 let browser,actor;
 try{
  save();check(guard(),'STAGING_OWNER_GUARD');marketProfile(env);
  const target=await confirmTarget({db,env});
  check(target.confirmed&&!!target.fingerprint,'PG_IDENTITY_DRIFT');report.db_fingerprint=target.fingerprint;
  const h=await fetch(BASE+'/health/version');check(h.ok===true,'HEALTH_FAILED');
  const version=await h.json();check(/^[a-f0-9]{40}$/.test(String(env.E2E_EXPECTED_DEPLOY_SHA||''))&&
   version.commit===env.E2E_EXPECTED_DEPLOY_SHA,'SHA_DRIFT');report.sha=version.commit;
  const central=await centralHubIdentity(db);report.hub_supplier_id=central.central_hub_id;
  const source=await explicitSupplierProvenance(db,{productId:COHORT.product,
   candidateId:COHORT.candidate,expectedSupplierId:COHORT.supplier});
  report.provenance=source;report.steps.push({step:'n34b-independent-candidate-product-pg',passed:true,db_write:false});
  const q=await db.query(`SELECT sc.candidate_ref,sc.supplier_id,p.procurement_supplier_id,
     p.id AS product_id FROM sourcing_candidates sc
     JOIN products p ON p.id=sc.product_id WHERE sc.id=$1::uuid`,[COHORT.candidate]);
  check(q.rows.length===1&&q.rows[0].candidate_ref===COHORT.reference&&
   q.rows[0].supplier_id===COHORT.supplier&&
   q.rows[0].procurement_supplier_id===COHORT.supplier&&q.rows[0].product_id===COHORT.product,
   'HISTORIC_FIXTURE_REPLACED');save();
  browser=await chromium.launch({headless:true});
  actor=await login(browser,'E2E_ADMIN_','admin');
  await humanGoto(actor.page,'/admin/workspaces/sourcing?mode=manual',{waitUntil:'domcontentloaded'});
  const open=actor.page.locator('[data-workspace-action="manual-import"]');
  await open.waitFor({state:'visible',timeout:25000});await humanClick(null,open.first());
  const select=actor.page.locator('[data-manual-supplier]');
  await select.waitFor({state:'visible',timeout:15000});
  await actor.page.waitForFunction(()=>{const s=document.querySelector('[data-manual-supplier]');return s&&!s.disabled},null,{timeout:20000});
  const opt=select.locator('option[value="'+COHORT.supplier+'"]');
  check(await opt.count()===1,'REAL_SUPPLIER_NOT_SELECTABLE');
  check((await opt.getAttribute('data-system-key'))==='', 'REAL_SUPPLIER_RELABELED_SYSTEM');
  await humanSelect(null,select,COHORT.supplier);
  check(await select.inputValue()===COHORT.supplier,'REAL_SOURCE_SELECTION_DID_NOT_PERSIST');
  check(actor.blocked.length===0,'UNEXPECTED_BROWSER_WRITE');
  report.steps.push({step:'n34b-real-supplier-live-chromium-selected',passed:true,ui:true,mutations:0});
  await actor.page.screenshot({path:path.join(OUT,'real-source-selected-readonly.png')});
  const after=await explicitSupplierProvenance(db,{productId:COHORT.product,candidateId:COHORT.candidate,expectedSupplierId:COHORT.supplier});
  check(after.preserved===true,'SUPPLIER_DRIFT_AFTER_UI');report.provenance_after=after;
  report.verdict='N34B_SHARED_PROVENANCE_PG_CHROMIUM_REVALIDATED_NOT_NEW_IMPORT';
  save();
 }catch(e){report.error=fullError(e);report.verdict='NOT_PROVEN';process.exitCode=2;save()}
 finally{if(actor)await actor.ctx.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});
   await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
