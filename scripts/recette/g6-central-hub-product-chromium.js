#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g6-central-hub-product-chromium
 * @domain catalog
 * @layer test
 * @owner backend-core
 * @purpose Prérequis M03/M06 : produit vendable Fournisseur central Hub par les écrans (Import manuel, scan, Transmettre, média et revue visuelle, approbation Catalogue, prix LOCAL_ACTIVE, exposition), idempotent, reprise par étape lue en PG ; SCREEN_MISSING_* sans contournement.
 * @impact-areas staging-only, catalog, sourcing
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {observe,fullError,startTraceAfterAuth}=require('./canonical/observability');
const {humanGoto,humanClick,humanFill,humanSelect,humanPress,humanSetInputFiles}=require('./canonical/actors/human-gestures');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const OUT=path.resolve('test-results/g6-central-hub-product');
// Marqueur G6 : central_hub_manual V2 (#4920) ne porte aucun identifiant/SKU vendeur.
// Retrouver le candidat par nom métier exact et fournisseur système.
const G6_PREFIX='[G6-HUB] ';
// V2 : l'import V1 (KSC-000812 en KM) est resté WATCH sans catégorie ; il est ignoré, jamais ré-édité ni re-scanné.
const G6_SUPPLIER_PRODUCT_ID='G6-CENTRAL-'+MK.code+'-V2'; // marqueur historique, jamais envoyé comme SKU vendeur
// Le classifieur Sourcing lit les termes du nom et de la catégorie fournisseur ; le préfixe G6 reste le marqueur de recette.
// Termes configurés (migrations 248/249, famille « materiels », cible de marge 35 %) : « screwdriver », « hand tool ».
const PRODUCT_NAME=G6_PREFIX+'Screwdriver set '+MK.code;
const SUPPLIER_CATEGORY='Tools > Hand Tools',WEIGHT_KG=0.4,DIMENSIONS={l_cm:12,w_cm:9,h_cm:10};
const PURCHASE_PRICE=10,CURRENCY='EUR';
// Montant de recette du prix local (devise du marché). Plancher explicite documenté dans le rapport ;
// le montant effectif = max(plancher, référence de couverture du moteur économique arrondie à 100).
const RECETTE_PRICE_FLOOR={KM:15000,CM:10000,CG:10000};
const report={schema:'komerce-g6-central-hub-product/1',market:MK.code,provenance:'SIMULATED / STAGING ONLY',
 verdict:'BLOCKED',events:[],external_supplier_calls:0,external_payment_executed:false,production_permitted:false};
const check=(v,e)=>{if(!v)throw Error(e)};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const ownerStagingGuard=e=>e.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&e.GITHUB_EVENT_NAME==='issues'&&
 e.GITHUB_ACTOR===e.GITHUB_REPOSITORY_OWNER&&e.NODE_ENV==='test'&&e.KOMERCE_ENV==='staging'&&
 e.KOMERCE_TARGET_ENV==='staging'&&e.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&e.STAGING_BASE_URL===BASE&&
 ['KM','CM','CG'].includes(e.G6_TARGET_MARKET)&&String(e.PGOPTIONS||'').includes('default_transaction_read_only=on');

// Lecture seule : produit G6 vendable rattaché au Fournisseur central (prix LOCAL_ACTIVE, exposition ENABLED, SKU actif).
const SELLABLE_SQL=`
 SELECT p.id,p.product_ref,s.system_key,d.amount
 FROM products p
 JOIN markets m ON m.code=$1
 JOIN suppliers s ON s.id=p.procurement_supplier_id AND s.system_key='central_hub'
 JOIN product_market_price_drafts d ON d.product_id=p.id AND d.market_id=m.id AND d.status='LOCAL_ACTIVE'
 JOIN product_market_exposure e ON e.product_id=p.id AND e.market_id=m.id AND e.commercial_exposure='ENABLED'
 WHERE p.name LIKE $2||'%' AND p.lifecycle_status='active' AND p.is_active=TRUE AND p.is_available=TRUE
  AND EXISTS (SELECT 1 FROM product_skus k WHERE k.product_id=p.id AND k.is_active=TRUE)
 ORDER BY p.product_ref LIMIT 2`;
