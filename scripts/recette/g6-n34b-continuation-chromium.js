#!/usr/bin/env node
/** @komerce-arch-lite
 * @role g6-n34b-continue-existing-candidate-chromium
 * @domain sourcing
 * @layer test
 * @owner backend-core
 * @purpose Complete the already imported real-supplier fixture using human category choices in Catalogue, then prove immutable source provenance.
 * @db-read sourcing_candidates, products, suppliers, purchase_orders, purchase_lines, purchase_order_authorizations
 * @db-write-via:browser sourcing_candidates, products
 * @impact-areas staging-only, sourcing, catalog
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),{isDeepStrictEqual}=require('node:util');
const {chromium}=require('playwright'),db=require('../../db');
const {marketProfile}=require('./canonical/market-profile'),{confirmTarget}=require('./target-guard');
const {centralHubIdentity,explicitSupplierProvenance}=require('./canonical/n34-source-oracles');
const {login}=require('./g6-canonical-forwarder-chromium');
const {humanGoto,humanClick,humanSelect}=require('./canonical/actors/human-gestures');
const {observe,fullError}=require('./canonical/observability');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const REF='KSC-000828',SOURCE_REF='G6-N34B-45021746722-A1';
const SUPPLIER='00f5609d-9bb0-4559-b688-8dc28db2f5ae',FAMILY='materiels';
const OUT=path.resolve('test-results/g6-n34b-continuation');
const report={schema:'komerce-g6-n34b-continuation/1',scenario_id:'N34b',
 market:'KM',candidate_ref:REF,source_ref:SOURCE_REF,expected_supplier_id:SUPPLIER,
 verdict:'NOT_PROVEN',scenario_bound:false,production_permitted:false,external_supplier_calls:0,
 external_payment_executed:false,steps:[],events:[],missing:[]};
function check(ok,code){if(!ok)throw Error('G6_N34B_CONTINUE_'+code)}
function save(){fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')}
async function visible(loc,timeout=5000){try{await loc.first().waitFor({state:'visible',timeout});return true}catch(_){return false}}
function owner(){
 return env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
 env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&
 env.KOMERCE_ENV==='staging'&&env.KOMERCE_TARGET_ENV==='staging'&&
 env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
 env.G6_TARGET_MARKET==='KM'&&env.G6_N34B_CONTINUE_REF===REF&&
 env.G6_N34B_CONTINUE_OWNER_APPROVED==='1';
}
async function candidate(){
 const {rows}=await db.query(
  `SELECT id,candidate_ref,supplier_id,supplier_product_id,product_name,supplier_category,
   state,product_id,komerce_category,scan_result
   FROM sourcing_candidates WHERE candidate_ref=$1 AND supplier_product_id=$2 AND supplier_id=$3`,
   [REF,SOURCE_REF,SUPPLIER]);
 check(rows.length===1,'EXISTING_CANDIDATE_NOT_UNIQUE');
 const x=rows[0];check(x.product_name?.includes('Coffret de tournevis')&&
  x.supplier_category==='Bricolage > Outillage','ORIGINAL_PRODUCT_FACTS_DRIFT');
 check(!['rejected','quarantined','archived'].includes(x.state),'CANDIDATE_NOT_ALLOWED');
 return x;
}
async function hubMoney(id){
 const {rows}=await db.query(`SELECT
 (SELECT COUNT(*)::int FROM purchase_orders WHERE supplier_id=$1) po_count,
 (SELECT COUNT(*)::int FROM purchase_lines WHERE supplier_id=$1 AND cancelled_at IS NULL) line_count,
 (SELECT COUNT(*)::int FROM purchase_order_authorizations a
  JOIN purchase_orders po ON po.id=a.purchase_order_id WHERE po.supplier_id=$1) authorization_count`,[id]);
 check(rows.length===1,'HUB_FINANCE_MISSING');return rows[0];
}
async function allowPost(actor,uri,expected,gesture,stage){
 const url=BASE+uri;let permitted=0,blocked=0;
 const handler=route=>{
  const req=route.request();let body=null;try{body=req.postDataJSON()}catch(_){}
  if(req.method()==='POST'&&!permitted&&expected(body)){permitted++;return route.continue()}
  blocked++;return route.abort('blockedbyclient');
 };
 await actor.page.route(url,handler);
 try{
  const pending=actor.page.waitForResponse(r=>r.url()===url&&r.request().method()==='POST',{timeout:40000});
  await gesture();
  const res=await pending,body=await res.json().catch(()=>({}));
  report.events.push({stage,status:res.status(),post_count:permitted,ui:true});save();
  check(permitted===1&&blocked===0&&actor.blocked.length===0&&res.status()>=200&&res.status()<300,
   stage.toUpperCase()+'_POST_NOT_PROVEN_'+res.status());
  return body;
 }finally{await actor.page.unroute(url,handler)}
}
async function inspect(actor){
 await humanGoto(actor.page,'/admin/workspaces/catalog?search='+encodeURIComponent(REF),{waitUntil:'domcontentloaded'});
 const row=actor.page.locator('tr[data-candidate-ref="'+REF+'"]');
 check(await visible(row,25000),'CATALOG_CANDIDATE_ROW_MISSING');
 const button=row.locator('[data-workspace-action="inspect-candidate"]');
 check(await visible(button,7000),'INSPECT_BUTTON_MISSING');
 await humanClick(null,button);
 const panel=actor.page.locator('[data-catalog-candidate-inspector="'+REF+'"]');
 check(await visible(panel,7000),'INSPECTOR_NOT_OPEN');return panel;
}
async function economicCategory(actor,existing){
 if(existing.komerce_category===FAMILY){
  report.steps.push({stage:'existing-family',family:FAMILY,no_write:true});return
 }
 check(!existing.komerce_category,'FOREIGN_ECONOMIC_CLASSIFICATION');
 const panel=await inspect(actor),open=panel.locator('[data-workspace-action="candidate-economic-category-review"]');
 check(await visible(open,5000),'ECONOMIC_REVIEW_NOT_OFFERED');
 await humanClick(null,open);
 const select=panel.locator('[data-catalog-economic-category-choice]');
 check(await visible(select,10000),'ECONOMIC_CHOICES_NOT_PRESENT');
 const options=await select.locator('option').evaluateAll(xs=>xs.map(x=>({value:x.value,label:x.textContent.trim()})));
 const applicable=options.filter(x=>/^Petits Materiels$/i.test(x.label));
 check(applicable.length===1,'MATERIELS_UI_OPTION_NOT_UNIQUE');
 // The fixture is explicitly a screwdriver kit, supplier category Bricolage > Outillage.
 // This active option says Petits Materiels (Outillage). No automatic suggestion is claimed.
 report.category_choice={family:FAMILY,ui_label:applicable[0].label,
  basis:'Coffret de tournevis | Bricolage > Outillage | catégorie économique existante Petits Materiels',
  human_choice:true,auto_suggested:false};save();
 await actor.page.screenshot({path:path.join(OUT,'economic-category-before-choice.png')});
 const response=await allowPost(actor,'/api/admin/workspaces/sourcing/candidates/'+REF+'/resolve-category',
  b=>b?.category_key===FAMILY,
  ()=>humanSelect(null,select,applicable[0].value),'economic-category');
 check(response?.ok===true,'CATEGORY_ACTION_NO_SUCCESS');
 const after=await candidate();check(after.komerce_category===FAMILY,'FAMILY_NOT_PERSISTED');
 report.steps.push({stage:'economic-category',family:FAMILY,ui:true,decision:after.scan_result?.sourcing_decision});save();
}
async function boutiqueCategory(actor){
 const panel=await inspect(actor);
 // Catalogue calls loadBoutiqueProposal() automatically when the inspector opens.
 // The refresh button is then HIDDEN on success: never click a disappearing button.
 const select=panel.locator('[data-catalog-candidate-category-choice]');
 if(!await visible(select,12000)){
  // Only if autoload did not create the form, one GET-only retry is permitted.
  const refresh=panel.locator('[data-workspace-action="candidate-boutique-review"]');
  if(!await visible(refresh,3000))return false;
  await humanClick(null,refresh);
  check(await visible(select,12000),'BOUTIQUE_CATEGORY_CHOICES_MISSING');
 }
 const options=await select.locator('option').evaluateAll(xs=>xs.map(x=>({value:x.value,label:x.textContent.trim()})));
 // UI subcategory_label is "Outils & Fixation"; canonical key stays "Outillage".
 // Verify the exact canonical payload before allowing the write.
 const applicable=options.filter(x=>/^(?:Proposé · )?Bricolage\s*›\s*Outils & Fixation$/i.test(x.label));
 check(applicable.length===1,'BOUTIQUE_OUTILLAGE_NOT_OFFERED');
 const choose=applicable[0],categoryOnly=await panel.locator('[data-category-only-review]').count()>0;
 report.boutique_choice={category:'Bricolage',subcategory:'Outillage',label:choose.label,source:'existing active Catalogue pair',human_choice:true};save();
 await actor.page.screenshot({path:path.join(OUT,'boutique-before-choice.png')});
 const answer=await allowPost(actor,'/api/admin/workspaces/sourcing/candidates/'+REF+'/confirm-boutique-category',
  b=>b?.category==='Bricolage'&&b?.subcategory==='Outillage',
  async()=>{
   if(choose.label.startsWith('Proposé · ')){
    // Suggested option is already selected; selecting the same value may not submit.
    // A deliberate operator click confirms the review_required proposal.
    check(await select.inputValue()===choose.value,'BOUTIQUE_PROPOSAL_NOT_SELECTED');
    const apply=panel.locator('[data-workspace-action="candidate-apply-boutique-suggestion"]');
    check(await visible(apply,5000),'BOUTIQUE_APPLY_PROPOSAL_MISSING');
    await humanClick(null,apply);
   }else{
    await humanSelect(null,select,choose.value);
    if(categoryOnly){const save=panel.locator('[data-workspace-action="confirm-candidate-boutique"]');
     check(await visible(save,5000),'BOUTIQUE_CONFIRM_NOT_PRESENT');await humanClick(null,save)}
   }
  },'boutique-classification');
 check(answer?.ok===true,'BOUTIQUE_ACTION_NO_SUCCESS');
 report.steps.push({stage:'boutique-category',ui:true,draft_created:!!answer?.result?.draft_created});save();
 return true;
}
async function promote(actor){
 await humanGoto(actor.page,'/admin/workspaces/sourcing?candidate_ref='+encodeURIComponent(REF),{waitUntil:'domcontentloaded'});
 const row=actor.page.locator('[data-sourcing-candidate="'+REF+'"]');
 check(await visible(row,22000),'SOURCING_ROW_NOT_VISIBLE');
 const button=row.locator('[data-sourcing-promote]');
 if(!await visible(button,7000))return false;
 const result=await allowPost(actor,'/api/admin/workspaces/sourcing/candidates/'+REF+'/promote',
  b=>b==null||isDeepStrictEqual(b,{}),
  ()=>humanClick(null,button),'promote');
 report.steps.push({stage:'promote-draft',ui:true,product_ref:result?.result?.product_ref});save();
 return true;
}
async function main(){
 let browser,actor,obs;
 try{
  save();check(owner(),'OWNER_STAGING_GUARD');marketProfile(env);
  const target=await confirmTarget({db,env});
  check(target.confirmed&&!!target.fingerprint,'TARGET_DRIFT');report.db_fingerprint=target.fingerprint;
  const h=await fetch(BASE+'/health/version');check(h.ok===true,'HEALTH_UNAVAILABLE');
  const version=await h.json();check(/^[0-9a-f]{40}$/.test(String(env.E2E_EXPECTED_DEPLOY_SHA||''))&&
    version.commit===env.E2E_EXPECTED_DEPLOY_SHA,'DEPLOY_SHA_DRIFT');report.sha=version.commit;
  const {rows:hubRows}=await db.query("SELECT id FROM suppliers WHERE system_key='central_hub'");
  check(hubRows.length===1,'CENTRAL_HUB_NOT_UNIQUE');
  const hub=await centralHubIdentity(db);check(hubRows[0].id===hub.central_hub_id,'HUB_SHAPE_DRIFT');
  const {rows:real}=await db.query('SELECT id,is_active,deleted_at,system_key FROM suppliers WHERE id=$1',[SUPPLIER]);
  check(real.length===1&&real[0].is_active===true&&real[0].deleted_at==null&&real[0].system_key==null,
   'REAL_SUPPLIER_INVALID');
  let cand=await candidate();report.before_candidate={state:cand.state,decision:cand.scan_result?.sourcing_decision,
   economic_category:cand.komerce_category,product_id:cand.product_id};
  check(cand.komerce_category==null||cand.komerce_category===FAMILY,'UNAPPROVED_CLASSIFICATION_CHANGE');
  const money=await hubMoney(hub.central_hub_id);report.before_hub_finance=money;save();
  browser=await chromium.launch({headless:true});obs=observe(browser,OUT);
  actor=await login(browser,'E2E_ADMIN_','admin');
  await economicCategory(actor,cand);
  cand=await candidate();
  // Boutique classification may be mandatory even after a TEST scan; prefer its real UI when offered.
  if(!cand.product_id){
   const boutique=await boutiqueCategory(actor);
   report.boutique_ui_available=boutique;save();
  }
  cand=await candidate();
  if(!cand.product_id)report.promote_ui_available=await promote(actor);
  cand=await candidate();
  if(!cand.product_id){
   report.missing.push({code:'N34B_EXISTING_CANDIDATE_NOT_PROMOTABLE',state:cand.state,
     decision:cand.scan_result?.sourcing_decision,economic_category:cand.komerce_category,
     boutique_ui_available:report.boutique_ui_available,promote_ui_available:report.promote_ui_available});
   report.verdict='NOT_PROVEN';save();process.exitCode=2;return
  }
  const result=await explicitSupplierProvenance(db,
   {productId:cand.product_id,candidateId:cand.id,expectedSupplierId:SUPPLIER});
  report.provenance=result;
  const after=await hubMoney(hub.central_hub_id);
  check(isDeepStrictEqual(money,after),'FICTITIOUS_HUB_DEBT_OR_PO');
  check(actor.blocked.length===0,'UNEXPECTED_BROWSER_MUTATION');
  report.after_hub_finance=after;report.catalogue_product_id=cand.product_id;
  report.verdict='N34B_REAL_SOURCE_DRAFT_CHROMIUM_PG_PASS_NOT_FULL';
  report.next_stage='CATALOGUE_PUBLICATION_AND_N34A_NEGATIVES';
  save();
 }catch(e){report.error=fullError(e);report.verdict='NOT_PROVEN';process.exitCode=2;save();}
 finally{if(obs)await obs.finish(!!process.exitCode).catch(()=>{});
  if(actor)await actor.ctx.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});
  await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
