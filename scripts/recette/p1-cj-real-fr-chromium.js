#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch-lite
 * @role p1-cj-real-fr-chromium
 * @domain catalog
 * @layer tooling
 * @owner backend-core
 * @purpose Perform exact, source-grounded French curation by actual Chromium gestures on three REAL CJ staging drafts.
 * @db-read products,sourcing_candidates,catalog_field_overrides,product_market_exposure,product_market_price_drafts
 * @db-write none (only canonical UI /api/admin/workspaces/catalog/approval/:ref/prepare-fr)
 * @impact-areas catalog,staging,e2e
 */
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {confirmTarget}=require('./target-guard');
const ORIGIN='https://komerce-backend-production.up.railway.app';
const OUT=path.resolve('test-results/g6-cj-fr-chromium');
const PLAN=Object.freeze([
  {
    ref:'KPR-000099',candidate:'KSC-000257',
    supplier:'1396999123722440704',
    sourceName:'American Retro Pickle Green Short Sleeve Shirt',
    sourceMarker:'Ingredient content: 96% and above',
    name:'Chemise femme verte à manches courtes, style rétro',
    description:'Chemise pour femme à manches courtes, de longueur classique. Le fournisseur indique une teneur en coton d’au moins 96 %. Tailles S, M et L. Mesures annoncées en centimètres (longueur, tour de poitrine, manche) : S 65/110/40 ; M 66/114/41 ; L 67/118/42. Les tailles asiatiques peuvent être plus petites que les tailles européennes : vérifiez le tableau et prévoyez une tolérance de 2 à 3 cm. La nuance de vert peut varier selon l’écran. Une chemise par article.'
  },
  {
    ref:'KPR-000100',candidate:'KSC-000258',
    supplier:'1410157074293329920',
    sourceName:'Irregular Ladies Long Dress With Printed Lace',
    sourceMarker:'Skirt type: A-line skirt',
    name:'Robe longue femme imprimée avec dentelle, coupe évasée',
    description:'Vêtement long pour femme, à coupe évasée en A et taille mi-haute, avec imprimé et dentelle selon le titre fournisseur. Composition principale indiquée : polyester, avec une doublure contenant du coton (10 à 29 % annoncés). Coloris bleu marine ou noir ; tailles S, M, L, XL et XXL. Le fournisseur signale des tailles asiatiques parfois plus petites que les tailles européennes et une tolérance de 2 à 3 cm sur les mesures. Vérifiez le tableau avant de commander.'
  },
  {
    ref:'KPR-000101',candidate:'KSC-000259',
    supplier:'BE74E804-F8CB-4D8A-B84A-DE98494DC9FD',
    sourceName:"Women's multi color printed shirt",
    sourceMarker:'Main fabric composition: acetate fiber',
    name:'Chemise femme à imprimé multicolore',
    description:'Chemise imprimée pour femme, de style bureau, avec ouverture de type cardigan selon la fiche fournisseur. Composition annoncée : fibres d’acétate, entre 71 et 80 % dans les composants indiqués. Les variantes comprennent notamment les couleurs noir et rouge, avec plusieurs tailles. Les tailles asiatiques peuvent être plus petites que les tailles européennes ; le fournisseur indique une tolérance de 2 à 3 cm pour les mesures. Les couleurs à l’écran peuvent varier.'
  }
]);
function checkEnv(env=process.env){
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_EVENT_NAME!=='issues'
    ||env.GITHUB_ACTOR!==env.GITHUB_REPOSITORY_OWNER
    ||env.KOMERCE_ENV!=='staging'||env.NODE_ENV!=='test'
    ||env.STAGING_BASE_URL!==ORIGIN||env.EXPECTED_RAILWAY_ENVIRONMENT!=='staging'
    ||env.G6_CJ_FRENCH_EDITOR_APPROVED!=='STAGING_ONLY_3_CJ_TEST'
    ||!env.E2E_ADMIN_EMAIL||!env.E2E_ADMIN_PASSWORD
    ||!env.KOMERCE_STAGING_RESET_DB_PIN||!env.DATABASE_URL
    ||!String(env.PGOPTIONS||'').includes('default_transaction_read_only=on')
    ||!/^[a-f0-9]{40}$/i.test(env.E2E_EXPECTED_DEPLOY_SHA||''))
      throw Error('G6_CJ_FR_CHROMIUM_OWNER_STAGING_ONLY_REQUIRED');
}
async function readState(db,ref){
  const client=await db.pool.connect();
  try{
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='12000ms'");
    const {rows}=await client.query(`
      SELECT p.product_ref,p.name,p.description,p.name_source,p.description_source,
             p.content_source,p.needs_review,p.lifecycle_status,p.is_active,p.is_available,
             p.price_kmf,sc.candidate_ref,sc.supplier_product_id,sc.state AS sourcing_state,
             UPPER(COALESCE(sc.scan_result->>'sourcing_decision','UNKNOWN')) AS source_decision,
             (SELECT count(*)::int FROM product_market_exposure e
                 WHERE e.product_id=p.id AND e.commercial_exposure='ENABLED') AS exposures_enabled,
             (SELECT count(*)::int FROM product_market_price_drafts d WHERE d.product_id=p.id) AS local_prices,
             (SELECT COUNT(*)::int FROM catalog_field_overrides o
                 WHERE o.product_id=p.id AND o.field_name IN ('name','description')
                   AND o.set_by IS NOT NULL) AS signed_french_overrides
        FROM products p JOIN sourcing_candidates sc ON sc.product_id=p.id
       WHERE p.product_ref=$1 AND sc.state='imported_to_catalog'
       ORDER BY sc.updated_at DESC NULLS LAST LIMIT 1`,[ref]);
    await client.query('ROLLBACK');
    return rows[0]||null;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
}
function invariant(row,plan){
  if(!row||row.product_ref!==plan.ref||row.candidate_ref!==plan.candidate
    ||row.supplier_product_id!==plan.supplier||row.name_source!==plan.sourceName
    ||!String(row.description_source||'').includes(plan.sourceMarker)
    ||row.source_decision!=='TEST'||row.sourcing_state!=='imported_to_catalog'
    ||row.lifecycle_status!=='candidate'||row.is_active!==false
    ||row.is_available!==false||Number(row.exposures_enabled)!==0
    ||Number(row.local_prices)!==0)
      throw Error('CJ_SOURCE_OR_STAGING_GATE_DRIFT:'+plan.ref);
}
async function run(env=process.env){
  checkEnv(env);
  fs.mkdirSync(OUT,{recursive:true});
  const db=require('../../db');
  const report={schema:'g6-cj-fr-chromium/1',mode:'STAGING_CANONICAL_UI_WRITES',
    market:'KM',target:ORIGIN,three_exact_products:PLAN.map(p=>p.ref),
    stage:'FRENCH_PREPARATION_ONLY',never_claims:'VISUAL_FR_OR_CATALOG_APPROVAL_OR_MARKET_GO',
    verdict:'BLOCKED',records:[],started_at:new Date().toISOString()};
  let browser;
  try{
    const target=await confirmTarget({db,env});
    if(target?.confirmed!==true)throw Error('PG_STAGING_TARGET_NOT_CONFIRMED');
    report.db_fingerprint=target.fingerprint;
    const version=await(await fetch(ORIGIN+'/health/version',{signal:AbortSignal.timeout(12000)})).json();
    report.sha=String(version.commit||version.sha||'');
    if(report.sha!==env.E2E_EXPECTED_DEPLOY_SHA)throw Error('DEPLOY_SHA_NOT_PINNED');
    browser=await chromium.launch({headless:true});
    for(const plan of PLAN){
      const record={ref:plan.ref,candidate:plan.candidate,before:null,after:null,
        status:'NOT_PROVEN',post_attempts:[],blocked_mutations:[],screenshots:[]};
      report.records.push(record);
      const before=await readState(db,plan.ref);
      invariant(before,plan);
      record.before={content_source:before.content_source,needs_review:before.needs_review,
        lifecycle_status:before.lifecycle_status,is_active:before.is_active,
        signed_french_overrides:before.signed_french_overrides};
      if(before.content_source==='manual' && before.needs_review===false){
        if(before.name!==plan.name||before.description!==plan.description)
          throw Error('PREVIOUS_DIFFERENT_MANUAL_REVIEW:'+plan.ref);
        record.status='ALREADY_PREPARED_EXACT_MATCH';
        continue;
      }
      if(before.content_source!=='connector_raw'||before.needs_review!==true)
        throw Error('EXPECTED_RAW_FRENCH_CANDIDATE:'+plan.ref);
      const context=await browser.newContext({viewport:{width:1440,height:900},locale:'fr-FR'});
      try{
        const login=await context.request.post(ORIGIN+'/api/auth/login',
          {data:{email:env.E2E_ADMIN_EMAIL,password:env.E2E_ADMIN_PASSWORD},timeout:20000});
        if(login.status()!==200)throw Error('E2E_ADMIN_LOGIN_'+login.status());
        const me=await context.request.get(ORIGIN+'/api/auth/me',{timeout:12000});
        if(me.status()!==200 || (await me.json()).role!=='admin')throw Error('ACTOR_NOT_ADMIN');
        const page=await context.newPage();
        const expectedPath='/api/admin/workspaces/catalog/approval/'+plan.ref+'/prepare-fr';
        await page.route('**/*',async route=>{
          const req=route.request(),url=new URL(req.url()),method=req.method();
          if(['GET','HEAD','OPTIONS'].includes(method))return route.continue();
          if(url.origin===ORIGIN&&method==='POST'&&url.pathname===expectedPath){
            record.post_attempts.push({action:'prepare-fr',path:url.pathname});
            return route.continue();
          }
          record.blocked_mutations.push({method,path:url.pathname});
          return route.abort('blockedbyclient');
        });
        page.on('response',resp=>{
          const url=new URL(resp.url());
          if(url.origin===ORIGIN&&resp.request().method()==='POST'&&url.pathname===expectedPath){
            record.post_attempts.push({action:'prepare-fr-response',status:resp.status()});
          }
        });
        const route='/admin/workspaces/catalog?search='+plan.ref+'&product_ref='+plan.ref;
        const nav=await page.goto(ORIGIN+route,{waitUntil:'domcontentloaded',timeout:35000});
        if(nav?.status()!==200)throw Error('CATALOG_UI_HTTP_NOT_200');
        const row=page.locator('tr[data-product-ref="'+plan.ref+'"]');
        await row.waitFor({state:'visible',timeout:25000});
        const open=row.locator('[data-workspace-action="open-catalog-inspector"]');
        if(await open.count()!==1)throw Error('INSPECTOR_BUTTON_NOT_UNIQUE');
        await open.click();
        const name=page.locator('[data-catalog-quick-field="name"]');
        const description=page.locator('[data-catalog-quick-field="description"]');
        await name.waitFor({state:'visible',timeout:15000});
        await description.waitFor({state:'visible',timeout:15000});
        await page.screenshot({path:path.join(OUT,plan.ref+'-before.png'),
          fullPage:false,timeout:12000});
        record.screenshots.push(plan.ref+'-before.png');
        // Actual keyboard/edit field gestures. First blur may legitimately fail
        // French-language guard while the other field still contains English.
        await description.fill(plan.description);
        await name.click();
        await page.waitForTimeout(1100);
        await name.fill(plan.name);
        const postOK=page.waitForResponse(resp=>resp.request().method()==='POST'
          &&new URL(resp.url()).pathname===expectedPath&&resp.status()===200,
          {timeout:20000});
        await name.press('Tab');
        const saved=await postOK;
        const payload=await saved.json().catch(()=>null);
        record.final_http=saved.status();
        record.final_action=payload?.action||null;
        if(payload?.action!=='catalog_candidate_prepared_fr'
          ||payload?.result?.content_source!=='manual'
          ||payload?.result?.needs_review!==false)
          throw Error('CANONICAL_FR_WRITER_NOT_CONFIRMED:'+plan.ref);
        await page.waitForTimeout(500);
        await page.screenshot({path:path.join(OUT,plan.ref+'-after.png'),
          fullPage:false,timeout:12000}).catch(()=>{});
        record.screenshots.push(plan.ref+'-after.png');
      }finally{await context.close();}
      const after=await readState(db,plan.ref);
      if(!after||after.name!==plan.name||after.description!==plan.description
        ||after.name_source!==before.name_source
        ||after.description_source!==before.description_source
        ||after.supplier_product_id!==plan.supplier
        ||after.content_source!=='manual'||after.needs_review!==false
        ||after.is_active!==false||after.is_available!==false
        ||after.lifecycle_status!=='candidate'
        ||Number(after.exposures_enabled)!==0||Number(after.local_prices)!==0
        ||Number(after.signed_french_overrides)<2)
          throw Error('INDEPENDENT_PG_FR_READBACK_FAILED:'+plan.ref);
      record.after={content_source:after.content_source,needs_review:after.needs_review,
        lifecycle_status:after.lifecycle_status,is_active:after.is_active,
        signed_french_overrides:after.signed_french_overrides,
        source_preserved:true,publication_unchanged:true,market_unchanged:true};
      record.status='FR_CHROMIUM_HTTP_PG_PASS_NOT_PUBLISHED';
    }
    const v2=await(await fetch(ORIGIN+'/health/version')).json();
    if(String(v2.commit||v2.sha||'')!==report.sha)throw Error('DEPLOY_SHA_CHANGED_DURING_RUN');
    report.verdict=report.records.every(r=>r.status==='FR_CHROMIUM_HTTP_PG_PASS_NOT_PUBLISHED'
       ||r.status==='ALREADY_PREPARED_EXACT_MATCH')?'FRENCH_EDITORIAL_PREPARED_NOT_SELLABLE':'NOT_PROVEN';
  }catch(error){report.error=String(error.message||error).slice(0,220);
    report.verdict='BLOCKED';process.exitCode=2;
  }finally{
    if(browser)await browser.close().catch(()=>{});
    await db.pool.end();
    report.finished_at=new Date().toISOString();
    fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');
    console.log('[G6_CJ_FR_CHROMIUM] '+JSON.stringify({
      verdict:report.verdict,sha:report.sha,db:report.db_fingerprint,
      records:report.records.map(r=>({ref:r.ref,status:r.status,
        final_http:r.final_http,blocked_mutations:r.blocked_mutations})),error:report.error||null
    }));
  }
  return report;
}
if(require.main===module)run().catch(e=>{console.error('G6_CJ_FR:'+String(e.message));process.exitCode=2;});
module.exports={ORIGIN,PLAN,checkEnv,invariant,run};