const readSellable=async()=>(await db.query(SELLABLE_SQL,[MK.code,G6_PREFIX])).rows;
// Lecture seule : candidat G6 (issu de l'import manuel), produit promu, prix et exposition du marché.
const CANDIDATE_SQL=`SELECT sc.candidate_ref,sc.state,sc.product_id,sc.supplier_name,sc.scan_result->>'sourcing_decision' AS decision,sc.komerce_category,sc.data_sources->>'category' AS category_source,
 sc.scan_result->>'economic_test_health_status' AS scan_health,
 p.id AS pid,p.product_ref,p.lifecycle_status,p.is_active,p.has_variants,p.inventory_model,p.description,p.needs_review,p.boutique_category_key,p.boutique_subcategory_key,
 (SELECT COUNT(*)::int FROM catalog_media cm WHERE cm.product_id=p.id AND cm.is_active=TRUE) AS media_count,
 EXISTS (SELECT 1 FROM product_skus ps WHERE ps.product_id=p.id AND ps.variant_combo IS NULL) AS default_sku_exists,
 EXISTS (SELECT 1 FROM product_skus ps WHERE ps.product_id=p.id AND ps.variant_combo IS NULL AND ps.is_active=TRUE) AS default_sku_active,
 COALESCE((SELECT bool_and(cm.source_media_id IS NOT NULL
   AND vr.media_id IS NOT NULL AND vr.source_media_id=cm.source_media_id
   AND vr.source_url=cm.url AND vr.text_presence IN ('NONE','PRESENT')
   AND (vr.text_presence<>'PRESENT' OR (NULLIF(vr.source_transcription,'') IS NOT NULL
     AND NULLIF(vr.french_translation,'') IS NOT NULL AND vr.french_presentation IS NOT NULL)))
   FROM catalog_media cm LEFT JOIN catalog_media_visual_fr_reviews vr ON vr.media_id=cm.id
   WHERE cm.product_id=p.id AND cm.is_active=TRUE),FALSE) AS visual_review_ready,
 sc.normalized_source_contract->>'schema_version' AS contract_version,
 (SELECT d.status FROM product_market_price_drafts d JOIN markets m ON m.id=d.market_id WHERE d.product_id=p.id AND m.code=$2) AS price_status,
 (SELECT e.commercial_exposure FROM product_market_exposure e JOIN markets m ON m.id=e.market_id WHERE e.product_id=p.id AND m.code=$2) AS exposure
 FROM sourcing_candidates sc LEFT JOIN products p ON p.id=sc.product_id
 WHERE sc.product_name=$1
   AND sc.normalized_source_contract->>'source_kind'='central_hub_manual'
   AND NOT (sc.normalized_source_contract ?| ARRAY['supplier_name','supplier_product_id','sellable_units'])
   AND EXISTS (SELECT 1 FROM suppliers s WHERE s.id=sc.supplier_id AND s.system_key='central_hub')
 ORDER BY sc.created_at DESC,sc.id DESC LIMIT 1`;
const readCandidate=async()=>(await db.query(CANDIDATE_SQL,[PRODUCT_NAME,MK.code])).rows[0]||null;
// Pur : prochain geste selon l'état lu en PG. Un écran absent donne SCREEN_MISSING_*, jamais de contournement.
function nextStep({sellable,candidate}){
 if(sellable&&sellable.length===1)return {verdict:'G6_CENTRAL_HUB_PRODUCT_ALREADY_SELLABLE_PASS',done:true};
 if(sellable&&sellable.length>1)return {verdict:'G6_CENTRAL_HUB_PRODUCT_DUPLICATE',done:true,fail:true};
 if(!candidate)return {step:'manual-import'};
 if(!candidate.product_ref){
  const d=String(candidate.decision||'').toUpperCase(),st=String(candidate.state||'').toLowerCase();
  if(d==='TEST'&&['scanned','test_ready'].includes(st))return {step:'promote-candidate',candidate_ref:candidate.candidate_ref};
  if(!d)return {step:'scan-candidate',candidate_ref:candidate.candidate_ref};
  // WATCH : catégorie de calcul non résolue -> geste humain du Catalogue (famille de calcul + nouveau scan), une seule fois.
  if((!candidate.komerce_category||candidate.category_source==='default')&&candidate.category_source!=='manual')
   return {step:'resolve-category',candidate_ref:candidate.candidate_ref};
  return {verdict:'SCREEN_MISSING_CANDIDATE_DECISION',done:true,fail:true};
 }
 const ref=candidate.product_ref;
 if(!(candidate.is_active===true&&candidate.lifecycle_status==='active')){
  // #4920 : photo canonique via Catalogue AVANT approbation, jamais un faux SKU vendeur.
  if(Number(candidate.media_count||0)<1)return {step:'catalog-media',product_ref:ref};
  if(candidate.visual_review_ready!==true)return {step:'catalog-visual-review',product_ref:ref,product_id:candidate.pid};
   if(candidate.has_variants===false&&candidate.inventory_model!=='SKU'&&candidate.default_sku_exists!==true)
    return {step:'catalog-default-sku',product_ref:ref,product_id:candidate.pid};
   if(candidate.has_variants===false&&candidate.inventory_model!=='SKU'&&candidate.default_sku_active!==true)
    return {verdict:'G6_CENTRAL_DEFAULT_SKU_INACTIVE_REQUIRES_REVIEW',done:true,fail:true};
  // Préparation éditoriale puis classement boutique par l'inspecteur Catalogue, avant l'approbation humaine.
  if(!String(candidate.description||'').trim()||candidate.needs_review!==false)return {step:'catalog-editorial',product_ref:ref};
  if(!candidate.boutique_category_key||!candidate.boutique_subcategory_key)return {step:'catalog-taxonomy',product_ref:ref};
  return {step:'catalog-approve',product_ref:ref};
 }
 if(!candidate.price_status)return {step:'price-draft',product_ref:ref};
 if(candidate.price_status!=='LOCAL_ACTIVE')return {step:'price-activate',product_ref:ref};
 if(candidate.exposure!=='ENABLED')return {step:'market-expose',product_ref:ref,product_id:candidate.pid};
 return {verdict:'G6_CENTRAL_HUB_PRODUCT_READBACK_NOT_SELLABLE',done:true,fail:true};
}
// Pur : montant de recette = max(plancher explicite du marché, référence de couverture canonique arrondie à 100).
function recettePrice(corridor,code=MK.code){
 const e=corridor?.selected?.economics,ref=Number(e?.coverage_reference_price_kmf??e?.coverage_reference_price??e?.minimum_safe_price_kmf??e?.minimum_safe_price);
 const floor=RECETTE_PRICE_FLOOR[code];
 if(!floor)throw Error('G6_RECETTE_PRICE_FLOOR_MISSING');
 return Number.isFinite(ref)&&ref>0?Math.max(floor,Math.ceil(ref/100)*100):floor;
}
const ROLES={admin:['E2E_ADMIN_EMAIL','E2E_ADMIN_PASSWORD','/admin/workspaces/sourcing'],
 market_operator:['E2E_MARKET_OPERATOR_'+MK.code+'_EMAIL','E2E_MARKET_OPERATOR_'+MK.code+'_PASSWORD','/dashboards/canonical/market-autonomy.html?market='+MK.code]};
