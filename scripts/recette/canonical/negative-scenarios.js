/** @komerce-arch-lite
 * @role g6-negative-scenarios
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Scénarios négatifs N07/N09/N04/N33 (G6-G4A), N23/N24 (G6-G4B) : résolution multi-SKU en lecture seule, oracles PG en lecture seule, verdicts SCREEN_MISSING/PRODUCT_GAP.
 * @db-read orders, order_items, product_skus, products, markets, product_market_price_drafts, product_market_exposure, local_stock, local_stock_allocations, cash_collections, cash_confirmation_controls, scans, parcels, parcel_items, purchase_lines, pickup_collect_failures
 * @db-write none
 * @impact-areas staging-only
 */
'use strict';
const NEGATIVE=Object.freeze(['N07','N09','N04','N33','N23','N24']);
const isNegative=s=>NEGATIVE.includes(String(s));
// Produit vendable (prix LOCAL_ACTIVE, exposition ENABLED, actif) servi par l'import (aucun stock local exposé), SKU actifs en stock.
const MULTI_SKU_SQL=`
 SELECT p.id,p.product_ref,d.amount,
  (SELECT json_agg(json_build_object('sku_id',k.id,'variant_combo',k.variant_combo) ORDER BY k.id)
     FROM product_skus k WHERE k.product_id=p.id AND k.is_active=TRUE AND k.stock>0 AND k.variant_combo IS NOT NULL) AS skus
 FROM products p
 JOIN markets m ON m.code=$1
 JOIN product_market_price_drafts d ON d.product_id=p.id AND d.market_id=m.id AND d.status='LOCAL_ACTIVE'
 JOIN product_market_exposure e ON e.product_id=p.id AND e.market_id=m.id AND e.commercial_exposure='ENABLED'
 WHERE p.lifecycle_status='active' AND p.is_active=TRUE AND p.is_available=TRUE
   AND NOT EXISTS (SELECT 1 FROM local_stock ls WHERE ls.product_id=p.id AND ls.market_id=m.id AND ls.commercial_exposure='ENABLED')
 ORDER BY p.product_ref`;
