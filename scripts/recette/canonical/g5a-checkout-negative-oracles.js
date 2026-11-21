/** @komerce-arch-lite
 * @role g6-g5a-checkout-negative-oracles
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Contrats vérifiables N01/N02/N03/N05/N06 ; aucun verdict positif sans geste Chromium, réponse HTTP et état PG.
 * @db-read orders, order_items, cash_collections, local_stock_allocations, purchase_lines, product_market_price_drafts, product_market_exposure, markets, product_skus
 * @db-write none
 * @impact-areas staging-only
 */
'use strict';

const IDS=Object.freeze(['N01','N02','N03','N05','N06']);
const NO_PURCHASE=Object.freeze(['N01','N02','N03','N05']);
const EFFECTS=Object.freeze(['orders','order_items','cash_collections','allocations','purchase_lines']);
const assert=(value,code)=>{if(!value)throw Error(code)};
const numeric=(v)=>Number.isSafeInteger(v)&&v>=0;
const snap=(e)=>EFFECTS.every(k=>numeric(e?.[k]));
const nonEmpty=(s)=>typeof s==='string'&&s.trim().length>0;
function assertEvidenceBase(id,e){
 assert(IDS.includes(id),'G6_G5A_SCENARIO_UNSUPPORTED');
 assert(e&&e.scenario_id===id&&['KM','CM','CG'].includes(e.market),'G6_'+id+'_NOT_PROVEN_IDENTITY');
 assert(e.actor_role==='client'&&e.gesture_source==='CHROMIUM'&&nonEmpty(e.trace_path)&&
  nonEmpty(e.screenshot_path)&&e.staging_only===true&&e.external_psp_calls===0,
  'G6_'+id+'_NOT_PROVEN_CHROMIUM_EVIDENCE');
 assert(snap(e.before)&&snap(e.after),'G6_'+id+'_NOT_PROVEN_PG_SNAPSHOT');
 assert(e.before.orders===0,'G6_'+id+'_NOT_PROVEN_FRESH_BUYER_REQUIRED');
 assert(Array.isArray(e.http_attempts),'G6_'+id+'_NOT_PROVEN_HTTP_LOG');
}
function checkPrecondition(id,p){
 const bad='G6_'+id+'_PREREQ_MISSING_NEGATIVE_CONDITION';
 assert(p&&typeof p==='object',bad);
 if(id==='N01')assert(p.price_status!==null&&p.price_status!=='LOCAL_ACTIVE'&&nonEmpty(p.price_status),bad);
 if(id==='N02')assert(p.exposure_recorded===true&&p.commercial_exposure==='DISABLED',bad);
 if(id==='N03')assert(p.market_lifecycle==='SUSPENDED'||(
  p.market_lifecycle==='ACTIVE'&&p.route_available===false&&
  p.route_basis==='CANONICAL_IS_RELAIS_ROUTABLE'&&
  Number.isSafeInteger(p.active_relays)&&p.active_relays>=0&&p.routable_relays===0),bad);
 if(id==='N05')assert(p.product_candidate===true&&p.certification_verdict==='BLOCKED'&&(
  (p.certification_rule==='active_supplier_sku_missing'&&p.sku_complete===false)
  ||(p.certification_rule==='supplier_order_identity_incomplete'&&
    p.sku_complete===true&&p.soi_complete===false&&
    Number.isSafeInteger(p.active_supplier_skus)&&p.active_supplier_skus>0&&
    Number.isSafeInteger(p.complete_supplier_skus)&&
    p.complete_supplier_skus<p.active_supplier_skus)),bad);
 if(id==='N06')assert(numeric(p.quote_before)&&numeric(p.quote_after)&&
    p.quote_before>0&&p.quote_after>0&&p.quote_before!==p.quote_after,bad);
}
function validateG5aEvidence(id,e){
 assertEvidenceBase(id,e);
 checkPrecondition(id,e.precondition);
 if(NO_PURCHASE.includes(id)){
  if(id==='N03'&&e.precondition.market_lifecycle==='ACTIVE'){
   assert(e.ui?.route_checkout_attempted===true&&
    e.ui?.public_routable_relais===0&&e.ui?.confirm_enabled===false,
    'G6_N03_NOT_PROVEN_ROUTE_CHECKOUT_GESTURE');
   assert(e.route_before?.resolution==='CANONICAL_IS_RELAIS_ROUTABLE'&&
    e.route_before?.routable_relays===0&&e.route_after?.routable_relays===0&&
    JSON.stringify(e.route_before)===JSON.stringify(e.route_after),
    'G6_N03_NOT_PROVEN_ROUTE_PG_READBACK');
  }
  // Un refus 401/403 (mauvais compte) ou une erreur réseau ne prouve jamais la règle produit.
  for(const a of e.http_attempts){
   assert(a.method==='POST'&&a.path==='/api/orders','G6_'+id+'_NOT_PROVEN_REQUEST_SCOPE');
   assert([400,404,409,422,428].includes(a.status)&&a.code!=='AUTH_REQUIRED'&&a.code!=='FORBIDDEN',
    'G6_'+id+'_PRODUCT_GAP_UNEXPECTED_CHECKOUT_RESPONSE_'+a.status);
  }
  assert(e.http_attempts.length>0||e.ui?.buy_unavailable===true,
   'G6_'+id+'_SCREEN_MISSING_NO_NEGATIVE_GESTURE');
  // Une absence de POST n'est pertinente qu'après un geste réel sur un contrôle indisponible,
  // et non parce que le script n'a pas cherché le produit.
  if(e.http_attempts.length===0)assert(e.ui?.attempted_open_product===true&&
    e.ui?.purchase_control_absent_or_disabled===true,'G6_'+id+'_NOT_PROVEN_UI_BLOCK');
  for(const key of EFFECTS)assert(e.after[key]===e.before[key]&&e.after[key]===0,
    'G6_'+id+'_PRODUCT_GAP_UNEXPECTED_EFFECT_'+key);
  assert(e.after_stock_available===e.before_stock_available&&numeric(e.after_stock_available),
    'G6_'+id+'_PRODUCT_GAP_STOCK_CHANGED');
  return Object.freeze({scenario_id:id,oracle_verdict:'PASS',no_order:true,
    no_payment:true,no_reservation:true,gesture_source:'CHROMIUM'});
 }
 assert(e.restore?.success===true&&e.market_price_before===e.market_price_after,
  'G6_N06_NOT_PROVEN_RESTORE_PRICE');
 // N06 : un premier clic rejette le devis périmé, puis un SECOND clic humain accepte
 // le prix nouveau. Le client ne peut jamais être débité sur la première tentative.
 const a=e.http_attempts;
 assert(a.length===2&&a.every(x=>x.method==='POST'&&x.path==='/api/orders'),
  'G6_N06_NOT_PROVEN_TWO_EXPLICIT_POSTS');
 assert(a[0].status===409&&a[0].code==='price_changed',
  'G6_N06_PRODUCT_GAP_STALE_PRICE_NOT_REJECTED');
 assert(a[1].status===201&&nonEmpty(String(a[1].order_id||'')),
  'G6_N06_PRODUCT_GAP_RECONFIRMATION_NOT_CREATED');
 assert(e.ui?.explicit_second_click===true&&e.ui?.new_total_shown===e.precondition.quote_after&&
  e.ui?.old_total_shown===e.precondition.quote_before,
  'G6_N06_PRODUCT_GAP_SILENT_REPRICING');
 assert(e.after.orders===1&&e.after.order_items===1&&
  e.after.cash_collections===0&&e.after.purchase_lines===0,
  'G6_N06_PRODUCT_GAP_DUPLICATE_OR_PREMATURE_EFFECT');
 assert(e.after.order_display_total===e.precondition.quote_after&&
  e.after.order_id===a[1].order_id,'G6_N06_PRODUCT_GAP_WRONG_PRICE_SNAPSHOT');
 assert(e.after.allocations<=1,'G6_N06_PRODUCT_GAP_DOUBLE_RESERVATION');
 return Object.freeze({scenario_id:'N06',oracle_verdict:'PASS',rejected_stale_quote:true,
  explicit_reconfirmation:true,orders:1,gesture_source:'CHROMIUM'});
}
// PostgreSQL oracle de non-effet, borné au client G6 créé pour UN run.
// Le snapshot est effectué avant et après la tentative ; aucun SQL métier n'est écrit ici.
async function snapshotBuyerEffects(db,buyerId){
 assert(nonEmpty(buyerId),'G6_G5A_BUYER_ID_MISSING');
 const {rows:[v]}=await db.query(`
 SELECT
  (SELECT count(*)::int FROM orders o WHERE o.user_id=$1) AS orders,
  (SELECT count(*)::int FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.user_id=$1) AS order_items,
  (SELECT count(*)::int FROM cash_collections c JOIN orders o ON o.id=c.order_id WHERE o.user_id=$1) AS cash_collections,
  (SELECT count(*)::int FROM local_stock_allocations a JOIN orders o ON o.id=a.order_id WHERE o.user_id=$1) AS allocations,
  (SELECT count(*)::int FROM purchase_lines pl JOIN order_items i ON i.id=pl.order_item_id JOIN orders o ON o.id=i.order_id WHERE o.user_id=$1) AS purchase_lines
 `,[buyerId]);
 assert(snap(v),'G6_G5A_INCOMPLETE_DB_SNAPSHOT');
 return Object.freeze(Object.fromEntries(EFFECTS.map(k=>[k,v[k]])));
}
module.exports={IDS,NO_PURCHASE,EFFECTS,checkPrecondition,validateG5aEvidence,snapshotBuyerEffects};
