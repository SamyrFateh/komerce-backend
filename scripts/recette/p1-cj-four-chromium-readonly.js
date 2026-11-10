#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch-lite
 * @role p1-cj-four-real-chromium-commercial-boundaries-readonly
 * @domain catalog
 * @layer tooling
 * @owner backend-core
 * @purpose Inspect exact real CJ candidates in authenticated Catalogue/Pricing/Market and anonymous boutique at 1440px.
 * @db-read none
 * @db-write none
 * @impact-areas catalog,market,economic-engine,boutique,staging-only,e2e-certification
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const BASE = 'https://komerce-backend-production.up.railway.app';
const REFS = Object.freeze(['KPR-000099','KPR-000100','KPR-000101']);
const ALL = Object.freeze(['KPR-000098',...REFS]);
const EXPECTED_MEDIA = Object.freeze({ 'KPR-000099':5, 'KPR-000100':5, 'KPR-000101':6 });
const OUT = path.resolve('test-results/p1-cj-chromium');
function guard(env=process.env){
  if (env.GITHUB_ACTIONS!=='true' || env.GITHUB_EVENT_NAME!=='issues'
    || env.GITHUB_ACTOR!==env.GITHUB_REPOSITORY_OWNER
    || env.KOMERCE_ENV!=='staging' || env.KOMERCE_TARGET_ENV!=='staging'
    || env.EXPECTED_RAILWAY_ENVIRONMENT!=='staging'
    || env.STAGING_BASE_URL!==BASE || env.NODE_ENV!=='test'
    || !/^[a-f0-9]{40}$/i.test(env.E2E_EXPECTED_DEPLOY_SHA||''))
      throw Error('P1_CJ_STAGING_OWNER_READONLY_GUARD');
}
function safeName(s){return String(s).replace(/[^a-z0-9_-]/gi,'-').slice(0,90);}
async function run(env=process.env){
  guard(env);
  fs.mkdirSync(OUT,{recursive:true});
  const report = {
    schema:'p1-cj-four-browser-boundary/1',
    scope:'KIR-000014',products:ALL,
    target:BASE,viewport:{width:1440,height:900},
    mode:'READ_ONLY',business_writes:0,
    verdict:'NOT_PROVEN',started_at:new Date().toISOString(),
    browser:[],market:'KM',future_markets:['CM','CG'],never_claims:'P1_PUBLICATION_OR_PRICE_GO'
  };
  let browser;
  try{
    const v=await fetch(BASE+'/health/version').then(r=>r.json());
    const sha=String(v.commit||v.sha||'');
    if(sha!==env.E2E_EXPECTED_DEPLOY_SHA)throw Error('P1_CJ_RUNTIME_SHA_DRIFT');
    report.runtime_sha=sha;
    browser=await chromium.launch({headless:true});
    async function inspect(role,where,ref,label){
      const context=await browser.newContext({
        viewport:{width:1440,height:900},locale:'fr-FR',ignoreHTTPSErrors:false,
      });
      const row={role,stage:label,ref:ref||null,route:where,http:null,
        visible_ref:false,body_excerpt:null,api:[],blocked_requests:[],verdict:'NOT_PROVEN'};
      try{
        if(role!=='anonymous'){
          const prefix=role==='admin'?'E2E_ADMIN':'E2E_MARKET_OPERATOR';
          const email=env[prefix+'_EMAIL'],password=env[prefix+'_PASSWORD'];
          if(!email||!password)throw Error('DEDICATED_E2E_ROLE_CREDENTIALS_MISSING');
          const login=await context.request.post(BASE+'/api/auth/login',{
            data:{email,password},timeout:15000
          });
          row.login_http=login.status();
          if(login.status()!==200)throw Error('DEDICATED_E2E_ROLE_LOGIN_REFUSED_'+login.status());
          const me=await context.request.get(BASE+'/api/auth/me',{timeout:15000});
          const who=me.status()===200?await me.json():{};
          row.observed_role=String(who.role||'');
          if(row.observed_role!==role)throw Error('E2E_ROLE_MISMATCH');
        }
        const page=await context.newPage();
        page.on('response',res=>{
          const url=new URL(res.url());
          if(url.hostname===new URL(BASE).hostname && url.pathname.startsWith('/api/')){
            if(row.api.length<45)
              row.api.push({path:url.pathname,status:res.status(),method:res.request().method()});
          }
        });
        await page.route('**/*',async route=>{
          const method=route.request().method();
          if(!['GET','HEAD','OPTIONS'].includes(method)){
            row.blocked_requests.push({method,path:new URL(route.request().url()).pathname});
            return route.abort('blockedbyclient');
          }
          return route.continue();
        });
        const response=await page.goto(BASE+where,{waitUntil:'domcontentloaded',timeout:35000});
        row.http=response?.status()||null;
        await page.locator('body').waitFor({state:'visible',timeout:20000});
        if(label==='catalogue'){
          const control=page.locator('input[aria-label="Recherche"]');
          if(await control.count()){
            await control.fill(ref);
            const button=page.getByRole('button',{name:'Filtrer',exact:true});
            if(await button.count())await button.first().click();
          }
        }
        await page.waitForTimeout(1400);
        const text=String(await page.locator('body').innerText()).slice(0,12000);
        row.visible_ref=Boolean(ref&&text.includes(ref));
        row.body_excerpt=text.slice(0,440);
        row.dom_product_count=ref?await page.locator('[data-product-ref="'+ref+'"]').count():null;
        row.url_path=new URL(page.url()).pathname;
        row.verdict=row.http===200&&row.blocked_requests.length===0
          ?'SCREEN_OBSERVED_NOT_BUSINESS_APPROVAL':'SCREEN_OR_BUSINESS_WRITE_BLOCKED';
        const filename=safeName(label+'-'+role+'-'+(ref||'market'))+'.png';
        await page.screenshot({path:path.join(OUT,filename),fullPage:false,timeout:12000});
        row.screenshot=filename;
        // Ground any future French curation in the actual source texts visible
        // to the authorized Catalogue owner; never infer product claims from
        // product reference or source language alone.
        if(role==='admin'&&ref&&label==='catalogue'){
          const registry=await context.request.get(BASE+
            '/api/admin/workspaces/catalog?unified=1&search='+encodeURIComponent(ref)+
            '&catalog_limit=50&catalog_offset=0',{timeout:20000});
          row.registry_http=registry.status();
          if(registry.status()===200){
            const data=await registry.json();
            const matches=(data.products||[]).filter(item=>item.product_ref===ref);
            row.registry_identity_count=matches.length;
            if(matches.length===1){
              const item=matches[0];
              row.source_record={
                name_source:item.name_source||null,
                description_source:item.description_source||null,
                current_name:item.name||null,
                current_description:item.description||null,
                content_source:item.content_source||null,
                source_locale:item.source_locale||null,
                issues:item.issues||[],
                status:item.work_status||null,
              };
            }
          }
          const dossier=await context.request.get(BASE+
            '/api/admin/workspaces/catalog?dossier_product_ref='+encodeURIComponent(ref),
            {timeout:20000});
          row.dossier_http=dossier.status();
          if(dossier.status()===200){
            const data=await dossier.json();
            row.dossier={
              product_ref:data.product_ref||null,
              identity:data.identity||null,
              supplier:data.supplier||null,
              availability:data.availability||null,
              media:data.media||null,
              variants:data.variants||null,
              catalogue_gate:data.catalogue_gate||null,
            };
          }
          const open=page.locator('tr[data-product-ref="'+ref+'"] [data-workspace-action="open-catalog-inspector"]');
          if(await open.count()){
            await open.first().click();
            await page.locator('[data-catalog-inline-editor]').waitFor({state:'visible',timeout:10000}).catch(()=>{});
            row.inline_french_proposal={
              name:await page.locator('[data-catalog-quick-field="name"]').first().inputValue().catch(()=>null),
              description:await page.locator('[data-catalog-quick-field="description"]').first().inputValue().catch(()=>null),
            };
            await page.screenshot({path:path.join(OUT,'inspector-'+safeName(ref)+'.png'),
              fullPage:false,timeout:12000});
            // L5: real Chromium clicks on the actual media inspector, not a
            // JSON-only / screenshot-only route check. No approval POST here.
            const complementary=page.locator('[data-catalog-complementary-info]');
            await complementary.waitFor({state:'attached',timeout:20000});
            const gallery=page.locator('[data-catalog-canonical-gallery]');
            // New focused UX puts the image reviewer above the technical fold.
            // Legacy rendering is still supported during controlled deployment.
            if(!await gallery.isVisible())
              await complementary.locator(':scope > summary').click();
            await gallery.waitFor({state:'visible',timeout:20000});
            const navigator=page.locator('[data-catalog-review-navigation]');
            await navigator.waitFor({state:'visible',timeout:20000});
            const nextImage=navigator.locator('[data-workspace-action="catalog-media-next"]');
            const previousImage=navigator.locator('[data-workspace-action="catalog-media-previous"]');
            const progress=page.locator('[data-catalog-media-progress]');
            const initialProgress=String(await progress.innerText());
            if(!/^\\d+\\/\\d+ images attestées/.test(initialProgress))
              throw Error('CATALOG_REVIEW_PROGRESS_MISSING:'+ref);
            const figures=gallery.locator('figure');
            const expected=EXPECTED_MEDIA[ref];
            const actual=await figures.count();
            if(actual!==expected)throw Error('MEDIA_GALLERY_COUNT_DRIFT:'+ref+':'+actual+'/'+expected);
            const dossierMedia=row.dossier?.media?.gallery||[];
            if(dossierMedia.length!==expected)
              throw Error('MEDIA_CONTRACT_COUNT_DRIFT:'+ref);
            row.media_review_probe={status:'INSPECTION_IN_PROGRESS',expected,observed:actual,
              evidence:[],saved_reviews:0,source_image_screenshots:[]};
            for(let i=0;i<actual;i++){
              if(i>0)await nextImage.click();
              const figure=figures.nth(i);
              await figure.waitFor({state:'visible',timeout:10000});
              const positionText=String(await navigator.locator('[data-catalog-media-position]').innerText());
              if(positionText!=='Image '+(i+1)+' / '+actual)
                throw Error('MEDIA_NAVIGATION_STEP_DRIFT:'+ref+':'+i);
              if(i===0 && !await previousImage.isDisabled())
                throw Error('MEDIA_PREVIOUS_NOT_DISABLED_ON_FIRST:'+ref);
              const image=figure.locator('img');
              await image.scrollIntoViewIfNeeded();
              const imageUrl=await image.getAttribute('src');
              const canonical=dossierMedia[i];
              if(!canonical?.source_media_id || !canonical?.media_id ||
                 !imageUrl || new URL(imageUrl,BASE).href!==canonical.url)
                throw Error('MEDIA_SOURCE_OR_ORDER_DRIFT:'+ref+':'+i);
              const pixels=await image.evaluate(async img=>{
                try{await img.decode();}catch(_){/* report broken source below */}
                return {complete:img.complete,width:img.naturalWidth,height:img.naturalHeight};
              });
              if(!pixels.complete || !pixels.width || !pixels.height)
                throw Error('SUPPLIER_PIXELS_NOT_LOADED:'+ref+':'+i);
              const review=figure.locator('[data-catalog-visual-fr-media]');
              if(await review.count()!==1 ||
                 await review.getAttribute('data-catalog-visual-fr-media')!==canonical.media_id)
                throw Error('VISUAL_REVIEW_IDENTITY_MISSING:'+ref+':'+i);
              await review.locator(':scope > summary').click();
              const original=review.getByRole('link',{name:'Agrandir l’image fournisseur originale'});
              if(await original.count()!==1 || await original.getAttribute('href')!==canonical.url)
                throw Error('ORIGINAL_SUPPLIER_URL_NOT_EXPOSED:'+ref+':'+i);
              const state=review.locator('select').first();
              const choices=await state.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value));
              if(JSON.stringify(choices)!==JSON.stringify(['','NONE','PRESENT','UNREADABLE']))
                throw Error('VISUAL_REVIEW_CHOICES_CHANGED:'+ref+':'+i);
              if(await state.inputValue()!=='' ||
                 await review.locator('input[type="checkbox"]').isChecked())
                throw Error('VISUAL_REVIEW_PRESELECTED_OR_PRECONFIRMED:'+ref+':'+i);
              if(await review.locator('textarea').count()!==2)
                throw Error('VISUAL_REVIEW_FR_FIELDS_MISSING:'+ref+':'+i);
              // Exercise the negative human-signature guard. A blank review
              // must fail locally, with ZERO POSTs (all writes blocked anyway).
              await review.getByRole('button',{name:'Enregistrer la revue humaine'}).click();
              const feedback=String(await review.locator('[role="status"]').innerText());
              if(!feedback.includes('Inspecter l’image, choisir un état et confirmer'))
                throw Error('HUMAN_REVIEW_EMPTY_CLICK_NOT_REFUSED:'+ref+':'+i);
              const file='source-media-'+safeName(ref)+'-'+String(i+1).padStart(2,'0')+'.png';
              await figure.screenshot({path:path.join(OUT,file),timeout:18000});
              row.media_review_probe.source_image_screenshots.push(file);
              row.media_review_probe.evidence.push({
                media_id:canonical.media_id,source_media_id:canonical.source_media_id,
                source_url:canonical.url,pixels,review_ui_present:true,
                human_signature_attempt:'EMPTY_REVIEW_REFUSED_NO_WRITE'
              });
            }
            if(!await nextImage.isDisabled())
              throw Error('MEDIA_NEXT_NOT_DISABLED_ON_LAST:'+ref);
            if(actual>1){
              await previousImage.click();
              await figures.nth(actual-2).waitFor({state:'visible',timeout:10000});
              await nextImage.click();
              await figures.nth(actual-1).waitFor({state:'visible',timeout:10000});
            }
            if(row.blocked_requests.length!==0)
              throw Error('UNEXPECTED_MEDIA_REVIEW_BUSINESS_MUTATION');
            // An operator must always be able to leave a 5- or 6-image review.
            const drawer=page.locator('[data-catalog-product-inspector="'+ref+'"]');
            await drawer.locator('[data-workspace-action="close-inspector"]').click();
            if(await drawer.count()!==0 || await page.locator('[data-catalog-inspector-backdrop]').count()!==0)
              throw Error('MEDIA_DRAWER_CLOSE_BUTTON_FAILED:'+ref);
            await open.click();
            await page.locator('[data-catalog-product-inspector="'+ref+'"]').waitFor({state:'visible'});
            await page.keyboard.press('Escape');
            if(await drawer.count()!==0 || await page.locator('[data-catalog-inspector-backdrop]').count()!==0)
              throw Error('MEDIA_DRAWER_ESCAPE_FAILED:'+ref);
            await open.click();
            await page.locator('[data-catalog-product-inspector="'+ref+'"]').waitFor({state:'visible'});
            await page.locator('[data-catalog-inspector-backdrop]').click({position:{x:12,y:100}});
            if(await drawer.count()!==0 || await page.locator('[data-catalog-inspector-backdrop]').count()!==0)
              throw Error('MEDIA_DRAWER_BACKDROP_FAILED:'+ref);
            row.media_review_probe.close_proof=['button','escape','backdrop'];
            row.media_review_probe.status='REAL_CHROMIUM_ALL_MEDIA_INSPECTED_NO_SIGNATURE';
          }else{
            throw Error('CATALOG_INSPECTOR_OPEN_CONTROL_MISSING:'+ref);
          }
        }
        if(role==='admin'&&ref&&label==='catalogue'){
          const diag=await context.request.get(BASE+
            '/api/admin/workspaces/catalog?diagnose_product_ref='+encodeURIComponent(ref),{timeout:15000});
          row.canonical_diagnostic_http=diag.status();
          if(diag.status()===200){
            const data=await diag.json();
            row.canonical_diagnostic={
              phase:data.phase||null,
              certification:{
                certified:data.certification?.certified===true,
                reasons:data.certification?.reasons||[]
              }
            };
          }
        }
        if(role==='anonymous'){
          const res=await context.request.get(BASE+'/api/products?market=KM&limit=1000',{timeout:15000});
          row.buyer_api_http=res.status();
          if(res.status()===200){
            const payload=await res.json();
            const products=Array.isArray(payload.products)?payload.products:[];
            row.buyer_result_count=products.length;
            row.buyer_matching_product_refs=products.filter(x=>ALL.includes(String(x.product_ref))).map(x=>x.product_ref);
          }
        }
      }catch(error){row.verdict='BLOCKED';row.error_code=String(error.message||error).slice(0,150);}
      finally{report.browser.push(row);await context.close();}
    }
    for(const ref of REFS)
      await inspect('admin','/admin/workspaces/catalog?search='+ref+'&product_ref='+ref,ref,'catalogue');
    for(const ref of REFS)
      await inspect('market_operator','/admin/workspaces/pricing?market=KM&product_ref='+ref,ref,'pricing');
    await inspect('market_operator','/dashboards/canonical/market-catalog.html?market=KM&product_ref=KPR-000099','KPR-000099','market-catalog');
    await inspect('anonymous','/boutique/?market=KM',null,'boutique');
    report.business_writes=0; // Every attempted browser business mutation is explicitly blocked.
    report.blocked_mutation_attempts=report.browser.flatMap(row=>row.blocked_requests.map(x=>({...x,stage:row.stage})));
    const buyer=report.browser.find(x=>x.stage==='boutique');
    const catalogueRows=report.browser.filter(row=>row.role==='admin'&&row.stage==='catalogue');
    report.media_review_evidence_count=catalogueRows.reduce(
      (sum,row)=>sum+(row.media_review_probe?.evidence?.length||0),0);
    report.media_review_screenshots=catalogueRows.flatMap(
      row=>row.media_review_probe?.source_image_screenshots||[]);
    const mediaProven=catalogueRows.length===REFS.length &&
      catalogueRows.every(row=>
        row.verdict!=='BLOCKED' &&
        row.media_review_probe?.status==='REAL_CHROMIUM_ALL_MEDIA_INSPECTED_NO_SIGNATURE') &&
      report.media_review_evidence_count===16 && report.business_writes===0;
    report.verdict=!mediaProven ? 'CHROMIUM_MEDIA_REVIEW_UI_NOT_PROVEN'
      : buyer?.buyer_matching_product_refs?.length
        ?'PUBLIC_KM_MATCH_REQUIRES_INDEPENDENT_APPROVAL_READBACK'
        :'P1_KM_NOT_YET_VISIBLE';
    if(!mediaProven)process.exitCode=2;
  }catch(error){
    report.verdict='DIAGNOSTIC_FAILED';
    report.error_code=String(error.message||error).slice(0,160);
    process.exitCode=2;
  }finally{
    if(browser)await browser.close().catch(()=>{});
    report.finished_at=new Date().toISOString();
    fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');
    console.log('[P1_CJ_CHROMIUM_READONLY] '+JSON.stringify({
      verdict:report.verdict,sha:report.runtime_sha,
      screenshots:report.browser.filter(x=>x.screenshot).length,
      stages:report.browser.map(x=>({role:x.role,stage:x.stage,ref:x.ref,
        http:x.http,verdict:x.verdict,error:x.error_code||null})),
      business_writes:report.business_writes,
      media_review_evidence_count:report.media_review_evidence_count||0,
      media_review_screenshots:report.media_review_screenshots?.length||0,
      human_reviews_written:0
    }));
  }
  return report;
}
if(require.main===module)run().catch(e=>{console.error(String(e.message));process.exitCode=2});
module.exports={BASE,REFS,ALL,EXPECTED_MEDIA,guard,run};
