/**
 * @komerce-arch-lite
 * @role          g6-buyer-otp-order-chromium
 * @domain        orders
 * @layer         test
 * @owner         backend-core
 * @purpose       Owner-only staging browser POST order; no external provider, OTP via bcrypt fixture.
 * @db-read       users, orders, order_items, e2e_test_accounts
 * @db-write      users via user-mutation-service, E2E via staging-e2e-provision, otp via auth fixture, order via HTTP only
 * @impact-areas  checkout, auth, orders
 */
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),bcrypt=require('bcryptjs');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {createAdminUser}=require('../../services/user-mutation-service');
const {markE2eTestAccount}=require('./staging-e2e-provision');
const {preseedG6BuyerOtp}=require('../../services/g6-staging-buyer-identity-guard');
const ORIGIN='https://komerce-backend-production.up.railway.app';
const MARKET=String(process.env.G6_TARGET_MARKET||'KM').toUpperCase();
// M01 : produit et prix historiques ; M02 : produit LOCAL_STOCK résolu en lecture seule par l'orchestrateur.
const PARAMS=require('./canonical/scenario-profile').buyerParams(process.env);
const REF=PARAMS.product_ref;
const LINES=require('./canonical/scenario-profile').basketLines(PARAMS).map(l=>({...l,id:null}));
const COUNTRY_PREFIX={KM:'+269',CM:'+237',CG:'+242'};
const EXPECTED_PRICE=PARAMS.expected_price;
let PRODUCT=null;
const OUT=path.resolve('test-results/g6-p2-buyer-order');
const {observe,fullError}=require("./canonical/observability");let OBS=null;
const {startTraceAfterAuth}=require('./canonical/observability');
const {humanGoto,humanClick,humanFill,humanSelect,humanCheck,humanPress,humanDoubleClickOnce}=require('./canonical/actors/human-gestures');
// Scénarios négatifs G6-G4A (N07 double clic, N04 quantité > stock, N33 deux variantes) : gestes en plus du parcours ; NEG=null = parcours inchangé.
const NEG=['N07','N04','N33'].includes(process.env.G6_CANONICAL_SCENARIO)?process.env.G6_CANONICAL_SCENARIO:null;
fs.mkdirSync(OUT,{recursive:true});
const run=crypto.randomBytes(4).toString('hex');
const report={run_id:process.env.GITHUB_RUN_ID||null,run8:run.toUpperCase(),
  phase:'G6-'+MARKET+'-CHROMIUM-REAL-OTP-ORDER',market:MARKET,product_ref:REF,product_id:PRODUCT,
  verdict:'NOT_PROVEN',human_attestation:false,payment_real:false,supplier_order_real:false,
  blocked_requests:[],allowed_read_posts:[],preview_http_statuses:[],steps:[]};