const canon=v=>JSON.stringify(v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
// Pur : deux SKU aux combinaisons distinctes (ou null).
function pickTwoSkus(skus){
 if(!Array.isArray(skus))return null;
 const seen=new Set(),out=[];
 for(const k of skus){
  if(!k||!k.sku_id||!k.variant_combo||typeof k.variant_combo!=='object'||!Object.keys(k.variant_combo).length)continue;
  const c=canon(k.variant_combo);
  if(seen.has(c))continue;seen.add(c);out.push({sku_id:k.sku_id,variant_combo:k.variant_combo});
  if(out.length===2)return out;
 }
 return null;
}
// Lecture seule : premier produit vendable à >= 2 SKU distincts ; sinon verdict PREREQ_MISSING_MULTI_SKU (jamais créé ici).
async function readMultiSkuProducts(db,market){
 const {rows}=await db.query(MULTI_SKU_SQL,[market]);
 return rows.map(r=>({id:r.id,product_ref:r.product_ref,price:Number(r.amount),skus:pickTwoSkus(r.skus)})).filter(p=>p.skus);
}
async function resolveMultiSku(db,market){
 const list=await readMultiSkuProducts(db,market);
 if(!list.length)throw Error('PREREQ_MISSING_MULTI_SKU_'+market);
 const p=list[0];
 return {product_ref:p.product_ref,price:p.price,skus:p.skus};
}
const ok=(c,code)=>{if(!c)throw Error(code)};
async function orderRows(db,orderId){
 const {rows:[o]}=await db.query(`SELECT o.id,o.user_id,o.status::text AS status,o.payment_status::text AS payment_status,
  o.display_total_amount,
  (SELECT count(*)::int FROM order_items i WHERE i.order_id=o.id) AS lines,
  (SELECT COALESCE(SUM(i.quantity),0)::int FROM order_items i WHERE i.order_id=o.id) AS qty,
  (SELECT count(*)::int FROM cash_collections c WHERE c.order_id=o.id) AS cash_count,
  (SELECT count(*)::int FROM cash_confirmation_controls c WHERE c.order_id=o.id) AS control_count,
  (SELECT count(*)::int FROM local_stock_allocations a WHERE a.order_id=o.id) AS allocations,
  (SELECT count(*)::int FROM local_stock_allocations a WHERE a.order_id=o.id AND a.consumed_at IS NOT NULL) AS consumed_allocations,
  (SELECT count(*)::int FROM purchase_lines pl JOIN order_items i ON i.id=pl.order_item_id WHERE i.order_id=o.id) AS purchase_lines,
  (SELECT count(*)::int FROM scans s WHERE s.order_id=o.id AND s.step='collected') AS collected_scans,
  (SELECT count(*)::int FROM parcels p WHERE p.order_id=o.id) AS parcels
  FROM orders o WHERE o.id=$1`,[orderId]);
 ok(!!o,'G6_NEG_ORDER_NOT_FOUND');
 return o;
}
// N07 : 1 commande au maximum, aucun double paiement, aucune double réservation.
async function oracleN07(db,{orderId,buyerId}){
 const {rows:[n]}=await db.query('SELECT count(*)::int AS n FROM orders WHERE user_id=$1',[buyerId]);
 ok(n.n<=1,'G6_N07_PRODUCT_GAP_DOUBLE_ORDER_'+n.n);
 const o=await orderRows(db,orderId);
 ok(o.user_id===buyerId&&o.lines===1&&o.qty===1,'G6_N07_PRODUCT_GAP_ORDER_LINES_'+o.lines+'_'+o.qty);
 ok(o.cash_count===0&&o.control_count===0&&o.payment_status!=='paid','G6_N07_PRODUCT_GAP_PAYMENT_EFFECT');
 ok(o.allocations<=1&&o.purchase_lines<=1,'G6_N07_PRODUCT_GAP_DOUBLE_RESERVATION');
 return {orders_for_buyer:n.n,lines:o.lines,qty:o.qty,cash_collections:o.cash_count,allocations:o.allocations,purchase_lines:o.purchase_lines};
}
// N33 : 2 SKU distincts, quantités et total exacts.
async function oracleN33(db,{orderId,variants,market}){
 const o=await orderRows(db,orderId);
 const {rows:items}=await db.query('SELECT sku_id,quantity,variant_combo FROM order_items WHERE order_id=$1',[orderId]);
 const want=variants.map(v=>v.sku_id).sort();
 ok(items.length===2&&JSON.stringify(items.map(i=>i.sku_id).sort())===JSON.stringify(want),'G6_N33_PRODUCT_GAP_SKU_SET');
 ok(items.every(i=>Number(i.quantity)===1)&&o.qty===2,'G6_N33_PRODUCT_GAP_QUANTITIES');
 // Prix unitaire relu en PG (prix marché actif), jamais déduit du total de la commande.
 const {rows:pr}=await db.query(`SELECT DISTINCT d.amount FROM order_items i JOIN product_market_price_drafts d ON d.product_id=i.product_id AND d.status='LOCAL_ACTIVE'
  JOIN markets m ON m.id=d.market_id AND m.code=$2 WHERE i.order_id=$1`,[orderId,market]);
 ok(pr.length===1,'G6_N33_PRODUCT_GAP_UNIT_PRICE_NOT_UNIQUE');
 ok(Number(o.display_total_amount)===Number(pr[0].amount)*2,'G6_N33_PRODUCT_GAP_TOTAL');
 return {sku_ids:want,qty:o.qty,unit_price:Number(pr[0].amount),total:Number(o.display_total_amount)};
}
// N09 : jamais collected, cash non encaissé, stock local non consommé, aucun Hub/transport.
async function oracleN09(db,{orderId,assertNoHubOrTransport}){
 const o=await orderRows(db,orderId);
 const {rows:[pi]}=await db.query('SELECT COALESCE(SUM(pi.qty_collected),0)::int AS n FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id WHERE p.order_id=$1',[orderId]);
 ok(o.status!=='collected'&&o.collected_scans===0&&pi.n===0,'G6_N09_PRODUCT_GAP_COLLECTED');
 ok(o.payment_status!=='paid'&&o.cash_count===0&&o.control_count===0,'G6_N09_PRODUCT_GAP_CASH_EFFECT');
 ok(o.consumed_allocations===0,'G6_N09_PRODUCT_GAP_STOCK_CONSUMED');
 if(assertNoHubOrTransport)await assertNoHubOrTransport(db,orderId,'any');
 return {status:o.status,payment_status:o.payment_status,collected_scans:0,consumed_allocations:0,cash_collections:0};
}
// N23 : aucune remise malgré les tentatives ; compteur de sécurité de l'agent (pickup_collect_failures) lisible en PG.
// MIN_FAILURES = seuil du verrouillage agent (services/pickup-agent-lockout.js : 5 échecs / 15 min).
async function oracleN23(db,{orderId,agentId,minFailures,assertNoHubOrTransport}){
 const o=await orderRows(db,orderId);
 const {rows:[pi]}=await db.query('SELECT COALESCE(SUM(pi.qty_collected),0)::int AS n FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id WHERE p.order_id=$1',[orderId]);
 ok(o.status==='available'&&o.collected_scans===0&&pi.n===0,'G6_N23_PRODUCT_GAP_HANDOFF_DESPITE_BAD_CODES');
 const {rows:[s]}=await db.query('SELECT (pickup_secret_hash IS NOT NULL) AS code_alive,pickup_secret_attempts AS attempts FROM orders WHERE id=$1',[orderId]);
 ok(s.code_alive,'G6_N23_PRODUCT_GAP_CODE_CONSUMED');
 const {rows:[f]}=await db.query(`SELECT count(*)::int AS n FROM pickup_collect_failures WHERE agent_id=$1
   AND relais_id IS NOT DISTINCT FROM (SELECT relais_id FROM users WHERE id=$1) AND created_at>NOW()-interval '15 minutes'`,[agentId]);
 ok(f.n>=minFailures,'G6_N23_PRODUCT_GAP_SECURITY_COUNTER_BELOW_'+f.n);
 if(assertNoHubOrTransport)await assertNoHubOrTransport(db,orderId,'available');
 return {status:o.status,collected_scans:0,qty_collected:0,security_failures_15min:f.n,order_attempts:s.attempts};
}
// N24 : une seule attestation de remise (un scan collected, un historique collected), quantités collectées exactes.
async function oracleN24(db,{orderId,assertNoHubOrTransport}){
 const o=await orderRows(db,orderId);
 const {rows:[x]}=await db.query(`SELECT count(*)::int AS scans,count(*) FILTER (WHERE pickup_method='PICKUP_CODE')::int AS code_scans
   FROM scans WHERE order_id=$1 AND step='collected'`,[orderId]);
 ok(x.scans===1&&x.code_scans===1,'G6_N24_PRODUCT_GAP_HANDOFF_ATTESTATIONS_'+x.scans);
 const {rows:[pi]}=await db.query('SELECT COALESCE(SUM(pi.qty_collected),0)::int AS got,COALESCE(SUM(pi.quantity),0)::int AS want FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id WHERE p.order_id=$1',[orderId]);
 ok(pi.got===pi.want&&pi.want>0,'G6_N24_PRODUCT_GAP_QTY_COLLECTED_'+pi.got+'_OF_'+pi.want);
 ok(o.status==='collected','G6_N24_PRODUCT_GAP_NOT_COLLECTED');
 if(assertNoHubOrTransport)await assertNoHubOrTransport(db,orderId,'collected');
 return {status:o.status,collected_scans:x.scans,qty_collected:pi.got};
}
// N04 : aucune commande, aucun stock négatif, aucune réserve fictive.
async function oracleN04(db,{buyerId,productId,market,availableBefore}){
 const {rows:[n]}=await db.query('SELECT count(*)::int AS n FROM orders WHERE user_id=$1',[buyerId]);
 ok(n.n===0,'G6_N04_PRODUCT_GAP_ORDER_EXISTS_'+n.n);
 const {rows:[a]}=await db.query(`SELECT count(*)::int AS n FROM local_stock_allocations a JOIN orders o ON o.id=a.order_id WHERE o.user_id=$1`,[buyerId]);
 ok(a.n===0,'G6_N04_PRODUCT_GAP_FICTIVE_RESERVATION');
 const {rows:[s]}=await db.query(`SELECT COALESCE(MIN(ls.qty_physical),0)::int AS min_physical,
   COALESCE(SUM(ls.qty_physical-COALESCE((SELECT SUM(x.quantity) FROM local_stock_allocations x WHERE x.local_stock_id=ls.id AND x.consumed_at IS NULL AND x.released_at IS NULL),0)),0)::int AS available
   FROM local_stock ls JOIN markets m ON m.id=ls.market_id AND m.code=$2 WHERE ls.product_id=$1 AND ls.location='KM_MAIN'`,[productId,market]);
 ok(s.min_physical>=0&&s.available>=0,'G6_N04_PRODUCT_GAP_NEGATIVE_STOCK');
 ok(s.available===availableBefore,'G6_N04_PRODUCT_GAP_AVAILABLE_CHANGED');
 return {orders:0,allocations:0,available:s.available};
}
// Pur : verdict explicite pour un écran manquant ou un défaut produit (jamais un contournement).
function classifyNegative(scenario,message){
 const m=String(message||'');
 if(/PREREQ_MISSING_MULTI_SKU/.test(m))return 'PREREQ_MISSING_MULTI_SKU';
 const g=new RegExp('G6_'+scenario+'_(SCREEN_MISSING|PRODUCT_GAP)').exec(m);
 return g?g[1]:null;
}
module.exports={NEGATIVE,isNegative,MULTI_SKU_SQL,pickTwoSkus,readMultiSkuProducts,resolveMultiSku,oracleN07,oracleN33,oracleN09,oracleN23,oracleN24,oracleN04,classifyNegative};
