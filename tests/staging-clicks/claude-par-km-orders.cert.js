/**
 * @komerce-arch-lite
 * @role          claude-par-km-orders-chromium
 * @domain        orders
 * @layer         test
 * @owner         backend-core
 * @purpose       Campagne CLAUDE-PAR-20261111 : commande client boutique KM en Chromium, encaissement cash par l'agent relais (UI), double validation et acces autre marche refuses, relectures PG.
 * @db-read       users, orders, order_items, cash_collections, cash_confirmation_controls
 * @db-write      client E2E via user-mutation-service (meme chemin que g6-p2), commande via HTTP uniquement
 * @impact-areas  checkout, cash, orders
 */
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),bcrypt=require('bcryptjs');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('../../scripts/recette/target-guard');
const {createAdminUser}=require('../../services/user-mutation-service');
const {markE2eTestAccount}=require('../../scripts/recette/staging-e2e-provision');
const {preseedG6BuyerOtp}=require('../../services/g6-staging-buyer-identity-guard');
const ORIGIN='https://komerce-backend-production.up.railway.app';
const MARKER='CLAUDE-PAR-20261111';
const PRODUCT='76dacd6c-c1d8-4313-9455-f0d8f063835b',REF='KPR-000099';
const OUT=path.resolve('test-results/claude-par-km-orders');
fs.mkdirSync(path.join(OUT,'video'),{recursive:true});
const run=crypto.randomBytes(4).toString('hex');
const R={marker:MARKER,run8:run.toUpperCase(),verdict:'NOT_PROVEN',checks:[],steps:[]};
const save=()=>fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(R,null,2)+'\n');
const chk=(ok,key,detail)=>{R.checks.push({key,verdict:ok?'PASS':'FAIL',detail:detail===undefined?undefined:detail});save();if(!ok)throw Error('FAIL:'+key+(detail===undefined?'':':'+JSON.stringify(detail).slice(0,200)))};
const soft=(ok,key,detail)=>{R.checks.push({key,verdict:ok?'PASS':'DEFECT',detail});if(!ok)(R.defects=R.defects||[]).push({key,detail});save()};
const num=s=>Number(String(s).replace(/[^\d]/g,''));
async function version(tag){const v=await (await fetch(ORIGIN+'/health/version')).json();R['sha_'+tag]=v.commit;chk(/^[a-f0-9]{40}$/.test(v.commit),'sha_'+tag,v.commit)}
const q=async(s,p=[])=>(await db.query(s,p)).rows;
async function state(id){
 const [o]=await q('SELECT * FROM orders WHERE id=$1',[id]);
 const items=await q('SELECT * FROM order_items WHERE order_id=$1 ORDER BY created_at',[id]).catch(()=>q('SELECT * FROM order_items WHERE order_id=$1',[id]));
 const cc=await q('SELECT * FROM cash_collections WHERE order_id=$1',[id]);
 const ctl=await q('SELECT * FROM cash_confirmation_controls WHERE order_id=$1',[id]);
 const hist=await q('SELECT * FROM order_status_history WHERE order_id=$1',[id]).catch(()=>null);
 return {o,items,cc,ctl,hist};
}
async function provisionBuyer(){
 const resp=await fetch(ORIGIN+'/api/auth/login',{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json'},
  body:JSON.stringify({email:process.env.E2E_ADMIN_EMAIL||'admin@komerce.km',password:process.env.E2E_ADMIN_PASSWORD})});
 chk(resp.status===200,'admin_login',resp.status);
 const admin=(await resp.json()).user;chk(admin?.role==='admin','admin_role');
 let phone=null;
 for(let n=0;n<18;n++){const p='+2693'+String(crypto.randomInt(0,1000000)).padStart(6,'0');
  if(!(await q('SELECT 1 FROM users WHERE phone=$1 OR whatsapp_phone=$1 LIMIT 1',[p])).length){phone=p;break}}
 chk(!!phone,'unique_phone');
 const code=String(crypto.randomInt(100000,999999));const c=await db.getClient();let tx=false;
 try{await c.query('BEGIN');tx=true;
  const hash=await bcrypt.hash(crypto.randomBytes(20).toString('base64url'),10);
  const {rows:[buyer]}=await createAdminUser(c,{fullName:MARKER+' '+run+' Client',email:'g6-e2e-'+run+'@komerce.test',phone,role:'client',currencyPref:'KMF',passwordHash:hash});
  await markE2eTestAccount(c,{userId:buyer.id,actorId:admin.id});
  await preseedG6BuyerOtp(c,{buyer,phone,code,purpose:'login'});
  await c.query('COMMIT');tx=false;R.buyer_id=buyer.id;return {buyer,phone,code};
 }catch(e){if(tx)await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}
}
async function buyerOrder({buyer,phone,code}){
 const browser=await chromium.launch({headless:true});
 try{
  const ctx=await browser.newContext({viewport:{width:1440,height:900},locale:'fr-FR',recordVideo:{dir:path.join(OUT,'video','buyer'),size:{width:1280,height:720}}});
  const page=await ctx.newPage();let orders=0;
  await page.route('**/*',async route=>{const rq=route.request(),m=rq.method();
   if(['GET','HEAD','OPTIONS'].includes(m))return route.continue();
   const u=new URL(rq.url());
   if(m==='POST'&&u.origin==='https://maps.googleapis.com'&&u.pathname.includes('GetViewportInfo'))return route.continue();
   if(m==='POST'&&u.origin===ORIGIN&&['/api/auth/otp/request','/api/auth/otp/verify','/api/orders'].includes(u.pathname)){
    if(u.pathname==='/api/orders'&&++orders!==1)return route.abort();return route.continue()}
   return route.abort()});
  await page.goto(ORIGIN+'/boutique/?market=KM',{waitUntil:'domcontentloaded'});
  await page.locator('.k-header-nav-btn[data-tab="komerce"]').first().click();
  await page.locator('#k-kmc-identify').click();
  await page.locator('#k-id-step-phone').waitFor({state:'visible',timeout:15000});
  await page.locator('#k-id-name').fill('CLAUDE-PAR');await page.locator('#k-id-lastname').fill(run.toUpperCase());
  await page.locator('#k-id-phone').fill(phone.slice(4));
  const rq=page.waitForResponse(r=>r.url().endsWith('/api/auth/otp/request')&&r.request().method()==='POST',{timeout:15000});
  await page.locator('#k-id-phone-cta').click();const rr=await rq;chk(rr.status()===200,'otp_request',rr.status());
  await page.locator('#k-id-step-otp').waitFor({state:'visible',timeout:12000});
  const ver=page.waitForResponse(r=>r.url().endsWith('/api/auth/otp/verify')&&r.request().method()==='POST',{timeout:16000});
  for(let i=0;i<6;i++)await page.locator('.k-id-otp-box').nth(i).fill(code[i]);
  const vr=await ver;chk(vr.status()===200,'otp_verify',vr.status());
  await page.goto(ORIGIN+'/boutique/?market=KM',{waitUntil:'domcontentloaded'});
  const [prod]=await q('SELECT name,product_ref FROM products WHERE id=$1',[PRODUCT]);chk(prod?.product_ref===REF,'product_ref');
  R.product=prod;
  await page.locator('#k-search-input').fill(prod.name);
  const item=page.locator('#k-search-dropdown .k-search-item[data-id="'+PRODUCT+'"]');
  await item.waitFor({state:'visible',timeout:25000});await item.click();
  await page.locator('#k-modal-name').waitFor({state:'visible',timeout:13000});
  await page.locator('#k-modal-variants [data-pdc5-root]').waitFor({state:'attached',timeout:20000});
  const add=page.locator('#k-add-cart-btn');
  for(let n=0;n<12&&!await add.isEnabled();n++){
   const o=page.locator('#k-modal-variants button[data-option-state="AVAILABLE"][data-option-value]:not([aria-pressed="true"])');
   if(!await o.count())break;await o.first().click()}
  chk(await add.isEnabled(),'variant_purchasable');
  R.pdp_price_text=(await page.locator('#k-modal-price').innerText()).trim();
  R.pdp_selection=await page.locator('#k-modal-variants button[data-option-value][aria-pressed="true"]').evaluateAll(b=>b.map(x=>({axis:x.closest('.k-vg')?.dataset.axisKey,value:x.dataset.optionValue})));
  await page.screenshot({path:path.join(OUT,'01-pdp.png')});
  await add.click();
  await page.waitForFunction(()=>Number(document.querySelector('#k-modal-cart-badge')?.textContent||0)>0,null,{timeout:10000});
  await page.locator('#k-modal-close').click();
  await page.locator('#k-side-cart.has-items').waitFor({state:'visible',timeout:12000});
  await page.screenshot({path:path.join(OUT,'02-cart.png')});
  const co=page.locator('#k-sc-checkout');if(await co.isVisible())await co.click();else await page.locator('#k-cart-btn').click();
  await page.locator('#k-order-modal.open').waitFor({state:'visible',timeout:15000});
  const confirm=page.locator('#btn-confirm-order');
  await page.waitForFunction(()=>{const e=document.getElementById('btn-confirm-order');return e&&!e.disabled},null,{timeout:16000});
  // le relais par defaut peut differer de celui du compte agent E2E : choisir le relais de l'agent dans l'UI
  const want=R.agent_relais_name;R.relay_default_summary=(await page.locator('#ck-relais-summary').innerText().catch(()=>'')).replace(/\s+/g,' ');
  if(want&&!R.relay_default_summary.includes(want)){
   R.changer_count=await page.locator('.ck-step-header-change').count();
   await page.locator('.ck-step-header-change').nth(R.changer_count>1?1:0).click();await page.waitForTimeout(1500);await page.screenshot({path:path.join(OUT,'03b-relay-picker.png')});R.picker_text=(await page.locator('#ck-relais-overlay').innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0,600);await page.locator('.ck-relais-item').first().waitFor({timeout:15000}).catch(()=>{});
   R.relay_choices=await page.locator('.ck-relais-item').allInnerTexts().then(a=>a.map(x=>x.replace(/\s+/g,' ').slice(0,80)));
   const it=page.locator('.ck-relais-item').filter({hasText:want}).first();
   soft(await it.count()>0,'agent_relay_offered_in_checkout',{want,choices:R.relay_choices});
   if(await it.count()>0){await it.click();}else{await page.locator('.ck-relais-sheet-x').click().catch(()=>{});await page.keyboard.press('Escape').catch(()=>{});}
   const cta=page.locator('.ck-relais-sheet-cta');if(await cta.isVisible().catch(()=>false))await cta.click();
   await page.waitForTimeout(800);
   R.relay_selected_summary=(await page.locator('#ck-relais-summary').innerText().catch(()=>'')).replace(/\s+/g,' ');
  }
  R.checkout_total_text=(await page.locator('#ck-final-total-amount').innerText()).trim();
  await page.screenshot({path:path.join(OUT,'03-checkout.png')});
  const resp=page.waitForResponse(r=>r.url().endsWith('/api/orders')&&r.request().method()==='POST',{timeout:25000});
  await confirm.click();const cr=await resp,body=await cr.json().catch(()=>null);
  chk(cr.status()===201&&!!body?.order?.id,'order_post_201',cr.status());
  await page.screenshot({path:path.join(OUT,'04-confirmation.png')});
  await ctx.close();return body.order;
 }finally{await browser.close()}
}
async function relayCash(order){
 const [ag]=await q('SELECT u.relais_id,r.name AS relais_name,r.market_id FROM users u LEFT JOIN relais r ON r.id=u.relais_id WHERE lower(u.email)=lower($1)',[process.env.E2E_AGENT_RELAIS_EMAIL]);
 const [orl]=await q('SELECT r.id,r.name,r.market_id FROM orders o JOIN relais r ON r.id=o.relais_id WHERE o.id=$1',[order.id]);
 R.relay_diag={agent_relais_id:ag?.relais_id,agent_relais_name:ag?.relais_name,order_relais_id:orl?.id,order_relais_name:orl?.name,same:ag?.relais_id===orl?.id};save();
 const email=process.env.E2E_AGENT_RELAIS_EMAIL,password=process.env.E2E_AGENT_RELAIS_PASSWORD;
 chk(!!email&&!!password,'relay_creds');
 const browser=await chromium.launch({headless:true});
 try{
  const ctx=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:path.join(OUT,'video','relay'),size:{width:1280,height:720}}});
  const page=await ctx.newPage();page.on('dialog',d=>d.accept());
  await page.goto(ORIGIN+'/login.html');
  await page.locator('#email').fill(email);await page.locator('#password').fill(password);
  const lr=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST');
  await page.locator('#btn-submit').click();chk((await lr).status()===200,'relay_login');
  await page.waitForURL(u=>u.pathname!=='/login.html',{timeout:20000});
  await page.goto(ORIGIN+'/admin/relais-live?view=execute',{waitUntil:'domcontentloaded'});
  await page.locator('select').first().waitFor({timeout:20000});
  await page.locator('select').first().selectOption({label:'KM · Comores'});
  await page.waitForLoadState('networkidle').catch(()=>{});
  await page.locator('[data-relay-execution-jump="cash"]').click();
  const row=page.locator('tr',{hasText:order.reference});
  try{await row.waitFor({timeout:20000})}catch(e){await page.screenshot({path:path.join(OUT,'05-relay-cash-row-missing.png'),fullPage:true}).catch(()=>{});R.cash_row_missing=true;
   const x=await page.evaluate(async(u)=>{const r=await fetch(u,{method:'POST',credentials:'include',headers:{'content-type':'application/json','x-requested-with':'XMLHttpRequest'},body:'{}'});let j=null;try{j=await r.json()}catch(e){}return {status:r.status,body:j}},ORIGIN+'/api/admin/workspaces/operations/market/KM/orders/'+order.reference+'/confirm-cash');
   R.cross_relay_attempt=x;soft([401,403,404,409,422].includes(x.status),'cross_relay_confirm_refused',x);
   await ctx.close().catch(()=>{});return {blocked:true}}
  await page.screenshot({path:path.join(OUT,'05-relay-cash-pending.png')});
  const p='/api/admin/workspaces/operations/market/KM/orders/'+order.reference+'/confirm-cash';
  let captured=null;page.on('request',r=>{if(new URL(r.url()).pathname===p&&r.method()==='POST')captured={headers:r.headers(),body:r.postData()}});
  const cresp=page.waitForResponse(r=>new URL(r.url()).pathname===p&&r.request().method()==='POST',{timeout:30000});
  await row.locator('[data-workspace-action="confirm-cash"]').click();
  const c1=await cresp;R.cash_ui_http=c1.status();R.cash_ui_body=await c1.json().catch(()=>null);
  chk(c1.status()===200,'cash_confirm_ui_200',R.cash_ui_body);
  await page.screenshot({path:path.join(OUT,'06-relay-cash-confirmed.png')});
  // replay : double validation (meme marche) et autre marche (CM) avec les memes en-tetes de session
  const replay=async(url)=>page.evaluate(async({url,h,b})=>{const r=await fetch(url,{method:'POST',credentials:'include',headers:h,body:b});let j=null;try{j=await r.json()}catch(e){}return {status:r.status,body:j}},
    {url:ORIGIN+url,h:Object.fromEntries(Object.entries(captured.headers).filter(([k])=>!['content-length','host','cookie'].includes(k))),b:captured.body});
  R.double_validation=await replay(p);
  chk(R.double_validation.status>=400&&R.double_validation.status<500,'double_validation_refused',R.double_validation);
  R.other_market=await replay(p.replace('/market/KM/','/market/CM/'));
  chk([403,404].includes(R.other_market.status),'other_market_refused',R.other_market);
  await ctx.close();
 }finally{await browser.close()}
}
(async()=>{
 try{
  chk(process.env.KOMERCE_ENV==='staging'&&process.env.NODE_ENV==='test','env_guard');
  chk((await confirmTarget({db,env:process.env})).confirmed,'db_target');
  await version('start');
  const [ag0]=await q('SELECT r.name FROM users u JOIN relais r ON r.id=u.relais_id WHERE lower(u.email)=lower($1)',[process.env.E2E_AGENT_RELAIS_EMAIL]);R.agent_relais_name=ag0?.name;
  const fx=await provisionBuyer();
  const order=await buyerOrder(fx);R.order={id:order.id,reference:order.reference};
  const s0=await state(order.id);R.after_order={o:s0.o,items:s0.items};
  const total=Number(s0.o.total_kmf);
  chk(s0.o.status==='pending'&&s0.o.payment_mode==='cash_relais'&&s0.items.length>=1,'order_pending_cash_relais',{status:s0.o.status,mode:s0.o.payment_mode,lines:s0.items.length});
  R.price_breakdown={items_price_kmf:s0.items.map(i=>i.price_kmf),transport_price_kmf:s0.o.transport_price_kmf,total_kmf:total,display_total_amount:s0.o.display_total_amount};
  soft(num(R.checkout_total_text)===total,'checkout_total_equals_server_total',{ui:R.checkout_total_text,server:total});
  soft(num(R.pdp_price_text)>0&&total===num(R.pdp_price_text),'pdp_price_consistent_with_server',{pdp:R.pdp_price_text,server:total});
  chk(s0.cc.length===0,'no_cash_before_relay');
  const rc=await relayCash(order);
  if(rc&&rc.blocked){const sx=await state(order.id);chk(sx.cc.length===0&&sx.o.status==='pending','cross_relay_no_db_effect',{cc:sx.cc.length,status:sx.o.status});await version('end');R.verdict='BLOQUE_RELAIS_AGENT_NON_AFFECTE_AU_RELAIS_DE_LA_COMMANDE';process.exitCode=2;return}
  const s1=await state(order.id);R.after_cash={o:s1.o,cc:s1.cc,ctl:s1.ctl,hist:s1.hist};
  chk(s1.o.status==='confirmed'&&s1.o.payment_status==='paid','order_confirmed_paid',{s:s1.o.status,p:s1.o.payment_status});
  chk(s1.cc.length===1,'one_cash_collection_after_double_attempt',s1.cc.length);
  chk(Object.values(s1.cc[0]).some(v=>Number(v)===total),'cash_amount_equals_total',s1.cc[0]);
  chk(s1.ctl.filter(c=>c.state==='CONFIRMED').length===1,'one_confirmed_control',s1.ctl.map(c=>c.state));
  chk(s1.o.updated_at!==undefined,'readback');
  await version('end');R.verdict=R.defects?'PASS_WITH_DEFECTS':'CLAUDE_PAR_KM_ORDER_CASH_CHROMIUM_PASS';
 }catch(e){R.verdict='FAIL_OR_BLOCKED';R.error=String(e.message||e).slice(0,400);process.exitCode=2}
 finally{save();await db.pool.end();console.log(JSON.stringify({verdict:R.verdict,error:R.error||null,order:R.order||null}))}
})();