const save=()=>fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');
const check=(bool,code)=>{if(!bool)throw Error(code)};
const record=(name,value)=>{report.steps.push({name,observed:value});save()};
async function runtime(){
 const r=await fetch(ORIGIN+'/health/version');
 check(r.ok,'VERSION_HTTP_'+r.status);
 const v=await r.json();
 check(/^[a-f0-9]{40}$/.test(String(v.commit||''))&&v.commit===process.env.E2E_EXPECTED_DEPLOY_SHA,'SHA_DEPLOY_DRIFT');
 report.runtime_sha=v.commit;
}
async function resolveCurrentSaleableProduct(){
 // Une ligne par produit du panier ; M01/M02 n'en ont qu'une (requête et contrôles inchangés).
 for(const [i,line] of LINES.entries()){
  const lineRef=line.product_ref,linePrice=PARAMS.basket||PARAMS.variants?line.price:EXPECTED_PRICE;
  const local=PARAMS.basket?line.fulfillment==='LOCAL_STOCK':!!PARAMS.fulfillment;
  const {rows}=await db.query(`
  SELECT p.id,p.product_ref,p.name,d.amount
  FROM products p
  JOIN markets m ON m.code=$2
  JOIN product_market_price_drafts d ON d.product_id=p.id AND d.market_id=m.id AND d.status='LOCAL_ACTIVE'
  JOIN product_market_exposure e ON e.product_id=p.id AND e.market_id=m.id
  WHERE p.product_ref=$1 AND p.lifecycle_status='active' AND p.is_active=TRUE
    AND p.is_available=TRUE AND e.commercial_exposure='ENABLED'
    AND EXISTS (SELECT 1 FROM product_skus sku
      WHERE sku.product_id=p.id AND sku.is_active=TRUE ${local?'':'AND sku.stock>0'})`,[lineRef,MARKET]);
  check(rows.length===1,'G6_RECIPE_PRODUCT_OR_PRICE_NOT_UNIQUE');
  check(Number(rows[0].amount)===linePrice,'G6_RECIPE_PRICE_DRIFT');
  if(!local){
   // M01 = parcours import : un stock local exposé du même produit détournerait la commande du Hub.
   const {rows:ls}=await db.query(`SELECT 1 FROM local_stock ls JOIN markets m ON m.id=ls.market_id AND m.code=$2
     WHERE ls.product_id=$1 AND ls.commercial_exposure='ENABLED'`,[rows[0].id,MARKET]);
   check(ls.length===0,PARAMS.basket?'G6_M03_IMPORT_PRODUCT_SERVED_FROM_LOCAL_STOCK':'G6_M01_PRODUCT_SERVED_FROM_LOCAL_STOCK');
  }
  line.id=rows[0].id;
  if(i===0){PRODUCT=rows[0].id;report.product_id=PRODUCT}
 }
 if(PARAMS.basket)report.basket=LINES.map(l=>({product_ref:l.product_ref,price:l.price,fulfillment:l.fulfillment,source_key:l.source_key||null}));
 record('CURRENT_SALEABLE_PRODUCT',{market:MARKET,ref:REF,price_market_minor:EXPECTED_PRICE,stocked:true,...(PARAMS.basket?{lines:LINES.length}:{})});
}
async function queryOrders(userId){
 const {rows}=await db.query(
 'SELECT o.id,o.reference,o.total_kmf,o.display_total_amount,o.display_currency,o.payment_mode::text AS payment_mode, '+
 'o.payment_status::text AS payment_status,o.status::text AS status,o.simulation_scope, '+
 'm.code AS market, '+
 '(SELECT COUNT(*)::int FROM order_items i WHERE i.order_id=o.id) AS lines, '+
 '(SELECT SUM(i.quantity)::int FROM order_items i WHERE i.order_id=o.id) AS qty, '+
 '(SELECT ARRAY_AGG(DISTINCT p.product_ref) FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=o.id) AS products '+
 'FROM orders o LEFT JOIN markets m ON m.id=o.market_id WHERE o.user_id=$1::uuid ORDER BY o.created_at',
 [userId]);
 return rows;
}
async function setup(){
 const email=process.env.E2E_ADMIN_EMAIL||'admin@komerce.km';
 check(!!process.env.E2E_ADMIN_PASSWORD,'E2E_ADMIN_PASSWORD_MISSING');
 const resp=await fetch(ORIGIN+'/api/auth/login',{method:'POST',
  headers:{origin:ORIGIN,'content-type':'application/json'},
  body:JSON.stringify({email,password:process.env.E2E_ADMIN_PASSWORD})});
 check(resp.status===200,'E2E_ADMIN_LOGIN_FAILED_'+resp.status);
 const admin=(await resp.json()).user;
 check(admin?.role==='admin','G6_ADMIN_SESSION_ROLE');
 const {rows:[actor]}=await db.query('SELECT id,role::text AS role FROM users WHERE id=$1',[admin.id]);
 check(actor?.role==='admin','G6_ADMIN_DB_ROLE');
 let phone=null;
 for(let n=0;n<18;n++){
  const local=MARKET==='KM'?'3'+String(crypto.randomInt(0,1000000)).padStart(6,'0'):
    MARKET==='CM'?'6'+String(crypto.randomInt(0,100000000)).padStart(8,'0'):
    '06'+String(crypto.randomInt(0,10000000)).padStart(7,'0');
  const p=COUNTRY_PREFIX[MARKET]+local;
  const {rows}=await db.query('SELECT 1 FROM users WHERE phone=$1 OR whatsapp_phone=$1 LIMIT 1',[p]);
  if(!rows.length){phone=p;break}
 }
 check(!!phone,'G6_UNIQUE_PHONE_NOT_FOUND');
 const code=String(crypto.randomInt(100000,999999));
 const c=await db.getClient();let tx=false;
 try{
  await c.query('BEGIN');tx=true;
  const hash=await bcrypt.hash(crypto.randomBytes(20).toString('base64url'),10);
  const {rows:[buyer]}=await createAdminUser(c,{
    fullName:'G6 E2E '+run+' Client',email:'g6-e2e-'+run+'@komerce.test',
    phone,role:'client',currencyPref:MARKET==='KM'?'KMF':'XAF',passwordHash:hash});
  check(!!buyer?.id,'G6_BUYER_MISSING');
  await markE2eTestAccount(c,{userId:buyer.id,actorId:actor.id});
  await preseedG6BuyerOtp(c,{buyer,phone,code,purpose:'login'});
  await c.query('COMMIT');tx=false;
  report.buyer_id=buyer.id;
  record('CLIENT_E2E_MARKED_AND_OTP_HASHED',{role:'client',marked:true,no_external_message:true});
  return {buyer,phone,code};
 }catch(e){if(tx)await c.query('ROLLBACK').catch(()=>{});throw e}
 finally{c.release()}
}
async function addLineToCart(page,line,idx){
  // M01/M02 : une seule ligne (suffixe vide, comportement historique) ; M03 : une itération par ligne du panier.
  const sfx=idx===0?'':'_LINE'+(idx+1);
  const {rows:[actualProduct]}=await db.query('SELECT name,product_ref FROM products WHERE id=$1',[line.id]);
  check(actualProduct?.product_ref===line.product_ref&&!!actualProduct.name,'G6_PRODUCT_PROVENANCE_MISMATCH');
  await humanFill(null,page.locator('#k-search-input'),actualProduct.name);
  const item=page.locator('#k-search-dropdown .k-search-item[data-id="'+line.id+'"]');
  await item.waitFor({state:'visible',timeout:25000});await humanClick(null,item);
  await page.locator('#k-modal-name').waitFor({state:'visible',timeout:13000});
  // Wait for the canonical desktop Product Detail renderer, not a legacy carousel
  // image that may already be loaded before SKU options finish rendering.
  await page.locator('#k-modal-variants [data-pdc5-root]').waitFor({state:'attached',timeout:20000});
  const variantEvidence=await page.locator('#k-modal-variants').evaluate(el=>({
   root:!!el.querySelector('[data-pdc5-root]'),
   axes:[...el.querySelectorAll('.k-vg')].map(group=>({
    key:group.dataset.axisKey,
    options:[...group.querySelectorAll('button[data-option-value]')].map(button=>({
     value:button.dataset.optionValue,state:button.dataset.optionState,
     selected:button.getAttribute('aria-pressed')
    }))
   }))
  }));
  record('PDP_VARIANT_MATRIX'+sfx,variantEvidence);
  await page.waitForFunction(()=>[...document.querySelectorAll('#k-modal-carousel-track img')].some(x=>x.complete&&x.naturalWidth>0),null,{timeout:25000});
  const add=page.locator('#k-add-cart-btn');
  // Select axes in canonical Product Detail order. A global "first unselected"
  // selector can oscillate between available colors and never choose a size.
  // Each click below is a genuine Playwright pointer gesture; the next axis
  // is read only AFTER the current selection's DOM rerender has completed.
  const axisLocator=page.locator('#k-modal-variants [data-axis-key]');
  const axisCount=await axisLocator.count();
  check(axisCount>0,'G6_VARIANT_AXES_NOT_RENDERED');
  for(let axisIndex=0;axisIndex<axisCount;axisIndex++){
   const axis=axisLocator.nth(axisIndex);
   const axisKey=await axis.getAttribute('data-axis-key');
   // N33 : la variante voulue (variant_combo du SKU) est choisie par un vrai clic, jamais la première option disponible.
   if(line.variant_combo){
    const ck=Object.keys(line.variant_combo).find(k=>k.toLowerCase()===String(axisKey).toLowerCase());
    if(ck!==undefined){
     const wanted=String(line.variant_combo[ck]).replace(/["\\]/g,'\\$&');
     const btn=axis.locator('button[data-option-state="AVAILABLE"][data-option-value="'+wanted+'"]');
     if(await btn.count()!==1)throw Error('G6_N33_SCREEN_MISSING_VARIANT_OPTION_'+axisKey);
     if(await btn.getAttribute('aria-pressed')!=='true'){
      await humanClick(null,btn);
      await page.waitForFunction(({index,selectedValue})=>{
       const root=document.querySelectorAll('#k-modal-variants [data-axis-key]')[index];
       return !!root && Array.from(root.querySelectorAll('button[data-option-value]')).some(
         b=>b.dataset.optionValue===selectedValue && b.getAttribute('aria-pressed')==='true');
      },{index:axisIndex,selectedValue:String(line.variant_combo[ck])},{timeout:8000});
     }
     continue;
    }
   }
   const selected=axis.locator('button[data-option-state="AVAILABLE"][aria-pressed="true"]');
   if(await selected.count())continue;
   const choices=axis.locator('button[data-option-state="AVAILABLE"][data-option-value]');
   if(!await choices.count())throw Error('G6_NO_AVAILABLE_OPTION_IN_AXIS_'+axisKey);
   const choice=choices.first();
   const value=await choice.getAttribute('data-option-value');
   await humanClick(null,choice);
   await page.waitForFunction(({index,selectedValue})=>{
    const root=document.querySelectorAll('#k-modal-variants [data-axis-key]')[index];
    return !!root && Array.from(root.querySelectorAll('button[data-option-value]')).some(
      b=>b.dataset.optionValue===selectedValue && b.getAttribute('aria-pressed')==='true');
   },{index:axisIndex,selectedValue:value},{timeout:8000});
  }
  const addEnabled=await add.isEnabled();
  await page.screenshot({path:path.join(OUT,'02-real-authenticated-product'+sfx+'.png')});
  record('PDP_SELECTION_RESULT'+sfx,{
   add_enabled:addEnabled,
   selected_options:await page.locator('#k-modal-variants button[data-option-value][aria-pressed="true"]').evaluateAll(buttons=>buttons.map(button=>({
    axis:button.closest('.k-vg')?.dataset.axisKey,value:button.dataset.optionValue
   })))
  });
  check(addEnabled,'NO_PURCHASABLE_VARIANT');
  if(NEG==='N04'){
   // La fiche canonique n'a pas de champ de quantité (le « + » hérité est désactivé et masqué) et le stepper du panier est
   // recouvert par la bulle d'accueil : la quantité monte par clics répétés sur « Ajouter » (geste humain), de 1 à disponible + 1.
   const avail=await localAvailableQty(PRODUCT);
   check(avail>=1&&avail<=40,'G6_N04_PREREQ_LOCAL_AVAILABLE_OUT_OF_RANGE_'+avail);
   const n04=report.n04={available_before:avail,target_qty:avail+1,refusal_point:null,refusal_visible:false,visible_message:null,
    pdp_qty_input_present:await page.locator('#k-qty-plus').isVisible().catch(()=>false)};
   const badge=()=>page.locator('#k-modal-cart-badge').innerText().then(t=>Number(String(t).trim())||0).catch(()=>0);
   let q=0;
   while(q<avail+1){
    await humanClick(null,add);
    const moved=await page.waitForFunction(n=>Number(document.querySelector('#k-modal-cart-badge')?.textContent||0)>n,q,{timeout:3000}).then(()=>true,()=>false);
    if(!moved){n04.refusal_point='PDP_ADD_CAPPED';n04.capped_at_qty=q;break}
    q=await badge();
   }
   n04.badge_final=q;
   n04.visible_message=(await page.locator('[role="alert"],[role="status"],.k-toast').allInnerTexts().then(a=>a.join(' | ').replace(/\s+/g,' ').slice(0,300)).catch(()=>''))||null;
   n04.refusal_visible=!!n04.visible_message;
   await page.screenshot({path:path.join(OUT,'02b-n04-pdp-over-stock.png')});save();
   await humanClick(null,page.locator('#k-modal-close'));
   return;
  }
  const before=Number(await page.locator('#k-modal-cart-badge').innerText().catch(()=>'0'))||0;
  await humanClick(null,add);
  await page.waitForFunction(n=>Number(document.querySelector('#k-modal-cart-badge')?.textContent||0)>n,before,{timeout:10000});
  await humanClick(null,page.locator('#k-modal-close'));
}
// N04 : quantité supérieure au stock local saisie dans le panier (vrais clics sur le stepper). Lecture seule en PG.
async function localAvailableQty(productId){
 const {rows:[r]}=await db.query(`SELECT COALESCE(SUM(ls.qty_physical-COALESCE((SELECT SUM(a.quantity) FROM local_stock_allocations a
  WHERE a.local_stock_id=ls.id AND a.consumed_at IS NULL AND a.released_at IS NULL),0)),0)::int AS available
  FROM local_stock ls JOIN markets m ON m.id=ls.market_id AND m.code=$2
  WHERE ls.product_id=$1 AND ls.location='KM_MAIN' AND ls.commercial_exposure='ENABLED'`,[productId,MARKET]);
 return r.available;
}
async function n04QuantityOverStock(page){
 const n04=report.n04,avail=n04.available_before;
 const qtyOf=()=>page.locator('#k-sc-items .k-sc-item-stepper-qty').first().innerText().then(t=>Number(String(t).trim()));
 const alertText=()=>page.locator('[role="alert"],[role="status"],.k-toast,.k-sc-warning,.k-ck-error').allInnerTexts().then(a=>a.join(' | ').replace(/\s+/g,' ').slice(0,300)).catch(()=>'');
 n04.cart_qty_final=await qtyOf();
 n04.visible_message=await alertText();
 await page.screenshot({path:path.join(OUT,'03b-n04-cart-over-stock.png')});save();
 if(!n04.refusal_point&&n04.cart_qty_final<=avail)n04.refusal_point='CART_ADD_CAPPED';
 if(!n04.refusal_point){
  const checkout=page.locator('#k-sc-checkout');
  if(await checkout.isVisible())await humanClick(null,checkout);else await humanClick(null,page.locator('#k-cart-btn'));
  await page.locator('#k-order-modal.open').waitFor({state:'visible',timeout:15000});
  const confirm=page.locator('#btn-confirm-order');
  await confirm.waitFor({state:'visible',timeout:15000});
  const enabled=await page.waitForFunction(()=>{const el=document.getElementById('btn-confirm-order');return !!el&&!el.disabled},null,{timeout:12000}).then(()=>true,()=>false);
  n04.preview_http_statuses=report.preview_http_statuses.slice();
  n04.visible_message=(await alertText())||(await page.locator('#k-order-modal').innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0,300);
  await page.screenshot({path:path.join(OUT,'04b-n04-checkout-over-stock.png')});
  if(!enabled||n04.preview_http_statuses.some(x=>x!==200)){n04.refusal_point='CHECKOUT_BLOCKED';n04.confirm_enabled=enabled}
  else{
   const resp=page.waitForResponse(r=>r.url().endsWith('/api/orders')&&r.request().method()==='POST',{timeout:25000});
   await humanClick(null,confirm);
   const r=await resp;n04.order_post_status=r.status();
   if(r.status()===201)throw Error('G6_N04_PRODUCT_GAP_ORDER_CREATED_ABOVE_STOCK');
   n04.refusal_point='CHECKOUT_POST_REFUSED';
   n04.visible_message=(await alertText())||(await page.locator('#k-order-modal').innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0,300);
  }
 }
 n04.refusal_visible=!!n04.visible_message;save();
 return null;
}
async function browserCheckout({buyer,phone,code}){
 const browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
 try{
  const ctx=await browser.newContext({viewport:{width:1440,height:900},locale:'fr-FR'});
  const page=await ctx.newPage();let orderRequests=0;
  page.on('response',response=>{
    const req=response.request(),u=new URL(response.url());
    if(req.method()==='POST'&&u.origin===ORIGIN&&u.pathname==='/api/orders/preview')
      report.preview_http_statuses.push(response.status());
  });
  await page.route('**/*',async route=>{
    const req=route.request(),method=req.method();
    if(['GET','HEAD','OPTIONS'].includes(method))return route.continue();
    const u=new URL(req.url());
    const meta={method,origin:u.origin,path:u.pathname,type:req.resourceType()};
    // Google Maps uses POST for this read-only viewport query while rendering the
    // selected relay map. Allow only this exact XHR endpoint; keep all other
    // non-allowlisted browser POSTs blocked.
    if(method==='POST'&&u.origin==='https://maps.googleapis.com'&&
       u.pathname==='/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/GetViewportInfo'&&
       req.resourceType()==='xhr'){
      report.allowed_read_posts.push(meta);save();return route.continue();
    }
    if(method==='POST'&&u.origin===ORIGIN&&
       ['/api/auth/otp/request','/api/auth/otp/verify','/api/orders','/api/orders/preview'].includes(u.pathname)){
      if(u.pathname==='/api/orders'&&++orderRequests>(NEG==='N07'?2:1)){
        report.blocked_requests.push({...meta,reason:'duplicate_order_post'});
        return route.abort();
      }
      return route.continue();
    }
    if(method==='POST'&&u.origin==='https://m.stripe.com'&&u.pathname==='/6'&&req.resourceType()==='xhr')return route.abort();
    report.blocked_requests.push(meta);return route.abort();
  });
  const d=await humanGoto(page,ORIGIN+'/boutique/?market='+MARKET,{waitUntil:'domcontentloaded'});
  check(d?.status()===200,'BOUTIQUE_DOC_NOT_200');
  await humanClick(null,page.locator('.k-header-nav-btn[data-tab="komerce"]').first());
  await humanClick(null,page.locator('#k-kmc-identify'));
  await page.locator('#k-id-step-phone').waitFor({state:'visible',timeout:15000});
  await humanFill(null,page.locator('#k-id-name'),'G6');
  await humanFill(null,page.locator('#k-id-lastname'),'E2E');
  await humanSelect(null,page.locator('#k-id-phone-country'),COUNTRY_PREFIX[MARKET]);
  await humanFill(null,page.locator('#k-id-phone'),phone.slice(COUNTRY_PREFIX[MARKET].length));
  // Check the actual rendered form's eligibility BEFORE the UI click. An
  // incomplete form silently returns from requestCode without a network POST.
  // This is a real Chromium readback only; never alter DOM state to bypass it.
  const eligibility=await page.locator('#k-id-step-phone').evaluate(step=>{
   const phone=step.querySelector('#k-id-phone');
   const country=step.querySelector('#k-id-phone-country');
   const cta=step.querySelector('#k-id-phone-cta');
   return {step_visible:!step.hidden,phone_length:(phone?.value||'').replace(/\D/g,'').length,
     country_code:country?.value||null,aria_disabled:cta?.getAttribute('aria-disabled'),
     native_disabled:!!cta?.disabled,name_present:!!step.querySelector('#k-id-name')?.value?.trim(),
     surname_present:!!step.querySelector('#k-id-lastname')?.value?.trim(),
     form_error:step.querySelector('#k-id-err-phone')?.textContent?.slice(0,100)||null};
  });
  record('OTP_UI_FORM_PRECHECK',eligibility);
  await page.screenshot({path:path.join(OUT,'00-real-otp-form-precheck.png')});
  check(eligibility.step_visible&&eligibility.phone_length===
    (MARKET==='KM'?7:9)&&eligibility.aria_disabled==='false'&&
    !eligibility.native_disabled&&eligibility.name_present&&eligibility.surname_present,
    'G6_OTP_CHROMIUM_FORM_NOT_SUBMITTABLE');
  const otpPath='/api/auth/otp/request';
  const otpRequest=page.waitForRequest(r=>new URL(r.url()).pathname===otpPath&&
     r.method()==='POST',{timeout:15000}).catch(()=>null);
  const otpResponse=page.waitForResponse(r=>new URL(r.url()).pathname===otpPath&&
     r.request().method()==='POST',{timeout:18000}).catch(()=>null);
  await humanClick(null,page.locator('#k-id-phone-cta'));
  const sent=await otpRequest,rr=await otpResponse;
  if(!sent||!rr){
   record('OTP_UI_NO_RESPONSE',{request_seen:!!sent,response_seen:!!rr,
    blocked_paths:report.blocked_requests.map(x=>x.path)});
   await page.screenshot({path:path.join(OUT,'00-real-otp-request-blocked.png')});
   throw Error(sent?'G6_OTP_REQUEST_WITHOUT_RESPONSE':'G6_OTP_UI_CLICK_DID_NOT_SEND_REQUEST');
  }
  const rb=await rr.json().catch(()=>null);
  check(rr.status()===200&&rb?.success===true&&!rb?._test&&!rb?._dev,'OTP_REQUEST_NOT_ISOLATED');
  await page.locator('#k-id-step-otp').waitFor({state:'visible',timeout:12000});
  await page.screenshot({path:path.join(OUT,'01-real-otp-without-whatsapp.png')});
  const ver=page.waitForResponse(r=>r.url().endsWith('/api/auth/otp/verify')&&r.request().method()==='POST',{timeout:16000});
  for(let i=0;i<6;i++)await humanFill(null,page.locator('.k-id-otp-box').nth(i),code[i]);
  const vr=await ver,vb=await vr.json().catch(()=>null);
  check(vr.status()===200&&vb?.user?.id===buyer.id&&!vb?._test,'OTP_REAL_BCRYPT_SESSION_FAIL');
  check((await ctx.cookies()).some(x=>x.name.endsWith('kmrc_jwt')&&x.httpOnly),'OTP_HTTPONLY_SESSION_NOT_SET');
  await startTraceAfterAuth(ctx);
  record('CHROMIUM_OTP_VERIFIED',{request_status:rr.status(),verify_status:vr.status(),session:true,external_notification:false});
  await humanGoto(page,ORIGIN+'/boutique/?market='+MARKET,{waitUntil:'domcontentloaded'});
  // The catalog's async load must finish before the first search input event.
  await page.waitForFunction(() => {
    const count=document.getElementById('k-hero-count');
    return !!count && !count.hidden && /[1-9]/.test(count.textContent||'');
  },null,{timeout:30000});
  for(let i=0;i<LINES.length;i++)await addLineToCart(page,LINES[i],i);
  if(NEG==='N04'&&report.n04?.refusal_point)return null;
  await page.locator('#k-side-cart.has-items').waitFor({state:'visible',timeout:12000});
  await page.screenshot({path:path.join(OUT,'03-real-cart.png')});
  if(NEG==='N04')return n04QuantityOverStock(page);
  const checkout=page.locator('#k-sc-checkout');
  if(await checkout.isVisible())await humanClick(null,checkout);else await humanClick(null,page.locator('#k-cart-btn'));
  await page.locator('#k-order-modal.open').waitFor({state:'visible',timeout:15000});
  const confirm=page.locator('#btn-confirm-order');
  await confirm.waitFor({state:'visible',timeout:15000});
  await page.waitForFunction(()=>{const el=document.getElementById('btn-confirm-order');return el&&!el.disabled},null,{timeout:16000});
  check(report.preview_http_statuses.length>0&&report.preview_http_statuses.every(x=>x===200),
    'G6_AUTHENTICATED_SERVER_QUOTE_NOT_200');
  const total=await page.locator('#ck-final-total-amount').innerText();
  const checkoutTotal=Number(total.replace(/[^0-9]/g,''));
  check(checkoutTotal===EXPECTED_PRICE,'G6_CHECKOUT_TOTAL_NOT_CURRENT_PRICE');
  report.checkout_display_total=checkoutTotal;
  record('REAL_CHECKOUT',{display_total:total,relay:await page.locator('#ck-relais-summary').innerText().catch(()=>null)});
  await page.screenshot({path:path.join(OUT,'04-real-checkout-before-POST.png')});
  const response=page.waitForResponse(r=>r.url().endsWith('/api/orders')&&r.request().method()==='POST',{timeout:25000});
  let created;
  if(NEG==='N07'){
   // Exception explicite et limitée à N07 : un seul geste natif dblclick (deux clics rapprochés) sur Commander.
   response.catch(()=>null);
   const orderResps=[];page.on('response',r=>{if(r.url().endsWith('/api/orders')&&r.request().method()==='POST')orderResps.push(r)});
   await humanDoubleClickOnce(null,confirm,{allowedFor:'N07'});
   await page.waitForTimeout(6000);
   report.n07={double_click:true,order_post_statuses:orderResps.map(r=>r.status())};save();
   created=orderResps.find(r=>r.status()===201)||orderResps[0];
   check(!!created,'G6_N07_SCREEN_MISSING_NO_ORDER_RESPONSE');
  }else{await humanClick(null,confirm);created=await response}
  const body=await created.json().catch(()=>null);
  record('CANONICAL_ORDER_HTTP',{status:created.status(),reference:body?.order?.reference||null,code:body?.code||null,error:body?.error||null});
  check(created.status()===201&&!!body?.order?.id,'G6_CANONICAL_ORDER_POST_NOT_201');
  await page.screenshot({path:path.join(OUT,'05-real-order-confirmation.png')});
  check(report.blocked_requests.length===0,'G6_UNEXPECTED_BROWSER_WRITE');
  return body.order;
 }finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});await browser.close()}
}
(async()=>{
 try{
  check(process.env.KOMERCE_ENV==='staging'&&process.env.NODE_ENV==='test'&&
   process.env.GITHUB_EVENT_NAME==='issues'&&process.env.GITHUB_ACTOR===process.env.GITHUB_REPOSITORY_OWNER&&
   process.env.STAGING_BASE_URL===ORIGIN&&/^\d{5,20}$/.test(String(process.env.GITHUB_RUN_ID||'')),
   'OWNER_ONLY_STAGING_GUARD');
  const target=await confirmTarget({db,env:process.env});
  check(target.confirmed,'STAGING_DB_IDENTITY_MISMATCH');
  check(Object.hasOwn(COUNTRY_PREFIX,MARKET)&&Number.isInteger(EXPECTED_PRICE),'G6_UNSUPPORTED_MARKET');
  report.db_fingerprint=target.fingerprint;await runtime();
  await resolveCurrentSaleableProduct();
  const fixture=await setup();
  check((await queryOrders(fixture.buyer.id)).length===0,'BUYER_HAS_PREEXISTING_ORDERS');
  const order=await browserCheckout(fixture);
  const orders=await queryOrders(fixture.buyer.id);
  if(NEG==='N04'){
   check(orders.length===0,'G6_N04_PRODUCT_GAP_ORDER_EXISTS_'+orders.length);
   const after=await localAvailableQty(PRODUCT);
   report.n04.available_after=after;
   check(after===report.n04.available_before,'G6_N04_PRODUCT_GAP_LOCAL_AVAILABLE_CHANGED');
   check(report.blocked_requests.length===0,'G6_UNEXPECTED_BROWSER_WRITE');
   await runtime();
   report.verdict='G6_N04_QTY_OVER_STOCK_REFUSED_CHROMIUM_PG_PASS';return;
  }
  if(NEG==='N07'&&orders.length>1){
   report.n07={...report.n07,orders_in_pg:orders.length,references:orders.map(x=>x.reference)};
   throw Error('G6_N07_PRODUCT_GAP_DOUBLE_ORDER_'+orders.length);
  }
  check(orders.length===1,'G6_EXACTLY_ONE_ORDER_NOT_SATISFIED');
  const o=orders[0];
  check(o.id===order.id&&o.reference===order.reference&&o.simulation_scope==='G6-BUYER'&&
    o.market===MARKET&&Number(o.display_total_amount)===report.checkout_display_total&&
    o.display_currency===(MARKET==='KM'?'KMF':'XAF')&&Number(o.total_kmf)>0&&
    (MARKET!=='KM'||Number(o.total_kmf)===report.checkout_display_total)&&o.payment_mode==='cash_relais'&&
    o.status==='pending'&&o.payment_status!=='paid'&&o.lines===LINES.length&&o.qty===LINES.length&&LINES.every(l=>o.products?.includes(l.product_ref)),
    'G6_POSTGRES_CANONICAL_ORDER_MISMATCH');
 if(PARAMS.basket){
  const {rows:src}=await db.query('SELECT p.product_ref,i.fulfillment_source::text AS fulfillment_source FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=$1',[o.id]);
  check(src.length===LINES.length&&LINES.every(l=>src.some(x=>x.product_ref===l.product_ref&&x.fulfillment_source===l.fulfillment)),'G6_M03_ORDER_NOT_MIXED_AS_EXPECTED');
  report.fulfillment_source='MIXED';
 }else if(PARAMS.fulfillment){
  const {rows:src}=await db.query('SELECT DISTINCT fulfillment_source FROM order_items WHERE order_id=$1',[o.id]);
  check(src.length===1&&src[0].fulfillment_source===PARAMS.fulfillment,'G6_M02_ORDER_NOT_LOCAL_STOCK');
  report.fulfillment_source=PARAMS.fulfillment;
 }
  if(NEG==='N33'){
   const {rows:items}=await db.query('SELECT sku_id,quantity,variant_combo FROM order_items WHERE order_id=$1 ORDER BY id',[o.id]);
   const want=PARAMS.variants.map(v=>v.sku_id).sort();
   check(items.length===2&&JSON.stringify(items.map(i=>i.sku_id).sort())===JSON.stringify(want)&&items.every(i=>Number(i.quantity)===1),'G6_N33_PRODUCT_GAP_SKU_OR_QTY_MISMATCH');
   report.n33={sku_ids:want,items:items.length,total:Number(o.display_total_amount)};
  }
  report.order={id:o.id,reference:o.reference,status:o.status,payment_status:o.payment_status,
    scope:o.simulation_scope,total_kmf:Number(o.total_kmf),
    display_total_amount:Number(o.display_total_amount),display_currency:o.display_currency,
    checkout_display_total:report.checkout_display_total,market:o.market,lines:o.lines,quantity:o.qty,products:o.products};
  record('INDEPENDENT_POSTGRES_READBACK',report.order);await runtime();
  report.verdict='G6_P2_REAL_OTP_CHROMIUM_ORDER_CREATED_NO_EXTERNAL_EFFECTS';
 }catch(e){report.verdict='BLOCKED';report.error=fullError(e);process.exitCode=2}
 finally{save();await db.pool.end();
  console.log(JSON.stringify({verdict:report.verdict,error:report.error||null,
    order_id:report.order?.id||null,reference:report.order?.reference||null,
    runtime_sha:report.runtime_sha||null,steps:report.steps.map(x=>x.name),
    external_payments:false,external_notifications:false,external_suppliers:false,
    human_attestation:false,blocked_requests:report.blocked_requests}))}
})();
