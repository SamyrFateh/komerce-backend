/** @komerce-arch-lite
 * @role g6-negative-n40-price-gap-chromium
 * @domain purchasing
 * @layer script
 * @owner backend-core
 * @purpose N40 (staging only) : l'admin confirme à l'écran Achats fournisseurs une ligne de PO à un prix différent du devis ; la réponse du serveur est jugée, les effets relus par l'oracle PG. Aucune écriture SQL, aucun paiement, aucun appel fournisseur.
 * @db-read purchase_orders, purchase_lines, order_items, purchase_order_authorizations, supplier_execution_payments
 * @db-write none
 * @impact-areas staging-only, purchasing
 */
'use strict';
const MK=require('./canonical/market-profile').marketProfile(process.env);
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const {runtime}=require('./g6-hub-shipment-chromium');
const {login}=require('./g6-canonical-forwarder-chromium');
const {observe,fullError}=require('./canonical/observability');
const {humanGoto,humanClick,humanFill}=require('./canonical/actors/human-gestures');
const env=process.env,BASE='https://komerce-backend-production.up.railway.app';
const ID=env.G6_CANONICAL_ORDER_ID,REF=env.G6_CANONICAL_ORDER_REFERENCE,PO=env.G6_CANONICAL_PO_ID;
const OUT=path.resolve('test-results/g6-negative-n40');
let OBS=null;
const report={schema:'komerce-g6-negative-n40/1',scenario_id:'N40',market:MK.code,reference:REF,order_id:ID,po_id:PO,
 provenance:'SIMULATED / STAGING ONLY',verdict:'BLOCKED',steps_reached:[],confirm:null,gaps:[],ux_signal:null,page_events:[],
 external_supplier_calls:0,external_payment_executed:false,production_permitted:false};
const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n')};
const reach=k=>{report.steps_reached.push(k);save()};
const check=(ok,code)=>{if(!ok)throw Error(code)};
async function main(){
 let browser;
 try{
  save();
  check(env.GITHUB_REPOSITORY==='SamyrFateh/komerce-backend'&&env.GITHUB_EVENT_NAME==='issues'&&
   env.GITHUB_ACTOR===env.GITHUB_REPOSITORY_OWNER&&env.NODE_ENV==='test'&&env.KOMERCE_ENV==='staging'&&
   env.KOMERCE_TARGET_ENV==='staging'&&env.EXPECTED_RAILWAY_ENVIRONMENT==='staging'&&env.STAGING_BASE_URL===BASE&&
   env.G6_CANONICAL_PHASE==='N40_SUPPLIER_PRICE_GAP'&&env.G6_CANONICAL_SCENARIO==='N40'&&env.G6_DYNAMIC_FRESH_ORDER==='1'&&
   env.G6_TARGET_MARKET===MK.code&&/^[a-f0-9-]{36}$/i.test(ID||'')&&/^[a-f0-9-]{36}$/i.test(PO||''),'G6_N40_OWNER_STAGING_GUARD');
  const guard=await confirmTarget({db,env});
  check(guard.confirmed&&guard.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT,'G6_N40_DB_FINGERPRINT_DRIFT');
  report.db_fingerprint=guard.fingerprint;report.sha=await runtime();
  const {rows:[l]}=await db.query(`SELECT po.status::text AS po_status,pl.id,pl.quantity,pl.supplier_unit_price::text AS quoted,pl.product_sku_id
   FROM purchase_orders po JOIN purchase_lines pl ON pl.purchase_order_id=po.id WHERE po.id=$1 AND pl.cancelled_at IS NULL`,[PO]);
  check(l&&l.po_status==='notified'&&l.quoted!=null,'G6_N40_PRECONDITION_PO_NOTIFIED_QUOTED');
  report.quoted=l.quoted;report.sku_before=l.product_sku_id;
  const typed=Math.round(Number(l.quoted)*1.1*100)/100+0.01;report.typed_price=typed;save();
  browser=await chromium.launch({headless:true});OBS=observe(browser,OUT);
  const admin=await login(browser,'E2E_ADMIN_','admin');
  try{
   admin.page.on('pageerror',e=>report.page_events.push({kind:'pageerror',msg:String(e.message).slice(0,160)}));
   await humanGoto(admin.page,'/admin/workspaces/purchasing?po='+encodeURIComponent(PO),{waitUntil:'domcontentloaded'});
   const form=admin.page.locator('[data-purchasing-po="'+PO+'"] form[data-purchasing-confirm]');
   const shown=await form.waitFor({state:'visible',timeout:30000}).then(()=>true,()=>false);
   check(shown,'G6_N40_SCREEN_MISSING_PURCHASING_CONFIRM_FORM');
   reach('CONFIRM_FORM_OPEN');
   const price=form.locator('[data-confirmed-price]');
   check(await price.count()===1,'G6_N40_SCREEN_MISSING_CONFIRMED_PRICE_FIELD');
   await humanFill(null,price.first(),String(typed));
   const proof=form.locator('[data-purchase-proof-ref]');
   if(await proof.count()){
    await humanFill(null,proof.first(),'[SIMULATED / STAGING ONLY] G6-N40-PREUVE-'+REF);
    await humanFill(null,form.locator('[data-purchase-seller-label]').first(),'SIMULATED-STAGING-VENDEUR-'+REF);
   }
   const url=BASE+'/api/purchasing/po/'+PO+'/confirm';let permitted=0,guardHit=0;
   await admin.page.route(url,route=>{
    const req=route.request();let b;try{b=req.postDataJSON()}catch(_){b=null}
    const ln=b&&b.lines&&b.lines[0];
    if(req.method()==='POST'&&permitted===0&&ln&&b.lines.length===1&&ln.confirmed_unit_price===typed&&ln.confirmed_quantity===Number(l.quantity)){permitted++;return route.continue()}
    guardHit++;return route.abort('blockedbyclient');
   });
   const pending=admin.page.waitForResponse(r=>r.url()===url&&r.request().method()==='POST',{timeout:20000}).catch(()=>null);
   await humanClick(null,form.locator('[data-workspace-action="confirm-po"]'));
   const res=await pending;
   if(res){const j=await res.json().catch(()=>({}));report.confirm={http:res.status(),code:j.code||null,message:String(j.error||'').slice(0,200)||null,request_sent:true}}
   else report.confirm={http:null,request_sent:false,guard_blocked:guardHit};
   await admin.page.waitForTimeout(1000);
   const text=await admin.page.locator('body').innerText().catch(()=>'');
   report.price_gap_message_visible=/écart|difference|différen|prix confirmé/i.test(text);
   if(!res)report.ux_signal='CONFIRMATION_SANS_REQUETE_NI_MESSAGE';
   check(guardHit===0,'G6_N40_UNEXPECTED_BROWSER_WRITE');
   reach('CONFIRM_WITH_PRICE_GAP_TRIED');
  }finally{await admin.ctx.close()}
  await runtime();
  report.verdict='G6_N40_SUPPLIER_PRICE_GAP_CONFIRM_TRIED_CHROMIUM_PASS';save();
 }catch(e){report.error=fullError(e);save();process.exitCode=2}
 finally{if(OBS)await OBS.finish(!!process.exitCode).catch(()=>{});if(browser)await browser.close().catch(()=>{});await db.pool.end();console.log(JSON.stringify(report))}
}
if(require.main===module)main();
module.exports={main};