async function login(browser,role){
 const [ke,kp,next]=ROLES[role],email=env[ke],password=env[kp];
 check(email&&password,'G6_CENTRAL_CREDENTIALS_MISSING_'+role);
 const ctx=await browser.newContext({baseURL:BASE,viewport:{width:1440,height:900}});
 const page=await ctx.newPage(),blocked=[];let authAllowed=true;
 await page.route(/.*/,route=>{
  const r=route.request(),u=new URL(r.url());
  if(['GET','HEAD','OPTIONS'].includes(r.method()))return route.continue();
  if(authAllowed&&r.method()==='POST'&&u.origin===BASE&&u.pathname==='/api/auth/login'){authAllowed=false;return route.continue()}
  blocked.push({method:r.method(),path:u.pathname});return route.abort('blockedbyclient');
 });
 await humanGoto(page,'/login.html?next='+encodeURIComponent(next));
 await humanFill(null,page.locator('#email'),email);await humanFill(null,page.locator('#password'),password);
 const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST');
 await humanClick(null,page.locator('#btn-submit'));
 check((await pending).status()===200,'G6_CENTRAL_LOGIN_FAILED_'+role);
 await page.waitForURL(u=>u.pathname!=='/login.html',{timeout:20000});
 await startTraceAfterAuth(ctx);
 const me=await page.request.get('/api/auth/me');const user=await me.json();
 check(me.ok()&&(user.role||user.user?.role)===role,'G6_CENTRAL_ROLE_INVALID_'+role);
 return {ctx,page,blocked,role};
}
// Une seule mutation autorisée (méthode+chemin, une fois) ; toute autre écriture navigateur est bloquée.
async function arm(actor,method,pathname){
 let calls=0;actor.calls=()=>calls;actor.blocked.length=0;
 await actor.page.unroute(/.*/);
 await actor.page.route(/.*/,route=>{
  const req=route.request(),u=new URL(req.url());
  if(['GET','HEAD','OPTIONS'].includes(req.method()))return route.continue();
  if(u.origin===BASE&&u.pathname===pathname&&req.method()===method&&calls++===0)return route.continue();
  actor.blocked.push({method:req.method(),path:u.pathname});return route.abort('blockedbyclient');
 });
}
const missing=(v,proof)=>{report.verdict=v;report.proof=proof;save();process.exitCode=3;return null};
const visible=async(loc,ms)=>{try{await loc.first().waitFor({state:'visible',timeout:ms});return true}catch(_){return false}};
// Attend la réponse de l'unique POST/PUT armé, déclenché par `click`, et vérifie « une mutation, aucun blocage ».
async function fire(actor,method,pathname,click,key,extra={}){
 const pending=actor.page.waitForResponse(r=>new URL(r.url()).pathname===pathname&&r.request().method()===method,{timeout:45000});
 await click();const res=await pending;const body=await res.json().catch(()=>({}));
 check(res.status()<400&&actor.calls()===1&&actor.blocked.length===0,'G6_CENTRAL_'+key.toUpperCase().replace(/-/g,'_')+'_REJECTED_'+res.status());
 report.events.push({key,http:res.status(),role:actor.role,ui:true,mutations:1,...extra});save();return body;
}
const API='/api/admin/workspaces/sourcing';
async function manualImport(actor){
 await arm(actor,'POST',API+'/imports');
 // /admin/workspaces/sourcing renvoie sans paramètre vers le Cockpit (Sourcing Live) : mode=manual garde l'écran Importer.
 await humanGoto(actor.page,'/admin/workspaces/sourcing?mode=manual',{waitUntil:'domcontentloaded'});
 const open=actor.page.locator('[data-workspace-action="manual-import"]');
 if(!await visible(open,30000))return missing('SCREEN_MISSING_MANUAL_IMPORT',{page:'/admin/workspaces/sourcing?mode=manual',selector:'[data-workspace-action="manual-import"]',code:'public/dashboards/canonical/js/sourcing-workspace.js:431'});
 await humanClick(null,open.first());
 const select=actor.page.locator('[data-manual-supplier]');
 await select.waitFor({state:'visible',timeout:15000});
 await actor.page.waitForFunction(()=>{const s=document.querySelector('[data-manual-supplier]');return s&&!s.disabled},null,{timeout:20000});
 const selected=await select.evaluate(s=>s.selectedOptions[0]?.getAttribute('data-system-key'));
 check(selected==='central_hub','G6_CENTRAL_HUB_SUPPLIER_NOT_PRESELECTED');
 await humanFill(null,actor.page.locator('[data-manual-products]'),JSON.stringify([{
  product_name:PRODUCT_NAME,purchase_price:PURCHASE_PRICE,currency:CURRENCY,supplier_category:SUPPLIER_CATEGORY,weight_kg:WEIGHT_KG,dimensions:DIMENSIONS}]));
 await fire(actor,'POST',API+'/imports',()=>humanClick(null,actor.page.locator('[data-workspace-action="submit-manual-import"]')),'manual-import-central-hub');
 return true;
}
async function openCandidate(actor,ref,action){
 await humanGoto(actor.page,'/admin/workspaces/sourcing?candidate_ref='+encodeURIComponent(ref),{waitUntil:'domcontentloaded'});
 const row=actor.page.locator('[data-sourcing-candidate="'+ref+'"]');
 if(!await visible(row,20000))return missing('SCREEN_MISSING_CANDIDATE_ROW',{candidate_ref:ref});
 return row;
}
// Geste « scan » (contrôle fournisseur) : uniquement si l'écran le propose pour ce candidat.
async function scanCandidate(actor,ref){
 await arm(actor,'POST',API+'/candidates/'+ref+'/scan');
 const row=await openCandidate(actor,ref);if(!row)return false;
 const button=row.locator('[data-workspace-action="scan-candidate"]');
 if(!await visible(button,15000))return !!missing('SCREEN_MISSING_SCAN_CANDIDATE',{candidate_ref:ref,code:'sourcing-workspace.js:362 (issue scan-candidate)'});
 await fire(actor,'POST',API+'/candidates/'+ref+'/scan',()=>humanClick(null,button),'scan-candidate',{candidate_ref:ref});
 return true;
}
// Décision humaine sur un candidat WATCH sans famille de calcul : Catalogue global, « Appliquer la proposition »
// du moteur (jamais de catégorie devinée). Enregistre la famille et relance le scanner en une seule mutation.
async function resolveCategory(actor,ref){
 await arm(actor,'POST',API+'/candidates/'+ref+'/resolve-category');
 await humanGoto(actor.page,'/admin/workspaces/catalog?search='+encodeURIComponent(ref),{waitUntil:'domcontentloaded'});
 const row=actor.page.locator('tr[data-candidate-ref="'+ref+'"]');
 if(!await visible(row,25000))return !!missing('SCREEN_MISSING_CANDIDATE_DECISION',{candidate_ref:ref,detail:'ligne candidat absente du Catalogue global'});
 await humanClick(null,row.locator('[data-workspace-action="inspect-candidate"]'));
 const review=actor.page.locator('[data-workspace-action="candidate-economic-category-review"]');
 if(!await visible(review,20000)){
  const text=await actor.page.locator('[data-workspace-feedback]').first().innerText().catch(()=>'');
  return !!missing('SCREEN_MISSING_CANDIDATE_DECISION',{candidate_ref:ref,detail:'aucun geste de décision proposé',screen_message:String(text).slice(0,400)});
 }
 await humanClick(null,review);
 const apply=actor.page.locator('[data-workspace-action="candidate-apply-economic-suggestion"]');
 if(!await visible(apply,20000))return !!missing('SCREEN_MISSING_CANDIDATE_DECISION',{candidate_ref:ref,detail:'aucune suggestion fiable du moteur ; aucune catégorie devinée'});
 await fire(actor,'POST',API+'/candidates/'+ref+'/resolve-category',()=>humanClick(null,apply),'resolve-category-rescan',{candidate_ref:ref});
 return true;
}
async function promoteCandidate(actor,ref){
 await arm(actor,'POST',API+'/candidates/'+ref+'/promote');
 const row=await openCandidate(actor,ref);if(!row)return false;
 const button=row.locator('[data-sourcing-promote]');
 if(!await visible(button,15000))return !!missing('CANDIDATE_PROMOTION_NOT_ELIGIBLE',{candidate_ref:ref});
 const body=await fire(actor,'POST',API+'/candidates/'+ref+'/promote',()=>humanClick(null,button),'promote-candidate-to-inactive-catalogue-draft',{candidate_ref:ref});
 check(body?.result?.product_ref,'G6_CENTRAL_PROMOTION_PRODUCT_REF_MISSING');
 return true;
}
// Textes de recette factuels (français). Le préfixe G6 du nom reste le marqueur de recette.
const FR_NAME=G6_PREFIX+'Coffret de tournevis '+MK.code;
const FR_DESCRIPTION='Coffret de tournevis pour les petites réparations domestiques. Article de recette staging : caractéristiques et stock simulés.';
const BOUTIQUE_PAIR={category:'Bricolage',subcategory:'Outillage'};
const CAT='/api/admin/workspaces/catalog';
// Ouvre l'inspecteur Catalogue du produit (lecture seule). Retourne l'état de l'écran.
async function openInspector(actor,ref){
 await humanGoto(actor.page,'/admin/workspaces/catalog?search='+ref+'&product_ref='+ref,{waitUntil:'domcontentloaded'});
 const row=actor.page.locator('tr[data-product-ref="'+ref+'"]');
 if(!await visible(row,25000))return !!missing('SCREEN_MISSING_CATALOG_ROW',{product_ref:ref});
 await humanClick(null,row.locator('[data-workspace-action="open-catalog-inspector"]'));
 return true;
}
async function inspectorText(actor){
 const t=await actor.page.locator('[data-catalog-product-inspector]').first().innerText().catch(()=>'');
 const files=await actor.page.locator('[data-catalog-product-inspector] input[type="file"]').count().catch(()=>0);
 return {text:String(t).replace(/\s+/g,' ').slice(0,900),file_inputs:files};
}
// Titre et description FR saisis dans l'inspecteur : l'écran enregistre au changement de champ (prepare-fr, une mutation).
async function catalogEditorial(actor,ref){
 const path=CAT+'/approval/'+ref+'/prepare-fr';
 await arm(actor,'POST',path);
 if(!await openInspector(actor,ref))return false;
 const name=actor.page.locator('[data-catalog-quick-field="name"]'),desc=actor.page.locator('[data-catalog-quick-field="description"]');
 if(!await visible(desc,20000))return !!missing('SCREEN_MISSING_CATALOG_EDITORIAL',{product_ref:ref,screen:await inspectorText(actor)});
 await humanFill(null,name,FR_NAME);
 await fire(actor,'POST',path,async()=>{await humanFill(null,desc,FR_DESCRIPTION);await humanPress(null,desc,'Tab')},'catalog-editorial-fr',{product_ref:ref});
 return true;
}
// Catégorie et sous-catégorie boutique existantes (jamais créées) ; l'écran classe au choix de la sous-catégorie.
async function catalogTaxonomy(actor,ref){
 const path=CAT+'/products/'+ref+'/classify';
 await arm(actor,'POST',path);
 if(!await openInspector(actor,ref))return false;
 const cat=actor.page.locator('[data-catalog-quick-category]'),sub=actor.page.locator('[data-catalog-quick-subcategory]');
 if(!await visible(cat,20000))return !!missing('SCREEN_MISSING_CATALOG_TAXONOMY',{product_ref:ref,screen:await inspectorText(actor)});
 const hasCat=(await cat.locator('option').evaluateAll(o=>o.map(x=>x.value))).includes(BOUTIQUE_PAIR.category);
 if(!hasCat)return !!missing('SCREEN_MISSING_BOUTIQUE_CATEGORY',{wanted:BOUTIQUE_PAIR.category,options:await cat.locator('option').evaluateAll(o=>o.map(x=>x.value))});
 await humanSelect(null,cat,BOUTIQUE_PAIR.category);
 const hasSub=(await sub.locator('option').evaluateAll(o=>o.map(x=>x.value))).includes(BOUTIQUE_PAIR.subcategory);
 if(!hasSub)return !!missing('SCREEN_MISSING_BOUTIQUE_SUBCATEGORY',{wanted:BOUTIQUE_PAIR.subcategory,options:await sub.locator('option').evaluateAll(o=>o.map(x=>x.value))});
 await fire(actor,'POST',path,()=>humanSelect(null,sub,BOUTIQUE_PAIR.subcategory),'catalog-taxonomy-classify',{product_ref:ref,...BOUTIQUE_PAIR});
 return true;
}
// #4920 : photographie/illustration du bon produit, approuvée pour staging,
// jamais un screenshot UI ni une image interchangeable. SHA256 épinglé.
function canonicalMediaFile(){
 const rel=String(env.G6_CENTRAL_MEDIA_IMAGE_FILE||'').trim(),want=String(env.G6_CENTRAL_MEDIA_IMAGE_SHA256||'').trim().toLowerCase();
 if(!rel||!/^[a-f0-9]{64}$/.test(want))return null;
 const root=path.resolve(__dirname,'../..'),file=path.resolve(root,rel);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return null;
 const ext=path.extname(file).toLowerCase();
 if(!['.png','.jpg','.jpeg','.webp'].includes(ext))return null;
 const buf=fs.readFileSync(file),bytes=buf.length;
 if(bytes<1024||bytes>5*1024*1024)return null;
 const sha256=crypto.createHash('sha256').update(buf).digest('hex');
 if(sha256!==want)return null;
 const signature=buf.subarray(0,12);
 const png=ext==='.png'&&signature.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
 const jpg=['.jpg','.jpeg'].includes(ext)&&signature[0]===0xff&&signature[1]===0xd8&&signature[2]===0xff;
 const webp=ext==='.webp'&&signature.toString('ascii',0,4)==='RIFF'&&signature.toString('ascii',8,12)==='WEBP';
 return png||jpg||webp?{file,sha256,bytes,name:path.basename(file)}:null;
}
async function catalogMedia(actor,ref){
 const media=canonicalMediaFile();
 if(!media)return !!missing('PREREQ_MISSING_CANONICAL_PRODUCT_IMAGE',{
  product_ref:ref,detail:'Photo réelle ou illustration fidèle du produit G6 approuvée pour staging',
  required:['G6_CENTRAL_MEDIA_IMAGE_FILE','G6_CENTRAL_MEDIA_IMAGE_SHA256']});
 const endpoint=CAT+'/products/'+ref+'/media';
 await arm(actor,'POST',endpoint);
 if(!await openInspector(actor,ref))return false;
 const details=actor.page.locator('details[data-catalog-complementary-info] > summary');
 if(!await visible(details,20000))return !!missing('SCREEN_MISSING_CATALOG_MEDIA_DETAILS',{product_ref:ref,screen:await inspectorText(actor)});
 await humanClick(null,details);
 const form=actor.page.locator('[data-catalog-media-upload]'),input=form.locator('[data-catalog-media-upload-file]');
 if(!await visible(input,20000))return !!missing('SCREEN_MISSING_CANONICAL_MEDIA_UPLOAD',{product_ref:ref,screen:await inspectorText(actor)});
 await humanSetInputFiles(null,input,media.file);
 const submit=form.locator('[data-catalog-media-upload-submit]');
 await submit.waitFor({state:'visible',timeout:10000});
 report.media_proof={image_file:media.name,sha256:media.sha256,bytes:media.bytes,provenance:'OWNER-APPROVED G6 STAGING IMAGE'};save();
 await fire(actor,'POST',endpoint,()=>humanClick(null,submit),'canonical-media-upload',{product_ref:ref,image_sha256:media.sha256});
 return true;
}
// Revue explicite des pixels dans l'inspecteur Catalogue. Pour l'image Hub
// manuelle, le serveur lie d'abord son identité interne au média exact ; aucune
// identité fournisseur n'est créée et l'automatisation reste non-humaine.
async function catalogVisualReview(actor,ref,productId){
 if(!await openInspector(actor,ref))return false;
 const review=actor.page.locator('[data-catalog-visual-fr-media]').first();
 if(!await visible(review,20000))return !!missing('SCREEN_MISSING_CATALOG_VISUAL_REVIEW',{product_ref:ref,screen:await inspectorText(actor)});
 const mediaId=await review.getAttribute('data-catalog-visual-fr-media').catch(()=>null);
 if(!mediaId)return !!missing('SCREEN_MISSING_CATALOG_VISUAL_REVIEW',{product_ref:ref,screen:await inspectorText(actor)});
 const path='/api/admin/catalog/approval-queue/'+encodeURIComponent(productId)+'/media/'+encodeURIComponent(mediaId)+'/visual-fr-review';
 await arm(actor,'POST',path);
 const control=actor.page.locator('[data-catalog-visual-fr-media="'+mediaId+'"]');
 if(!await visible(control,20000))return !!missing('SCREEN_MISSING_CATALOG_VISUAL_REVIEW',{product_ref:ref,screen:await inspectorText(actor)});
 await humanClick(null,control.locator('summary'));
 const presence=control.locator('select').first();
 if(!await visible(presence,10000))return !!missing('SCREEN_MISSING_CATALOG_VISUAL_REVIEW_FIELDS',{product_ref:ref});
 await humanSelect(null,presence,'NONE');
 const mode=control.locator('[data-review-execution-mode]');
 if(!await visible(mode,10000))return !!missing('SCREEN_MISSING_STAGING_REVIEW_MODE',{product_ref:ref});
 await humanSelect(null,mode,'AUTOMATED_STAGING');
 const runId=control.locator('[data-review-run-id]');
 await humanFill(null,runId,String(env.GITHUB_RUN_ID||''));
 const confirmed=control.locator('input[type="checkbox"]');
 await humanClick(null,confirmed);
 report.media_review={product_ref:ref,media_id:mediaId,text_presence:'NONE',execution_mode:'AUTOMATED_STAGING',run_id:String(env.GITHUB_RUN_ID||''),human_attestation:false};save();
 await fire(actor,'POST',path,()=>humanClick(null,control.getByRole('button',{name:'Enregistrer la revue automatisée de recette',exact:true})),
  'catalog-visual-media-review',{product_ref:ref,media_id:mediaId,text_presence:'NONE',human_attestation:false});
 return true;
}
async function catalogDefaultSku(actor,ref){
 if(!await openInspector(actor,ref))return false;
 const dossier=actor.page.locator('[data-catalog-complementary-info] > summary');
 if(await visible(dossier,20000)){
  const container=actor.page.locator('[data-catalog-complementary-info]');
  if((await container.getAttribute('open'))===null)await humanClick(null,dossier);
 }
 const panel=actor.page.locator('[data-hub-default-sku-preparation]');
 if(!await visible(panel,20000))return !!missing('SCREEN_MISSING_HUB_DEFAULT_SKU_PREPARATION',{product_ref:ref,screen:await inspectorText(actor)});
 const path=CAT+'/approval/'+encodeURIComponent(ref)+'/prepare-hub-default-sku';
 await arm(actor,'POST',path);
 await fire(actor,'POST',path,()=>humanClick(null,panel.locator('[data-workspace-action="catalog-default-sku"]')),
  'catalog-hub-default-sku',{product_ref:ref,internal:true,stock:0,supplier_identity_created:false});
 return true;
}
// Approbation humaine du Catalogue global : contrôle des prérequis (lecture) puis « Valider le Catalogue ».
// Le média canonique est une étape humaine distincte obligatoire, vérifiée en PG.
async function approveCatalog(actor,ref){
 const path=CAT+'/approval/'+ref+'/approve';
 await arm(actor,'POST',path);
 if(!await openInspector(actor,ref))return false;
 const details=actor.page.locator('[data-catalog-approval-details] > summary');
 if(!await visible(details,20000)){
  const screen=await inspectorText(actor);
  const v=/m[ée]dias?\s+canonique|image/i.test(screen.text)?'SCREEN_MISSING_CANONICAL_MEDIA'
   :/source/i.test(screen.text)?'SCREEN_MISSING_SOURCE_CONTRACT':'SCREEN_MISSING_CATALOG_APPROVE';
  return !!missing(v,{product_ref:ref,screen,detail:'bloc Approbation Catalogue absent ; aucun téléversement de média ni contrat source dans l\'inspecteur'});
 }
 await humanClick(null,details);
 await humanClick(null,actor.page.locator('[data-workspace-action="inspector-check-approval"]'));
 const approve=actor.page.locator('[data-workspace-action="inspector-approve"]');
 if(!await visible(approve,20000)){
  const text=await actor.page.locator('[data-workspace-feedback]').first().innerText().catch(()=>'');
  report.verdict='CATALOG_PREREQUISITES_INCOMPLETE';report.proof={product_ref:ref,screen_message:String(text).slice(0,500)};save();process.exitCode=3;return false;
 }
 actor.page.once('dialog',d=>d.accept());
 await fire(actor,'POST',path,()=>humanClick(null,approve),'catalog-approval-human',{product_ref:ref});
 return true;
}
async function openPriceRow(actor,ref){
 await humanGoto(actor.page,'/dashboards/canonical/market-autonomy.html?market='+MK.code,{waitUntil:'domcontentloaded'});
 const row=actor.page.locator('tr.kmc-autonomy-row').filter({hasText:ref});
 if(!await visible(row,30000))return missing('SCREEN_MISSING_PRICE_ROW',{product_ref:ref,page:'market-autonomy.html'});
 await humanClick(null,row.getByRole('button',{name:'Gérer le prix',exact:true}));
 return row;
}
async function priceDraft(actor,ref){
 const price='/api/admin/workspaces/pricing/market/'+MK.code+'/products/'+ref+'/local-price';
 const cr=await actor.page.request.get(BASE+'/api/admin/workspaces/pricing/market/'+MK.code+'/corridor?product_ref='+ref);
 const corridor=await cr.json().catch(()=>({}));
 const amount=recettePrice(cr.ok()?corridor:null);
 report.recette_price={market:MK.code,amount,currency:corridor?.market?.currency||null,floor:RECETTE_PRICE_FLOOR[MK.code],corridor_http:cr.status(),
  coverage_reference:corridor?.selected?.economics?.coverage_reference_price_kmf??null};save();
 await arm(actor,'POST',price);
 const row=await openPriceRow(actor,ref);if(!row)return false;
 await humanFill(null,row.locator('input[type="number"]'),String(amount));
 await humanFill(null,row.getByPlaceholder('Motif de décision'),'Recette G6 '+(env.GITHUB_RUN_ID||'local')+' : prix de recette explicite, staging uniquement');
 await fire(actor,'POST',price,()=>humanClick(null,row.getByRole('button',{name:'Enregistrer',exact:true})),'local-price-draft',{product_ref:ref,amount});
 return true;
}
async function priceActivate(actor,ref){
 const price='/api/admin/workspaces/pricing/market/'+MK.code+'/products/'+ref+'/local-price';
 const pv=await actor.page.request.get(BASE+price+'/activation-preview');const pb=await pv.json().catch(()=>({}));
 report.activation_preview={http:pv.status(),allowed:pb?.activation?.allowed===true};save();
 if(!pv.ok()||pb?.activation?.allowed!==true){report.verdict='ECONOMIC_GATE_REFUSED';report.proof={product_ref:ref,http:pv.status()};save();process.exitCode=3;return false}
 await arm(actor,'POST',price+'/activate');
 const row=await openPriceRow(actor,ref);if(!row)return false;
 const btn=row.getByRole('button',{name:'Activer le prix',exact:true});
 if(!await visible(btn,15000))return !!missing('SCREEN_MISSING_PRICE_ACTIVATE',{product_ref:ref});
 await fire(actor,'POST',price+'/activate',()=>humanClick(null,btn),'local-price-activate',{product_ref:ref});
 return true;
}
// Repli : si l'activation du prix n'a pas exposé le produit, écran market-catalog (« Exposer »).
async function marketExpose(actor,ref,productId){
 const put='/api/market-delegation/markets/'+MK.code+'/catalog/exposure/'+productId;
 await arm(actor,'PUT',put);
 await humanGoto(actor.page,'/dashboards/canonical/market-catalog.html?market='+MK.code,{waitUntil:'domcontentloaded'});
 const row=actor.page.locator('tr').filter({hasText:ref});
 const btn=row.getByRole('button',{name:'Exposer',exact:true});
 if(!await visible(btn,30000))return !!missing('SCREEN_MISSING_MARKET_EXPOSE',{product_ref:ref,page:'market-catalog.html'});
 await fire(actor,'PUT',put,()=>humanClick(null,btn),'market-exposure-enable',{product_ref:ref});
 return true;
}
const STEP_ROLE={'manual-import':'admin','scan-candidate':'admin','promote-candidate':'admin','resolve-category':'admin','catalog-approve':'admin','catalog-editorial':'admin','catalog-taxonomy':'admin','catalog-media':'admin','catalog-visual-review':'admin','catalog-default-sku':'admin',
 'price-draft':'market_operator','price-activate':'market_operator','market-expose':'market_operator'};
