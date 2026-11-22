#!/usr/bin/env node
/** @komerce-arch-lite
 * @role g6-n34-readonly-chromium-preflight
 * @domain sourcing
 * @layer test
 * @owner backend-core
 * @purpose Prove N34a protected supplier is visible and N34b real source selectable in actual Chromium, without importing, publishing or pretending a scenario PASS.
 * @db-read suppliers
 * @db-write none
 * @impact-areas staging-only, sourcing, catalog
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {marketProfile}=require('./canonical/market-profile');
const {confirmTarget}=require('./target-guard');
const {centralHubIdentity}=require('./canonical/n34-source-oracles');
const {chooseSupplierFixtures,hasExactSupplierOptions}=require('./canonical/n34-screen-preflight');
const {login}=require('./g6-canonical-forwarder-chromium');
const {humanGoto,humanClick,humanSelect}=require('./canonical/actors/human-gestures');
const {observe,fullError}=require('./canonical/observability');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const OUT=path.resolve('test-results/g6-n34-readonly-preflight');
const report={schema:'komerce-g6-n34-screen-preflight/1',scenario_id:'N34',market:env.G6_TARGET_MARKET,
 verdict:'NOT_PROVEN',n34a:'NOT_PROVEN',n34b:'NOT_PROVEN',scenario_bound:false,db_write:false,
 external_supplier_calls:0,external_payment_executed:false,production_permitted:false,
 steps:[],missing:[]};
function check(ok,code){if(!ok)throw Error('G6_N34_'+code);}
function save(){fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');}
function ownerStaging(){
 return env.GITHUB_EVENT_NAME==='issues'&&env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&
 env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&
 env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&
 env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
 ['KM','CM','CG'].includes(env.G6_TARGET_MARKET)&&
 String(env.PGOPTIONS||'').includes('default_transaction_read_only=on')&&
 env.G6_N34_PREFLIGHT_ONLY==='1';
}
async function main(){
 let browser,actor,obs;
 try{
  save();check(ownerStaging(),'OWNER_STAGING_READONLY_GUARD');
  marketProfile(env);
  const target=await confirmTarget({db,env});
  check(target.confirmed&&!!target.fingerprint,'DB_IDENTITY_DRIFT');
  report.db_fingerprint=target.fingerprint;
  const versionResponse=await fetch(BASE+'/health/version');
  check(versionResponse.ok,'STAGING_HEALTH_UNAVAILABLE');
  const version=await versionResponse.json();
  check(/^[a-f0-9]{40}$/.test(String(env.E2E_EXPECTED_DEPLOY_SHA||''))&&
    version.commit===env.E2E_EXPECTED_DEPLOY_SHA,'STAGING_SHA_DRIFT');
  report.sha=version.commit;
  const identity=await centralHubIdentity(db);
  const {rows}=await db.query(
   "SELECT id,name,platform,system_key,is_active,deleted_at FROM suppliers WHERE is_active=TRUE AND deleted_at IS NULL ORDER BY id");
  const fixture=chooseSupplierFixtures(rows);
  check(identity.central_hub_id===fixture.hub.id,'CENTRAL_IDENTITY_PG_MISMATCH');
  report.hub_supplier=fixture.hub.id;report.real_supplier=fixture.real.id;
  report.steps.push({step:'pg-supplier-preflight',passed:true,db_write:false});save();
  browser=await chromium.launch({headless:true});obs=observe(browser,OUT);
  actor=await login(browser,'E2E_ADMIN_','admin');
  await humanGoto(actor.page,'/admin/suppliers/'+fixture.hub.id,{waitUntil:'domcontentloaded'});
  const heading=actor.page.locator('.kmc-entity-title');
  await heading.waitFor({state:'visible',timeout:25000});
  check((await heading.innerText()).trim()==='Fournisseur central Hub','CENTRAL_SUPPLIER_SCREEN_IDENTITY_DRIFT');
  const edits=actor.page.getByRole('button',{name:/supprimer|désactiver|modifier|archiver/i});
  check(await edits.count()===0,'CENTRAL_SUPPLIER_UI_MUTATION_AVAILABLE');
  await actor.page.screenshot({path:path.join(OUT,'hub-supplier-readonly.png')});
  report.steps.push({step:'n34a-supplier-360-visible-protected',passed:true,ui:true,mutations:0});save();
  await humanGoto(actor.page,'/admin/workspaces/sourcing?mode=manual',{waitUntil:'domcontentloaded'});
  const open=actor.page.locator('[data-workspace-action="manual-import"]');
  await open.waitFor({state:'visible',timeout:30000});
  await humanClick(null,open.first());
  const select=actor.page.locator('[data-manual-supplier]');
  await select.waitFor({state:'visible',timeout:20000});
  await actor.page.waitForFunction(()=>{const s=document.querySelector('[data-manual-supplier]');return s&&!s.disabled;},null,{timeout:20000});
  const options=await select.locator('option').evaluateAll(xs=>xs.map(x=>({id:x.value,key:x.getAttribute('data-system-key')||''})));
  check(hasExactSupplierOptions(options,fixture),'SOURCE_SELECTOR_IDENTITY_DRIFT');
  check(await select.inputValue()===fixture.hub.id,'SOURCE_DEFAULT_NOT_CENTRAL');
  await humanSelect(null,select,fixture.real.id);
  check(await select.inputValue()===fixture.real.id,'EXPLICIT_SOURCE_SELECTION_LOST');
  check(await select.locator('option:checked').getAttribute('data-system-key')=== '', 'EXPLICIT_SOURCE_REPLACED_BY_HUB');
  check(actor.blocked.length===0,'UNEXPECTED_BROWSER_WRITE_ATTEMPT');
  await actor.page.screenshot({path:path.join(OUT,'real-supplier-selected-no-submit.png')});
  const sameHub=await centralHubIdentity(db);
  check(sameHub.central_hub_id===fixture.hub.id,'HUB_IDENTITY_CHANGED');
  report.steps.push({step:'n34b-explicit-real-supplier-ui-selection',passed:true,ui:true,mutations:0});save();
  // A screen preflight is never a N34a/b certification: no negative mutation attempted
  // and no actual candidate has been promoted through Catalogue in this probe.
  report.verdict='N34_UI_READONLY_PREFLIGHT_PASS_NOT_BOUND';
  report.n34a='UI_READONLY_PROVEN_API_NEGATIVES_PENDING';
  report.n34b='UI_SELECT_PROVEN_PROMOTION_PENDING';
  report.scenario_bound=false;save();
 }catch(e){report.error=fullError(e);report.verdict='NOT_PROVEN';process.exitCode=2;save();}
 finally{if(obs)await obs.finish(!!process.exitCode).catch(()=>{});if(actor)await actor.ctx.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report));}
}
if(require.main===module)main();
