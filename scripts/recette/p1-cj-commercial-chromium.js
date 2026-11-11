#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role p1-cj-commercial-chromium
 * @domain catalog
 * @layer tooling
 * @owner backend-core
 * @purpose Explicit owner-authorized staging Chromium review, Catalogue approval and KM price activation; no human attestation.
 * @db-read products,sourcing_candidates,catalog_media,catalog_media_visual_fr_reviews,product_market_exposure,product_market_price_drafts,catalog_publication_decision_audit
 * @db-write none (canonical UI writers only)
 * @impact-areas catalog,market-delegation,economic-engine,staging-only
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const {confirmTarget}=require('./target-guard');
const BASE='https://komerce-backend-production.up.railway.app';
const REFS=['KPR-000099','KPR-000100','KPR-000101'];
const OUT=path.resolve('test-results/p1-cj-commercial-chromium');
const INSPECTIONS=require('./p1-cj-media-inspection.json');
function checkEnv(e){
 if(e.GITHUB_ACTIONS!=='true'||e.GITHUB_EVENT_NAME!=='issues'||e.GITHUB_ACTOR!==e.GITHUB_REPOSITORY_OWNER||
    e.KOMERCE_ENV!=='staging'||e.EXPECTED_RAILWAY_ENVIRONMENT!=='staging'||e.STAGING_BASE_URL!==BASE||
    e.G6_CJ_COMMERCIAL_APPROVED!=='STAGING_ONLY_3_CJ_TEST'||!/^\d{5,20}$/.test(e.GITHUB_RUN_ID||'')||
    !/^[a-f0-9]{40}$/i.test(e.E2E_EXPECTED_DEPLOY_SHA||'')||
    !String(e.PGOPTIONS||'').includes('default_transaction_read_only=on')||
    !e.E2E_ADMIN_EMAIL||!e.E2E_ADMIN_PASSWORD||!e.E2E_MARKET_OPERATOR_EMAIL||!e.E2E_MARKET_OPERATOR_PASSWORD)
  throw Error('OWNER_APPROVED_STAGING_CAMPAIGN_REQUIRED');
}
function mutationAllowed(url,method,ref,productId,role){
 const u=new URL(url);if(['GET','HEAD','OPTIONS'].includes(method))return true;
 if(u.origin!==BASE||method!=='POST'||!REFS.includes(ref))return false;
 if(role==='admin')return u.pathname==='/api/admin/workspaces/catalog/approval/'+ref+'/approve'||
   new RegExp('^/api/admin/catalog/approval-queue/'+productId+'/media/[0-9a-f-]{36}/visual-fr-review$','i').test(u.pathname);
 return role==='market_operator'&&[
  '/api/admin/workspaces/pricing/market/KM/products/'+ref+'/local-price',
  '/api/admin/workspaces/pricing/market/KM/products/'+ref+'/local-price/activate'
 ].includes(u.pathname);
}
function choosePrice(corridor){
 if(corridor.market?.code!=='KM'||corridor.market?.currency!=='KMF')throw Error('KM_KMF_REQUIRED');
 const economics=corridor.selected?.economics;
 const value=Number(economics?.coverage_reference_price_kmf ?? economics?.minimum_safe_price_kmf);
 if(!Number.isFinite(value)||value<=0)throw Error('CANONICAL_ECONOMIC_PRICE_MISSING');
 return Math.ceil(value);
}
async function state(db,ref){
 const c=await db.pool.connect();try{
  await c.query('BEGIN READ ONLY');await c.query("SET LOCAL statement_timeout='12000ms'");
 const {rows}=await c.query(`SELECT p.id,p.product_ref,p.name,p.lifecycle_status,p.is_active,p.is_available,p.inventory_model,
   (SELECT sc.scan_result->>'sourcing_decision' FROM sourcing_candidates sc WHERE sc.product_id=p.id
      AND sc.state='imported_to_catalog' ORDER BY sc.updated_at DESC LIMIT 1) AS source_decision,
   (SELECT jsonb_agg(to_jsonb(cm)||jsonb_build_object('review',to_jsonb(vr)) ORDER BY cm.display_order,cm.created_at)
    FROM catalog_media cm LEFT JOIN catalog_media_visual_fr_reviews vr ON vr.media_id=cm.id WHERE cm.product_id=p.id AND cm.is_active=TRUE) AS media,
   (SELECT jsonb_agg(to_jsonb(d)) FROM product_market_price_drafts d JOIN markets m ON m.id=d.market_id WHERE d.product_id=p.id AND m.code='KM') AS prices,
   (SELECT jsonb_agg(jsonb_build_object('market',m.code,'exposure',e.commercial_exposure)) FROM product_market_exposure e JOIN markets m ON m.id=e.market_id WHERE e.product_id=p.id) AS exposure,
   (SELECT jsonb_agg(to_jsonb(a)) FROM catalog_publication_decision_audit a WHERE a.product_id=p.id) AS publication_audit
   FROM products p WHERE p.product_ref=$1`,[ref]);
  await c.query('ROLLBACK');return rows[0];
 }finally{await c.query('ROLLBACK').catch(()=>{});c.release();}
}
async function run(e=process.env){
 checkEnv(e);fs.mkdirSync(OUT,{recursive:true});
 const db=require('../../db');const report={schema:'g6-p1-commercial-chromium/1',run_id:e.GITHUB_RUN_ID,
  sha:e.E2E_EXPECTED_DEPLOY_SHA,market:'KM',mode:'AUTOMATED_STAGING',human_attestation:false,
  verdict:'NOT_PROVEN',records:[],started_at:new Date().toISOString()};
 let browser;
 const save=()=>fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');
 async function economicPreflight(){
  const {rows:[market]}=await db.query("SELECT id,code,currency,is_active FROM markets WHERE code='KM'");
  if(!market?.is_active||market.currency!=='KMF')throw Error('KM_MARKET_NOT_READY');
  const config=await require('../../services/pricing-cdr').loadGlobalConfig({marketId:market.id});
  report.economic_audit={scope:'CONFIGURATION_AND_ARITHMETIC_NOT_ACTUAL_CHARGES',
   config,products:[],warnings:[],blockers:[]};
  const audit=report.economic_audit;
  if(!config.components.length||!Object.keys(config.finance).length)audit.blockers.push('ECONOMIC_CONFIGURATION_MISSING');
  const keys=config.components.map(c=>c.key);
  if(new Set(keys).size!==keys.length)audit.blockers.push('DUPLICATE_EFFECTIVE_COMPONENT_KEYS');
  for(const ref of REFS){
   const product=await state(db,ref);if(product?.source_decision!=='TEST')throw Error('NON_TEST_SOURCE_REFUSED');
   const economics=await require('../../services/pricing-engine').recommend({product_id:product.id},{config});
   audit.products.push({ref,economics});
   for(const field of economics.data_quality?.missing_fields||[])audit.blockers.push(ref+':MISSING_'+field);
   const sum=Number(economics.purchase_cost_kmf)+Number(economics.variable_cost_outside_purchase_kmf);
   if(!Number.isFinite(sum)||Math.abs(sum-Number(economics.variable_cost_complete_kmf))>2)
    audit.blockers.push(ref+':VARIABLE_COST_CHAIN_INCONSISTENT');
   if(!(Number(economics.minimum_safe_price_kmf)>0)||!(Number(economics.economic_reference_price_kmf)>0))
    audit.blockers.push(ref+':ECONOMIC_PRICE_REFERENCE_MISSING');
   audit.warnings.push(...(economics.warnings||[]).map(w=>ref+':'+w));
  }
  save();if(audit.blockers.length)throw Error('ECONOMIC_INITIALIZATION_REQUIRED:'+audit.blockers.join(','));
 }
 async function version(){const v=await fetch(BASE+'/health/version').then(r=>r.json());if(v.commit!==report.sha)throw Error('STAGING_SHA_CHANGED');}
 async function checkpoint(record,label,ctx){
  await version();const sql=await state(db,record.ref);if(sql?.source_decision!=='TEST')throw Error('NON_TEST_SOURCE_REFUSED');
  const r=await ctx.request.get(BASE+'/api/admin/catalog/approval-queue/'+sql.id+'/visual-fr-proof');
  record.checkpoints.push({label,at:new Date().toISOString(),sql,canonical_http:r.status(),canonical:await r.json()});save();return sql;
 }
 async function auth(role){
  const ctx=await browser.newContext({viewport:{width:1440,height:900},locale:'fr-FR'});
  const p=role==='admin'?'E2E_ADMIN':'E2E_MARKET_OPERATOR';
  const r=await ctx.request.post(BASE+'/api/auth/login',{data:{email:e[p+'_EMAIL'],password:e[p+'_PASSWORD']},timeout:20000});
  if(r.status()!==200)throw Error('LOGIN_FAILED_'+role);
  const who=await ctx.request.get(BASE+'/api/auth/me').then(r=>r.json());if(who.role!==role)throw Error('ACTOR_ROLE_MISMATCH');
  return {ctx,who};
 }
 async function gesture(page,record,label,url,click){
  const before=await state(db,record.ref);await version();
  const responsePromise=page.waitForResponse(r=>r.url()===BASE+url&&r.request().method()==='POST',{timeout:30000});
  await click();const response=await responsePromise;
  const body=await response.json().catch(()=>({}));
  const after=await state(db,record.ref);
  record.gestures.push({label,at:new Date().toISOString(),before,http:response.status(),body,after});save();
  if(!response.ok())throw Error(label+':HTTP_'+response.status()+':'+(body.code||body.error||''));
 }
 try{
  const target=await confirmTarget({db,env:e});if(!target.confirmed)throw Error('TARGET_NOT_CONFIRMED');
  report.db_fingerprint=target.fingerprint;await version();await economicPreflight();browser=await chromium.launch({headless:true});
  const admin=await auth('admin');
  try{for(const ref of REFS){
   const record={ref,actor:admin.who.id,checkpoints:[],gestures:[],blocked_mutations:[],status:'NOT_PROVEN'};report.records.push(record);
   const before=await checkpoint(record,'BEFORE_REVIEW',admin.ctx);
   if(before.is_active===true&&before.lifecycle_status==='active'){
    const plans=INSPECTIONS.filter(x=>x.ref===ref);
    if(before.media?.length!==plans.length||!before.publication_audit?.length||
      record.checkpoints.at(-1).canonical.visual_fr_certified!==true||
      !plans.every(plan=>before.media.some(m=>m.source_media_id===plan.source_media_id&&m.url===plan.source_url&&
        m.review?.source_url===plan.source_url&&m.review?.text_presence===plan.text_presence&&
        /^automation:github-actions:\d{5,20}:[0-9a-f-]{36}$/i.test(m.review?.reviewed_by||''))))
     throw Error('PREVIOUS_CATALOG_APPROVAL_NOT_PROVEN:'+ref);
    for(const plan of plans){
     const raw=await admin.ctx.request.get(plan.source_url);
     if(!raw.ok()||crypto.createHash('sha256').update(await raw.body()).digest('hex')!==plan.sha256)
      throw Error('PREVIOUS_SOURCE_PIXELS_CHANGED:'+ref);
    }
    record.capitalized_review_runs=[...new Set(before.media.map(m=>m.review.reviewed_by.split(':')[2]))];
    record.status='CATALOG_APPROVAL_CAPITALIZED_NOT_REPLAYED';save();continue;
   }
   if(before.is_active!==false||before.lifecycle_status!=='candidate')throw Error('EXPECTED_INACTIVE_CANDIDATE:'+ref);
   const page=await admin.ctx.newPage();
   await page.route('**/*',route=>{
    if(mutationAllowed(route.request().url(),route.request().method(),ref,before.id,'admin'))return route.continue();
    record.blocked_mutations.push({method:route.request().method(),path:new URL(route.request().url()).pathname});return route.abort();
   });
   await page.goto(BASE+'/admin/workspaces/catalog?search='+ref+'&product_ref='+ref,{waitUntil:'domcontentloaded'});
   const row=page.locator('tr[data-product-ref="'+ref+'"]');await row.waitFor({state:'visible',timeout:25000});
   await row.locator('[data-workspace-action="open-catalog-inspector"]').click();
   for(const plan of INSPECTIONS.filter(x=>x.ref===ref)){
    const raw=await admin.ctx.request.get(plan.source_url);if(!raw.ok())throw Error('SOURCE_IMAGE_UNAVAILABLE');
    if(crypto.createHash('sha256').update(await raw.body()).digest('hex')!==plan.sha256)throw Error('SOURCE_PIXELS_CHANGED:'+plan.source_media_id);
    const figure=page.locator('[data-catalog-canonical-gallery] figure').nth(plan.index);
    // Saving the previous review advances the inspector exactly one image.
    await figure.waitFor({state:'visible',timeout:20000});
    const image=figure.locator('img');if(await image.getAttribute('src')!==plan.source_url)throw Error('SOURCE_ORDER_DRIFT');
    await image.evaluate(img=>img.decode());
    const form=figure.locator('[data-catalog-visual-fr-media]');
    const mediaId=await form.getAttribute('data-catalog-visual-fr-media');
    const exact=before.media.find(m=>m.id===mediaId);
    if(!exact||exact.source_media_id!==plan.source_media_id||exact.url!==plan.source_url)throw Error('SOURCE_IDENTITY_DRIFT');
    await form.locator(':scope > summary').click();
    const presence=form.locator('select').first();if(await presence.inputValue()!=='')throw Error('PRESELECTED_REVIEW');
    await presence.selectOption(plan.text_presence);
    await form.locator('[data-review-execution-mode]').selectOption('AUTOMATED_STAGING');
    await form.locator('[data-review-run-id]').fill(e.GITHUB_RUN_ID);
    await form.locator('input[type="checkbox"]').check();
    await figure.screenshot({path:path.join(OUT,ref+'-media-'+(plan.index+1)+'-before.png')});
    const url='/api/admin/catalog/approval-queue/'+before.id+'/media/'+mediaId+'/visual-fr-review';
    await gesture(page,record,'VISUAL_REVIEW_'+mediaId,url,()=>form.getByRole('button',{name:'Enregistrer la revue automatisée de recette',exact:true}).click());
    const sql=await checkpoint(record,'AFTER_REVIEW_'+mediaId,admin.ctx);
    const reviewed=sql.media.find(m=>m.id===mediaId)?.review;
    if(reviewed?.reviewed_by!=='automation:github-actions:'+e.GITHUB_RUN_ID+':'+admin.who.id||reviewed?.source_url!==plan.source_url||reviewed?.text_presence!==plan.text_presence)
     throw Error('PERSISTED_AUTOMATION_REVIEW_NOT_MATCHED');
   }
   await page.locator('[data-catalog-approval-details] > summary').click();
   await page.locator('[data-workspace-action="inspector-check-approval"]').click();
   const approve=page.locator('[data-workspace-action="inspector-approve"]');await approve.waitFor({state:'visible',timeout:20000});
   page.once('dialog',dialog=>dialog.accept());
   await gesture(page,record,'CATALOG_APPROVAL','/api/admin/workspaces/catalog/approval/'+ref+'/approve',()=>approve.click());
   const approved=await checkpoint(record,'AFTER_CATALOG_APPROVAL',admin.ctx);
   if(!approved.is_active||approved.lifecycle_status!=='active'||!approved.publication_audit?.length)throw Error('CATALOG_APPROVAL_NOT_PERSISTED');
   if(record.blocked_mutations.length)throw Error('UNEXPECTED_ADMIN_MUTATION');
   await page.screenshot({path:path.join(OUT,ref+'-catalogue-approved.png')});await page.close();record.status='CATALOG_APPROVED_AUTOMATED_STAGING';save();
  }}finally{await admin.ctx.close();}
  const market=await auth('market_operator');
  try{for(const record of report.records){
   const ref=record.ref;record.market_actor=market.who.id;
   const before=await state(db,ref);
   const corridorResponse=await market.ctx.request.get(BASE+'/api/admin/workspaces/pricing/market/KM/corridor?product_ref='+ref);
   const corridor=await corridorResponse.json();record.corridor_read={http:corridorResponse.status(),body:corridor};save();
   if(!corridorResponse.ok())throw Error('ECONOMICS_UNAVAILABLE:'+ref+':'+corridorResponse.status()+':'+(corridor.code||''));
   record.economic_price_source=corridor;
   const amount=choosePrice(corridor);record.selected_price_kmf=amount;save();
   const page=await market.ctx.newPage();
   await page.route('**/*',route=>{
    if(mutationAllowed(route.request().url(),route.request().method(),ref,before.id,'market_operator'))return route.continue();
    record.blocked_mutations.push({method:route.request().method(),path:new URL(route.request().url()).pathname});return route.abort();
   });
   await page.goto(BASE+'/dashboards/canonical/market-autonomy.html?market=KM',{waitUntil:'domcontentloaded'});
   const row=page.locator('tr.kmc-autonomy-row').filter({hasText:ref});await row.waitFor({state:'visible',timeout:25000});
   await row.getByRole('button',{name:'Gérer le prix',exact:true}).click();
   await row.locator('input[type="number"]').fill(String(amount));
   await row.getByPlaceholder('Motif de décision').fill('Recette Chromium automatisée '+e.GITHUB_RUN_ID+' : prix de référence du moteur économique canonique, staging uniquement');
   const price='/api/admin/workspaces/pricing/market/KM/products/'+ref+'/local-price';
   await gesture(page,record,'LOCAL_PRICE_DRAFT',price,()=>row.getByRole('button',{name:'Enregistrer',exact:true}).click());
   const previewResponse=await market.ctx.request.get(BASE+price+'/activation-preview');
   record.activation_preview={http:previewResponse.status(),body:await previewResponse.json()};save();
   if(!previewResponse.ok()||record.activation_preview.body.activation?.allowed!==true)throw Error('ECONOMIC_GATE_REFUSED:'+ref);
   // Re-render after draft: expand the same business row and explicitly activate.
   await row.getByRole('button',{name:'Gérer le prix',exact:true}).click();
   await gesture(page,record,'LOCAL_PRICE_ACTIVATE_AND_EXPOSE',price+'/activate',()=>row.getByRole('button',{name:'Activer le prix',exact:true}).click());
   const sql=await state(db,ref);record.after_market=sql;
   if(!sql.prices?.some(p=>p.status==='LOCAL_ACTIVE'&&Number(p.amount)===amount)||!sql.exposure?.some(x=>x.market==='KM'&&x.exposure==='ENABLED'))throw Error('MARKET_READBACK_NOT_MATCHED');
   if(sql.exposure?.some(x=>x.market!=='KM'&&x.exposure==='ENABLED'))throw Error('UNEXPECTED_CROSS_MARKET_EXPOSURE');
   if(record.blocked_mutations.length)throw Error('UNEXPECTED_MARKET_MUTATION');
   await page.screenshot({path:path.join(OUT,ref+'-km-price-active.png')});await page.close();record.status='KM_EXPOSED_SQL_CONFIRMED';save();
  }}finally{await market.ctx.close();}
  const buyer=await browser.newContext({viewport:{width:1440,height:900},locale:'fr-FR'});
  try{const page=await buyer.newPage();await page.route('**/*',route=>['GET','HEAD','OPTIONS'].includes(route.request().method())?route.continue():route.abort());
   await page.goto(BASE+'/boutique/?market=KM',{waitUntil:'domcontentloaded'});
   for(const record of report.records){
    const res=await buyer.request.get(BASE+'/api/products/'+record.after_market.id+'/detail?market=KM');
    record.buyer_detail={http:res.status(),body:await res.json()};save();if(!res.ok())throw Error('BUYER_PRODUCT_NOT_VISIBLE:'+record.ref);
    if(record.buyer_detail.body.product?.reference!==record.ref||Number(record.buyer_detail.body.pricing?.price_kmf)!==record.selected_price_kmf)
     throw Error('BUYER_IDENTITY_OR_PRICE_MISMATCH:'+record.ref);
    const search=page.locator('#k-search-input');await search.fill(record.checkpoints[0].sql.name);
    const result=page.locator('#k-search-dropdown .k-search-item[data-id="'+record.after_market.id+'"]');
    await result.waitFor({state:'visible',timeout:20000});
    await page.screenshot({path:path.join(OUT,record.ref+'-boutique.png')});
    record.status='P1_KM_AUTOMATED_STAGING_PASS';
   }
  }finally{await buyer.close();}
  await version();report.verdict='P1_KM_AUTOMATED_STAGING_PASS';
 }catch(error){report.verdict='BLOCKED';report.error=String(error.message).slice(0,350);process.exitCode=2;}
 finally{if(browser)await browser.close();await db.pool.end();report.finished_at=new Date().toISOString();save();console.log(JSON.stringify({verdict:report.verdict,error:report.error,run_id:report.run_id,records:report.records.map(x=>({ref:x.ref,status:x.status})),human_attestation:false}));}
 return report;
}
if(require.main===module)run().catch(e=>{console.error(e.message);process.exitCode=2});
module.exports={checkEnv,mutationAllowed,choosePrice,run};