const DO={'manual-import':(a)=>manualImport(a),'scan-candidate':(a,s)=>scanCandidate(a,s.candidate_ref),
 'promote-candidate':(a,s)=>promoteCandidate(a,s.candidate_ref),'resolve-category':(a,s)=>resolveCategory(a,s.candidate_ref),'catalog-approve':(a,s)=>approveCatalog(a,s.product_ref),'catalog-editorial':(a,s)=>catalogEditorial(a,s.product_ref),'catalog-taxonomy':(a,s)=>catalogTaxonomy(a,s.product_ref),'catalog-media':(a,s)=>catalogMedia(a,s.product_ref),'catalog-visual-review':(a,s)=>catalogVisualReview(a,s.product_ref,s.product_id),'catalog-default-sku':(a,s)=>catalogDefaultSku(a,s.product_ref),
 'price-draft':(a,s)=>priceDraft(a,s.product_ref),'price-activate':(a,s)=>priceActivate(a,s.product_ref),
 'market-expose':(a,s)=>marketExpose(a,s.product_ref,s.product_id)};
const readState=async()=>({sellable:await readSellable(),candidate:await readCandidate()});
async function main(){
 let browser,OBS=null;const actors={};
 try{
  save();
  check(ownerStagingGuard(env),'G6_CENTRAL_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});check(guard.confirmed,'G6_CENTRAL_DB_GUARD');
  report.db_fingerprint=guard.fingerprint;
  let state=await readState(),step=nextStep(state),last=null;
  for(let i=0;i<12&&step.step;i++){
   // Pas de reclic : un même geste ne se rejoue jamais dans un run si la relecture PG n'a pas avancé.
   check(step.step!==last,'G6_CENTRAL_NO_PROGRESS_'+step.step);
   // Refuser de créer un nouveau candidat si sa pièce source n'est pas déjà approuvée.
   if(step.step==='manual-import'&&!canonicalMediaFile()){
    missing('PREREQ_MISSING_CANONICAL_PRODUCT_IMAGE',{before_business_write:true,required:['G6_CENTRAL_MEDIA_IMAGE_FILE','G6_CENTRAL_MEDIA_IMAGE_SHA256']});break;
   }
   if(!browser){const {chromium}=require('playwright');browser=await chromium.launch({headless:true});OBS=observe(browser,OUT)}
   const role=STEP_ROLE[step.step];
   if(!actors[role])actors[role]=await login(browser,role);
   const ok=await DO[step.step](actors[role],step);
   if(!ok){process.exitCode=process.exitCode||3;break}
   report.steps_done=[...(report.steps_done||[]),step.step];
   last=step.step;state=await readState();step=nextStep(state);
  }
  const c=state.candidate;
  report.catalog_readback=c&&{media_count:c.media_count,contract_version:c.contract_version||null,needs_review:c.needs_review,boutique:[c.boutique_category_key,c.boutique_subcategory_key]};
  report.candidate=c&&{candidate_ref:c.candidate_ref,state:c.state,decision:c.decision||null,scan_health:c.scan_health||null,komerce_category:c.komerce_category||null,product_ref:c.product_ref||null,price_status:c.price_status||null,exposure:c.exposure||null};
  report.product_ref=c?.product_ref||null;
  if(!process.exitCode){
   if(step.verdict)report.verdict=step.verdict;
   else throw Error('G6_CENTRAL_STEP_LIMIT_'+String(step.step));
   if(step.fail)process.exitCode=3;
  }
  save();
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{for(const a of Object.values(actors))await a.ctx.close().catch(()=>{});
  if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main,ownerStagingGuard,nextStep,recettePrice,SELLABLE_SQL,CANDIDATE_SQL,G6_PREFIX,G6_SUPPLIER_PRODUCT_ID,RECETTE_PRICE_FLOOR,canonicalMediaFile};
