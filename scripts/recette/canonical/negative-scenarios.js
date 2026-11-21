/** @komerce-arch-lite
 * @role g6-negative-scenarios
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Scénarios négatifs N07/N09/N04/N33 (G6-G4A), N23/N24 (G6-G4B), N11 à N16 (G6-G4C), N17 à N19 (G6-G5B) : résolution multi-SKU en lecture seule, oracles PG en lecture seule, verdicts SCREEN_MISSING/PRODUCT_GAP.
 * @db-read orders, order_items, product_skus, products, markets, product_market_price_drafts, product_market_exposure, local_stock, local_stock_allocations, cash_collections, cash_confirmation_controls, scans, parcels, parcel_items, purchase_lines, pickup_collect_failures, international_shipments, international_shipment_relay_receipts, incidents, purchase_orders, purchase_order_authorizations, supplier_execution_payments, manual_purchase_executions, hub_purchase_allocations, hub_physical_units, hub_physical_unit_placements, hub_box_bags, hub_box_effective_placements, international_shipment_hub_units, international_shipment_events
 * @db-write none
 * @impact-areas staging-only
 */
'use strict';
const {isDeepStrictEqual}=require('node:util');
const NEGATIVE=Object.freeze(['N07','N09','N04','N33','N23','N24','N21','N22','N20','N29','N11','N12','N13','N14','N15','N16','N17','N18','N19','N28','N32','N35','N36','N37','N38','N30','N31','N39F1','N39F2','N39F3','N25','N26b','N40','N26a','N27','N08','N10']);
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
// N21/N22 : l'agent d'un autre relais n'a rien remis ni muté côté métier (commande disponible, code vivant, aucun scan collected).
// Le compteur de tentatives de la commande peut monter (refus cross-relais journalisé) : il est rapporté, jamais écrit ici.
async function oracleCrossRelay(db,{orderId,scenario,assertNoHubOrTransport}){
 const o=await orderRows(db,orderId);
 const {rows:[pi]}=await db.query('SELECT COALESCE(SUM(pi.qty_collected),0)::int AS n FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id WHERE p.order_id=$1',[orderId]);
 ok(o.status==='available'&&o.collected_scans===0&&pi.n===0,'G6_'+scenario+'_PRODUCT_GAP_FOREIGN_AGENT_HANDOFF');
 const {rows:[s]}=await db.query('SELECT (pickup_secret_hash IS NOT NULL) AS code_alive,pickup_secret_attempts AS attempts FROM orders WHERE id=$1',[orderId]);
 ok(s.code_alive,'G6_'+scenario+'_PRODUCT_GAP_CODE_CONSUMED');
 if(assertNoHubOrTransport)await assertNoHubOrTransport(db,orderId,'available');
 return {status:o.status,collected_scans:0,qty_collected:0,order_attempts:s.attempts};
}
// N20 : quantité réellement constatée, incident créé, aucune remise du manquant.
async function oracleN20(db,{orderId}){
 const o=await orderRows(db,orderId);
 const {rows:r}=await db.query(`SELECT rr.expected_qty,rr.received_qty,rr.incident_id,i.id AS incident FROM international_shipment_relay_receipts rr
   JOIN order_items oi ON oi.id=rr.order_item_id LEFT JOIN incidents i ON i.id=rr.incident_id WHERE oi.order_id=$1`,[orderId]);
 ok(r.length>=1,'G6_N20_PRODUCT_GAP_NO_RECEIPT_ROW');
 ok(r.every(x=>Number(x.received_qty)<Number(x.expected_qty)),'G6_N20_PRODUCT_GAP_RECEIVED_QTY_NOT_SHORT');
 ok(r.every(x=>x.incident),'G6_N20_PRODUCT_GAP_NO_INCIDENT');
 const {rows:[pi]}=await db.query(`SELECT COALESCE(SUM(pi.qty_collected),0)::int AS collected,COALESCE(SUM(pi.qty_received),0)::int AS received
   FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id WHERE p.order_id=$1`,[orderId]);
 const got=r.reduce((n,x)=>n+Number(x.received_qty),0);
 ok(pi.received===got,'G6_N20_PRODUCT_GAP_PARCEL_RECEIVED_'+pi.received+'_VS_'+got);
 ok(o.status!=='collected'&&o.collected_scans===0&&pi.collected===0,'G6_N20_PRODUCT_GAP_MISSING_QTY_HANDED_OVER');
 return {receipts:r.length,received_qty:got,expected_qty:r.reduce((n,x)=>n+Number(x.expected_qty),0),incidents:r.length,qty_collected:0,status:o.status};
}
// N11, N12 (G6-G4C) : PO de la commande, autorisations d'engagement et de paiement, effets fournisseur et Hub, en lecture seule.
async function importPo(db,orderId){
 const {rows}=await db.query(`SELECT DISTINCT po.id,po.status::text AS status,po.sent_at,po.sent_channel,po.supplier_order_id
   FROM purchase_orders po JOIN purchase_lines pl ON pl.purchase_order_id=po.id JOIN order_items oi ON oi.id=pl.order_item_id
   WHERE oi.order_id=$1 AND pl.cancelled_at IS NULL`,[orderId]);
 ok(rows.length===1,'G6_NEG_PO_NOT_UNIQUE_'+rows.length);
 return rows[0];
}
async function poEffects(db,poId,orderId){
 const {rows:[x]}=await db.query(`SELECT
  (SELECT count(*)::int FROM purchase_order_authorizations a WHERE a.purchase_order_id=$1 AND a.authorization_type='purchase_commitment') AS commitments,
  (SELECT count(*)::int FROM purchase_order_authorizations a WHERE a.purchase_order_id=$1 AND a.authorization_type='supplier_payment') AS payment_authorizations,
  (SELECT count(*)::int FROM supplier_execution_payments p WHERE p.purchase_order_id=$1) AS supplier_payments,
  (SELECT count(*)::int FROM manual_purchase_executions e WHERE e.purchase_order_id=$1) AS manual_executions,
  (SELECT count(*)::int FROM purchase_lines pl WHERE pl.purchase_order_id=$1 AND pl.confirmed_quantity IS NOT NULL) AS confirmed_lines,
  (SELECT count(*)::int FROM hub_purchase_allocations h WHERE h.order_id=$2) AS hub_allocations,
  (SELECT count(*)::int FROM hub_physical_units u WHERE u.order_id=$2) AS hub_units,
  (SELECT (SELECT payment_status::text FROM orders WHERE id=$2)) AS payment_status`,[poId,orderId]);
 return x;
}
// N11 : PO toujours en brouillon, rien d'envoyé ni de confirmé, aucune autorisation, aucun effet Hub.
async function oracleN11(db,{orderId,poId}){
 const po=await importPo(db,orderId);
 ok(po.id===poId,'G6_N11_PRODUCT_GAP_PO_CHANGED');
 ok(po.status==='draft'&&!po.sent_at&&!po.sent_channel&&!po.supplier_order_id,'G6_N11_PRODUCT_GAP_PO_ADVANCED_'+po.status);
 const x=await poEffects(db,poId,orderId);
 ok(x.commitments===0&&x.payment_authorizations===0,'G6_N11_PRODUCT_GAP_ENGAGEMENT_RECORDED');
 ok(x.manual_executions===0&&x.confirmed_lines===0&&x.supplier_payments===0,'G6_N11_PRODUCT_GAP_SUPPLIER_EFFECT');
 ok(x.hub_allocations===0&&x.hub_units===0,'G6_N11_PRODUCT_GAP_HUB_EFFECT');
 return {po_status:po.status,commitments:0,payment_authorizations:0,manual_executions:0,supplier_payments:0,hub_units:0};
}
// N12 : engagement unique conservé (même pièce), aucune autorisation de paiement ni paiement fournisseur, rien reçu.
async function oracleN12(db,{orderId,poId,commitmentProof}){
 const po=await importPo(db,orderId);
 ok(po.id===poId&&po.status==='confirmed','G6_N12_PRODUCT_GAP_PO_STATE_'+po.status);
 const x=await poEffects(db,poId,orderId);
 ok(x.payment_authorizations===0,'G6_N12_PRODUCT_GAP_PAYMENT_AUTHORIZED_BY_SINGLE_VALIDATOR');
 ok(x.supplier_payments===0,'G6_N12_PRODUCT_GAP_SUPPLIER_PAYMENT_EXECUTED');
 ok(x.commitments===1,'G6_N12_PRODUCT_GAP_COMMITMENT_COUNT_'+x.commitments);
 const {rows:[c]}=await db.query("SELECT proof_ref,decided_by FROM purchase_order_authorizations WHERE purchase_order_id=$1 AND authorization_type='purchase_commitment'",[poId]);
 ok(c&&c.proof_ref===commitmentProof,'G6_N12_PRODUCT_GAP_COMMITMENT_PROOF_CHANGED');
 ok(x.hub_units===0&&x.payment_status==='paid','G6_N12_PRODUCT_GAP_UNEXPECTED_EFFECT');
 return {po_status:po.status,commitments:1,payment_authorizations:0,supplier_payments:0,commitment_proof:c.proof_ref};
}
// N13 : confirmation fournisseur en rupture. Quantité confirmée exacte, reliquat ouvert (hors PO) égal au manque,
// rien de reçu ni de payé. Total (confirmé 0) : PO annulée ; partiel : PO confirmée.
async function oracleN13(db,{orderId,poId,ordered,typed}){
 const po=await importPoAny(db,orderId,poId);
 ok(po.status===(typed===0?'cancelled':'confirmed'),'G6_N13_PRODUCT_GAP_PO_STATE_'+po.status);
 const {rows:[l]}=await db.query(`SELECT pl.id,pl.quantity,pl.confirmed_quantity,purchase_line_received_quantity(pl.id)::int AS received
   FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id WHERE oi.order_id=$1 AND pl.purchase_order_id=$2 AND pl.parent_line_id IS NULL`,[orderId,poId]);
 ok(l&&Number(l.quantity)===ordered,'G6_N13_PRODUCT_GAP_LINE_QUANTITY');
 ok(Number(l.confirmed_quantity)===typed,'G6_N13_PRODUCT_GAP_CONFIRMED_QTY_'+l.confirmed_quantity);
 const {rows:r}=await db.query('SELECT quantity,purchase_order_id,cancelled_at FROM purchase_lines WHERE parent_line_id=$1',[l.id]);
 ok(r.length===1&&Number(r[0].quantity)===ordered-typed&&!r[0].purchase_order_id&&!r[0].cancelled_at,'G6_N13_PRODUCT_GAP_REMNANT_'+r.length);
 const x=await poEffects(db,poId,orderId);
 ok(l.received===0&&x.hub_units===0,'G6_N13_PRODUCT_GAP_FICTIVE_RECEIPT');
 ok(x.supplier_payments===0&&x.payment_authorizations===0,'G6_N13_PRODUCT_GAP_PAYMENT_EFFECT');
 const {rows:[a]}=await db.query('SELECT COALESCE(SUM(quantity),0)::int AS n FROM hub_purchase_allocations WHERE order_id=$1 AND purchase_order_id=$2',[orderId,poId]);
 ok(a.n<=typed,'G6_N13_PRODUCT_GAP_ALLOCATION_ABOVE_CONFIRMED');
 return {po_status:po.status,ordered,confirmed:typed,remnant_quantity:ordered-typed,received:0,hub_units:0,allocated:a.n};
}
async function importPoAny(db,orderId,poId){
 const {rows}=await db.query(`SELECT po.id,po.status::text AS status FROM purchase_orders po WHERE po.id=$1 AND EXISTS
   (SELECT 1 FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id WHERE pl.purchase_order_id=po.id AND oi.order_id=$2)`,[poId,orderId]);
 ok(rows.length===1,'G6_NEG_PO_NOT_FOUND');
 return rows[0];
}
// N14 : une seule réception exacte (quantité reçue = commandée), toutes les quantités des placements strictement positives.
async function oracleN14(db,{orderId,poId,ordered}){
 const {rows:l}=await db.query(`SELECT pl.quantity,purchase_line_received_quantity(pl.id)::int AS received FROM purchase_lines pl
   WHERE pl.purchase_order_id=$1 AND pl.cancelled_at IS NULL`,[poId]);
 ok(l.length===1&&Number(l[0].quantity)===ordered,'G6_N14_PRODUCT_GAP_LINE_QUANTITY');
 ok(l[0].received>=0,'G6_N14_PRODUCT_GAP_NEGATIVE_RECEIVED');
 ok(l[0].received<=ordered,'G6_N14_PRODUCT_GAP_EXCESS_RECEIVED_'+l[0].received);
 ok(l[0].received===ordered,'G6_N14_PRODUCT_GAP_RECEIVED_NOT_EXACT_'+l[0].received);
 const {rows:p}=await db.query(`SELECT p.quantity FROM hub_physical_unit_placements p JOIN hub_purchase_allocations a ON a.id=p.allocation_id
   WHERE a.order_id=$1 AND a.purchase_order_id=$2 AND p.operation_type='RECEIVE' AND p.removed_at IS NULL`,[orderId,poId]);
 ok(p.length===1&&p.every(x=>Number(x.quantity)>0)&&p.reduce((n,x)=>n+Number(x.quantity),0)===ordered,'G6_N14_PRODUCT_GAP_PLACEMENTS_'+p.length);
 const x=await poEffects(db,poId,orderId);
 ok(x.supplier_payments===0&&x.payment_authorizations===0,'G6_N14_PRODUCT_GAP_PAYMENT_EFFECT');
 return {ordered,received:l[0].received,placements:p.length,supplier_payments:0};
}
// N15 : ni sac fermé avec une ligne manquante, ni KOM-BOX remplie ou fermée sans ce sac, ni expédition avec ce carton.
async function oracleN15(db,{orderId,boxRef,shipmentRef}){
 const {rows:bags}=await db.query("SELECT id,state::text AS state FROM hub_physical_units WHERE order_id=$1 AND unit_type='HANDLING_UNIT'",[orderId]);
 ok(bags.length===1,'G6_N15_PRODUCT_GAP_BAG_COUNT_'+bags.length);
 ok(bags[0].state!=='PACKED'&&bags[0].state!=='DISPATCHED','G6_N15_PRODUCT_GAP_BAG_CLOSED_WITH_MISSING_LINE');
 const {rows:[d]}=await db.query('SELECT count(*)::int AS n FROM hub_physical_unit_placements WHERE physical_unit_id=$1 AND removed_at IS NULL',[bags[0].id]);
 ok(d.n===0,'G6_N15_PRODUCT_GAP_BAG_CONTENT_APPEARED');
 const {rows:[l]}=await db.query('SELECT count(*)::int AS n FROM hub_box_bags WHERE bag_unit_id=$1',[bags[0].id]);
 ok(l.n===0,'G6_N15_PRODUCT_GAP_INCOMPLETE_BAG_IN_BOX');
 const {rows:box}=await db.query("SELECT id,state::text AS state FROM hub_physical_units WHERE reference=$1",[boxRef]);
 ok(box.length<=1&&box.every(b=>!['PACKED','DISPATCHED'].includes(b.state)),'G6_N15_PRODUCT_GAP_EMPTY_BOX_CLOSED');
 // Un dossier Hub vide est un brouillon administratif autorisé. N15 refuse
 // un départ ou un carton rattaché, pas l'ouverture d'un dossier hub_ready.
 const {rows:sh}=await db.query(`SELECT s.id,s.stage,s.hub_draft,
   (SELECT COUNT(*)::int FROM international_shipment_hub_units h WHERE h.shipment_id=s.id) AS links,
   (SELECT COUNT(*)::int FROM international_shipment_events e
      WHERE e.shipment_id=s.id AND e.to_stage='handed_over') AS handovers
   FROM international_shipments s WHERE s.reference=$1`,[shipmentRef]);
 ok(sh.length<=1,'G6_N15_PRODUCT_GAP_SHIPMENT_NOT_UNIQUE');
 const draft=sh[0]||null;
 ok(!draft||(draft.stage==='hub_ready'&&draft.hub_draft===true&&
   Number(draft.links)===0&&Number(draft.handovers)===0),
   'G6_N15_PRODUCT_GAP_NON_CONFORMING_DEPARTURE');
 const {rows:[s]}=await db.query(`SELECT
   (SELECT COUNT(*)::int FROM international_shipment_hub_units h JOIN hub_physical_units u
      ON u.id=h.physical_unit_id WHERE u.reference=$1) AS links,
   (SELECT COUNT(*)::int FROM parcels p WHERE p.order_id=$2
      AND (p.shipped_at IS NOT NULL OR p.in_transit_at IS NOT NULL)) AS departed`,[boxRef,orderId]);
 ok(Number(s.links)===0&&Number(s.departed)===0,'G6_N15_PRODUCT_GAP_NON_CONFORMING_DEPARTURE');
 return {bag_state:bags[0].state,bag_content:0,box_state:box[0]?box[0].state:null,
   shipments:sh.length,draft_only:!!draft,departed_parcels:0};
}
// N16 : instantané PG (lecture seule) du carton, de sa composition, de l'expédition et des colis ; comparé avant et après les tentatives.
async function snapN16(db,{orderId,boxRef,shipmentRef}){
 const {rows:box}=await db.query('SELECT id,state::text AS state FROM hub_physical_units WHERE reference=$1',[boxRef]);
 ok(box.length===1,'G6_N16_PRODUCT_GAP_BOX_NOT_UNIQUE_'+box.length);
 const {rows:[c]}=await db.query(`SELECT
  (SELECT count(*)::int FROM hub_box_bags l WHERE l.box_unit_id=$1) AS links,
  (SELECT count(*)::int FROM hub_box_effective_placements p WHERE p.box_unit_id=$1) AS effective,
  (SELECT COALESCE(SUM(p.quantity),0)::int FROM hub_box_effective_placements p WHERE p.box_unit_id=$1) AS qty,
  (SELECT count(*)::int FROM hub_physical_unit_placements p JOIN hub_purchase_allocations a ON a.id=p.allocation_id WHERE a.order_id=$2) AS placements,
  (SELECT count(*)::int FROM hub_physical_unit_placements p JOIN hub_purchase_allocations a ON a.id=p.allocation_id WHERE a.order_id=$2 AND p.removed_at IS NOT NULL) AS removed,
  (SELECT count(*)::int FROM hub_custody_events e WHERE e.physical_unit_id=$1) AS box_custody_events,
  (SELECT count(*)::int FROM international_shipment_hub_units h WHERE h.physical_unit_id=$1) AS shipment_links`,[box[0].id,orderId]);
 const {rows:sh}=await db.query('SELECT stage,forwarder_name,transport_mode FROM international_shipments WHERE reference=$1',[shipmentRef]);
 const {rows:[p]}=await db.query(`SELECT string_agg(DISTINCT p.status::text,',') AS statuses,COALESCE(SUM(pi.qty_shipped),0)::int AS shipped
  FROM parcels p JOIN parcel_items pi ON pi.parcel_id=p.id WHERE p.order_id=$1`,[orderId]);
 return {box_state:box[0].state,...c,shipment_stage:sh[0]?sh[0].stage:null,forwarder:sh[0]?sh[0].forwarder_name:null,transport_mode:sh[0]?sh[0].transport_mode:null,
  parcel_statuses:p.statuses,parcel_shipped:p.shipped};
}
// N16 : carton remis (DISPATCHED puis remis au transitaire) et composition inchangée par les tentatives de modification.
async function oracleN16(db,{orderId,boxRef,shipmentRef,baseline}){
 const s=await snapN16(db,{orderId,boxRef,shipmentRef});
 ok(s.box_state==='DISPATCHED'&&s.shipment_stage==='handed_over'&&!!s.forwarder,'G6_N16_PRODUCT_GAP_HANDOVER_STATE_'+s.box_state+'_'+s.shipment_stage);
 ok(baseline&&isDeepStrictEqual(s,baseline),'G6_N16_PRODUCT_GAP_COMPOSITION_CHANGED_AFTER_HANDOVER');
 return s;
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
// N17, N18, N19 (G6-G5B, Transport et douane) : expédition de la commande, instantanés et oracles PG en lecture seule.
async function shipmentForOrder(db,orderId){
 const {rows}=await db.query(`SELECT s.id,s.reference,s.stage FROM international_shipments s JOIN parcels p ON p.shipment_id=s.id WHERE p.order_id=$1
  UNION SELECT s.id,s.reference,s.stage FROM international_shipments s JOIN international_shipment_hub_units h ON h.shipment_id=s.id
  JOIN hub_box_bags l ON l.box_unit_id=h.physical_unit_id JOIN hub_physical_units u ON u.id=l.bag_unit_id WHERE u.order_id=$1`,[orderId]);
 return rows.length===1?rows[0]:null;
}
async function snapJourney(db,reference){
 const {rows}=await db.query(`SELECT s.stage::text AS stage,s.customs_shipment_id,s.tracking_reference,s.forwarder_name,
  (SELECT count(*)::int FROM international_shipment_events e WHERE e.shipment_id=s.id) AS events,
  (SELECT count(*)::int FROM international_shipment_charges c WHERE c.shipment_id=s.id) AS charges,
  (SELECT count(*)::int FROM international_shipment_relay_receipts r WHERE r.shipment_id=s.id) AS receipts
  FROM international_shipments s WHERE s.reference=$1`,[reference]);
 ok(rows.length===1,'G6_NEG_SHIPMENT_NOT_UNIQUE_'+rows.length);
 return rows[0];
}
// N17 : aucune transition, aucun frais, aucun lien douane ; l'expédition est identique à son point de référence.
async function oracleN17(db,{orderId,shipmentRef,baseline}){
 const s=await snapJourney(db,shipmentRef);
 ok(baseline&&baseline.stage==='handed_over'&&s.stage==='handed_over','G6_N17_PRODUCT_GAP_STAGE_MOVED_'+s.stage);
 ok(isDeepStrictEqual(s,baseline),'G6_N17_PRODUCT_GAP_JOURNEY_CHANGED_BY_REFUSED_ACTOR');
 ok(!s.customs_shipment_id&&s.charges===0&&s.receipts===0&&!s.tracking_reference,'G6_N17_PRODUCT_GAP_SIDE_EFFECT');
 const o=await orderRows(db,orderId);
 ok(o.status!=='collected'&&o.collected_scans===0,'G6_N17_PRODUCT_GAP_COLLECTED');
 return {stage:s.stage,events:s.events,charges:s.charges,customs_linked:false,tracking:false};
}
// N18 : une retenue levée par un acteur identifié ; aucune déclaration ni étape de transit entre la retenue et sa mainlevée ; étapes ensuite.
async function oracleN18(db,{orderId,shipmentRef,customsRef}){
 const s=await snapJourney(db,shipmentRef);
 const {rows:[c]}=await db.query('SELECT id,status::text AS status,customs_paid_kmf FROM customs_shipments WHERE reference=$1',[customsRef]);
 ok(c&&s.customs_shipment_id===c.id,'G6_N18_PRODUCT_GAP_CUSTOMS_NOT_LINKED');
 const {rows:h}=await db.query('SELECT status,held_at,released_at,held_by,released_by,held_by_role,reason FROM customs_shipment_holds WHERE shipment_id=$1',[c.id]);
 ok(h.length===1,'G6_N18_PRODUCT_GAP_HOLD_COUNT_'+h.length);
 ok(h[0].status==='released'&&h[0].released_by&&h[0].held_by&&h[0].released_at>h[0].held_at&&String(h[0].reason).trim().length>=3,'G6_N18_PRODUCT_GAP_HOLD_NOT_RELEASED_BY_ACTOR');
 const {rows:ev}=await db.query('SELECT event_type,to_stage,occurred_at FROM international_shipment_events WHERE shipment_id=(SELECT id FROM international_shipments WHERE reference=$1) ORDER BY occurred_at',[shipmentRef]);
 const during=ev.filter(e=>e.occurred_at>=h[0].held_at&&e.occurred_at<h[0].released_at&&(e.event_type==='customs_amount_confirmed'||['customs_released','local_delivery','relay_received'].includes(e.to_stage)));
 ok(during.length===0,'G6_N18_PRODUCT_GAP_TRANSIT_WHILE_HELD_'+during.length);
 const after=ev.filter(e=>e.occurred_at>=h[0].released_at&&e.event_type==='stage_changed'&&e.to_stage==='customs_released');
 ok(s.stage==='customs_released'&&after.length===1,'G6_N18_PRODUCT_GAP_NO_TRANSIT_AFTER_RELEASE_'+s.stage);
 ok(c.customs_paid_kmf!==null&&s.receipts===0,'G6_N18_PRODUCT_GAP_CUSTOMS_AMOUNT_OR_RECEIPT');
 const o=await orderRows(db,orderId);
 ok(o.status!=='collected'&&o.collected_scans===0,'G6_N18_PRODUCT_GAP_COLLECTED');
 return {held_by_role:h[0].held_by_role,events_during_hold:0,stage:s.stage,customs_paid_kmf:Number(c.customs_paid_kmf)};
}
// N19 : état du transport local (retard : rien d'attesté, aucune disponibilité ni code), puis perte attestée.
async function snapLocalTransport(db,{orderId,shipmentId}){
 const {rows:[x]}=await db.query(`SELECT s.stage::text AS stage,o.status::text AS order_status,(o.pickup_secret_hash IS NOT NULL) AS pickup_code_alive,
  (SELECT count(*)::int FROM international_shipment_relay_receipts r WHERE r.shipment_id=s.id) AS receipts,
  (SELECT count(*)::int FROM scans sc WHERE sc.order_id=o.id AND sc.step='collected') AS collected_scans
  FROM international_shipments s, orders o WHERE s.id=$1 AND o.id=$2`,[shipmentId,orderId]);
 ok(!!x,'G6_N19_SNAPSHOT_MISSING');
 return x;
}
// N19 : quantité reçue nulle, incident « article manquant » de gravité haute, aucune disponibilité, aucun retrait.
async function oracleN19(db,{orderId}){
 const o=await orderRows(db,orderId);
 const {rows:r}=await db.query(`SELECT rr.expected_qty,rr.received_qty,i.id AS incident,i.incident_type::text AS incident_type,i.severity::text AS severity
  FROM international_shipment_relay_receipts rr JOIN order_items oi ON oi.id=rr.order_item_id LEFT JOIN incidents i ON i.id=rr.incident_id WHERE oi.order_id=$1`,[orderId]);
 ok(r.length>=1,'G6_N19_PRODUCT_GAP_NO_RECEIPT_ROW');
 ok(r.every(x=>Number(x.received_qty)===0&&Number(x.expected_qty)>0),'G6_N19_PRODUCT_GAP_RECEIVED_QTY_NOT_ZERO');
 ok(r.every(x=>x.incident&&x.incident_type==='missing_item'&&x.severity==='high'),'G6_N19_PRODUCT_GAP_NO_HIGH_MISSING_ITEM_INCIDENT');
 const {rows:[pi]}=await db.query(`SELECT COALESCE(SUM(pi.qty_collected),0)::int AS collected,COALESCE(SUM(pi.qty_received),0)::int AS received
  FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id WHERE p.order_id=$1`,[orderId]);
 ok(pi.received===0&&pi.collected===0,'G6_N19_PRODUCT_GAP_PARCEL_QTY_'+pi.received+'_'+pi.collected);
 ok(!['available','collected'].includes(o.status)&&o.collected_scans===0,'G6_N19_PRODUCT_GAP_AVAILABLE_OR_COLLECTED_AFTER_TOTAL_LOSS_'+o.status);
 // Le hash du code existe dès la commande (statut preparation) : il n'est pas un signal ; seul le statut disponible ou un retrait compte.
 return {receipts:r.length,received_qty:0,expected_qty:r.reduce((n,x)=>n+Number(x.expected_qty),0),incidents:r.length,severity:'high',status:o.status};
}
// N28 : malgré 500 simulé, réponse perdue après commit et réessai par l'écran : au plus un effet de remise, quantités exactes.
async function oracleN28(db,{orderId,committedBeforeRetry,assertNoHubOrTransport}){
 const o=await orderRows(db,orderId);
 const {rows:[x]}=await db.query("SELECT count(*)::int AS scans FROM scans WHERE order_id=$1 AND step='collected'",[orderId]);
 ok(x.scans===1,'G6_N28_PRODUCT_GAP_HANDOFF_ATTESTATIONS_'+x.scans+(committedBeforeRetry?'_AFTER_COMMITTED_RETRY':'_AFTER_UNCOMMITTED_RETRY'));
 const {rows:[pi]}=await db.query('SELECT COALESCE(SUM(pi.qty_collected),0)::int AS got,COALESCE(SUM(pi.quantity),0)::int AS want FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id WHERE p.order_id=$1',[orderId]);
 ok(pi.got===pi.want&&pi.want>0,'G6_N28_PRODUCT_GAP_QTY_COLLECTED_'+pi.got+'_OF_'+pi.want);
 ok(o.status==='collected','G6_N28_PRODUCT_GAP_NOT_COLLECTED');
 if(assertNoHubOrTransport)await assertNoHubOrTransport(db,orderId,'collected');
 return {status:o.status,collected_scans:x.scans,qty_collected:pi.got,committed_before_retry:!!committedBeforeRetry};
}
// N32 : sondes croisées sans effet ; commande propre disponible, code vivant, aucune remise ; instantané avant/après rapporté par le script.
async function oracleN32(db,{orderId,snapshot,assertNoHubOrTransport}){
 const o=await orderRows(db,orderId);
 ok(snapshot&&snapshot.unchanged===true,'G6_N32_PRODUCT_GAP_MUTATION_DURING_REFUSED_PROBES');
 const {rows:[pi]}=await db.query('SELECT COALESCE(SUM(pi.qty_collected),0)::int AS n FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id WHERE p.order_id=$1',[orderId]);
 ok(o.status==='available'&&o.collected_scans===0&&pi.n===0,'G6_N32_PRODUCT_GAP_HANDOFF_BY_FOREIGN_ROLE');
 if(assertNoHubOrTransport)await assertNoHubOrTransport(db,orderId,'available');
 return {status:o.status,collected_scans:0,qty_collected:0,codes_before:snapshot.before.codes,codes_after:snapshot.after.codes};
}
// ---- G6-G5C : oracles transverses sur la chaîne M01 jusqu'au retrait client (lecture seule). ----
const ECO_Q=require('node:fs').readFileSync(require('node:path').join(__dirname,'../../../docs/recette/G6_ECO_SQL_CONTROLS.sql'),'utf8');
// Pur : instructions SELECT du fichier de contrôles O-ECO (commentaires retirés), Q1 à Q3.
const ecoControls=()=>ECO_Q.split('\n').filter(l=>!/^\s*--/.test(l)).join('\n').split(';').map(s=>s.trim()).filter(s=>/^SELECT/i.test(s));
// N35 (O-ECO) : fret non doublé et allocations causales sur les objets réels de la commande ; contrôles Q1 à Q3 consignés comme diagnostics, sans assertion zéro.
async function oracleN35(db,{orderId}){
 const o=await orderRows(db,orderId);
 const {rows:al}=await db.query(`SELECT a.order_item_id,a.cost_type,a.shipment_id,a.is_actual,a.amount_kmf,(i.order_id=a.order_id) AS causal
   FROM order_item_real_cost_allocations a LEFT JOIN order_items i ON i.id=a.order_item_id WHERE a.order_id=$1`,[orderId]);
 ok(al.length>0,'G6_N35_PRODUCT_GAP_NO_REAL_COST_ALLOCATIONS');
 ok(al.every(a=>a.causal===true),'G6_N35_PRODUCT_GAP_ALLOCATION_NOT_CAUSAL');
 ok(al.every(a=>Number(a.amount_kmf)>=0),'G6_N35_PRODUCT_GAP_NEGATIVE_ALLOCATION');
 const {rows:dup}=await db.query(`SELECT order_item_id,cost_type,COALESCE(shipment_id::text,'-') AS sh,count(*)::int AS n FROM order_item_real_cost_allocations
   WHERE order_id=$1 AND is_actual AND cost_type IN ('freight','customs','local_distribution','relay','hub') GROUP BY 1,2,3 HAVING count(*)>1`,[orderId]);
 ok(dup.length===0,'G6_N35_PRODUCT_GAP_COST_COMPONENT_DOUBLED_'+dup.map(d=>d.cost_type).join('_'));
 const diagnostics=[];
 for(const [i,q] of ecoControls().entries()){const {rows}=await db.query(q);diagnostics.push({control:(['Q1','Q2a','Q2b','Q3'][i]||'Q'+(i+1)),rows:rows.length,sample:rows.slice(0,5)})}
 ok(diagnostics.length>=3,'G6_N35_PREREQ_ECO_CONTROLS_MISSING');
 return {status:o.status,allocations:al.length,cost_types:[...new Set(al.map(a=>a.cost_type))].sort(),freight_doubled:0,diagnostics,
  floor_total_equals_detail:'NOT_PROVEN_NO_PERSISTED_FLOOR_ON_ORDER_OBJECTS',n3_separated:'NOT_PROVEN_NO_N3_MARKER_ON_ALLOCATIONS'};
}
// N36 : modalité MANUAL de M01 (aucun second circuit) : chaque preuve physique de la commande porte la provenance MANUAL avec référence, jamais SCAN ni NULL.
async function oracleN36(db,{orderId}){
 const {rows:pl}=await db.query(`SELECT p.evidence_method,length(btrim(COALESCE(p.evidence_ref,'')))>=6 AS ref_ok
   FROM hub_physical_unit_placements p JOIN hub_purchase_allocations a ON a.id=p.allocation_id WHERE a.order_id=$1`,[orderId]);
 ok(pl.length>0,'G6_N36_PRODUCT_GAP_NO_PLACEMENTS');
 ok(pl.every(p=>p.evidence_method==='MANUAL'&&p.ref_ok),'G6_N36_PRODUCT_GAP_PLACEMENT_NOT_MANUAL_'+[...new Set(pl.map(p=>p.evidence_method||'NULL'))].join('_'));
 const {rows:bb}=await db.query(`SELECT b.evidence_method,length(btrim(COALESCE(b.evidence_ref,'')))>=6 AS ref_ok FROM hub_box_bags b
   JOIN hub_physical_units u ON u.id=b.bag_unit_id WHERE u.order_id=$1`,[orderId]);
 ok(bb.length>0,'G6_N36_PRODUCT_GAP_NO_BAG_LINK');
 ok(bb.every(b=>b.evidence_method==='MANUAL'&&b.ref_ok),'G6_N36_PRODUCT_GAP_BAG_LINK_NOT_MANUAL_'+[...new Set(bb.map(b=>b.evidence_method||'NULL'))].join('_'));
 const {rows:[c]}=await db.query(`SELECT count(*)::int AS n FROM hub_custody_events e JOIN hub_physical_units u ON u.id=e.physical_unit_id WHERE u.order_id=$1`,[orderId]);
 ok(c.n>0,'G6_N36_PRODUCT_GAP_NO_CUSTODY_AUDIT');
 const {rows:[s]}=await db.query("SELECT count(*)::int AS n FROM scans WHERE order_id=$1 AND step='collected'",[orderId]);
 ok(s.n===1,'G6_N36_PRODUCT_GAP_HANDOFF_ATTESTATIONS_'+s.n);
 return {placements:pl.length,placements_manual:pl.length,bag_links:bb.length,bag_links_manual:bb.length,custody_events:c.n,collected_scans:s.n};
}
// Documents confirmés de la commande : lecture seule, partagée par N37 et N38.
async function docState(db,orderId){
 const {rows:[inv]}=await db.query('SELECT count(*)::int AS n,count(pdf_content)::int AS pdf FROM invoices WHERE order_id=$1',[orderId]);
 const {rows:sc}=await db.query("SELECT s.id FROM scans s WHERE s.order_id=$1 AND s.step='collected'",[orderId]);
 const {rows:pp}=await db.query(`SELECT subject_id,count(*)::int AS n FROM transaction_documents WHERE document_type='pickup_proof' AND subject_type='pickup_handoff'
   AND subject_id=ANY($1::uuid[]) GROUP BY subject_id`,[sc.map(r=>r.id)]);
 const {rows:dup}=await db.query(`SELECT document_type,subject_type,count(*)::int AS n FROM transaction_documents WHERE order_id=$1 GROUP BY document_type,subject_type,subject_id HAVING count(*)>1`,[orderId]);
 return {invoices:inv.n,invoice_pdf:inv.pdf,handoffs:sc.length,pickup_proofs:pp.length,pickup_proof_duplicates:pp.filter(r=>r.n>1).length,duplicate_documents:dup.length};
}
// N37 (O-DOC, O-NOTIF) : un seul document par événement confirmé, aucun doublon, aucun envoi réel ; l'accès (O-SEC-DOC) est jugé par le script.
async function oracleN37(db,{orderId,reference,poId}){
 const o=await orderRows(db,orderId);
 ok(o.status==='collected'&&o.payment_status==='paid','G6_N37_PRODUCT_GAP_ORDER_NOT_COLLECTED_PAID');
 const d=await docState(db,orderId);
 ok(d.invoices===1,'G6_N37_PRODUCT_GAP_INVOICE_COUNT_'+d.invoices);
 ok(d.duplicate_documents===0&&d.pickup_proof_duplicates===0,'G6_N37_PRODUCT_GAP_DUPLICATE_DOCUMENT');
 ok(d.pickup_proofs===d.handoffs&&d.handoffs===1,'G6_N37_PRODUCT_GAP_PICKUP_PROOF_'+d.pickup_proofs+'_OF_'+d.handoffs);
 const {rows:po}=poId?await db.query("SELECT count(*)::int AS n FROM transaction_documents WHERE document_type='purchase_order' AND subject_id=$1",[poId]):{rows:[{n:null}]};
 ok(po[0].n===null||po[0].n<=1,'G6_N37_PRODUCT_GAP_PO_DOCUMENT_DUPLICATED');
 const {rows:nl}=await db.query('SELECT channel,event,status FROM notification_log WHERE order_ref=$1',[reference]);
 ok(!nl.some(n=>/^(sent|delivered|success|ok)$/i.test(n.status)),'G6_N37_PRODUCT_GAP_REAL_SEND_ON_STAGING');
 ok(!nl.some(n=>/in_transit/i.test(n.event)),'G6_N37_PRODUCT_GAP_IN_TRANSIT_NOTIFICATION');
 const seen=new Map();for(const n of nl){const k=n.channel+'/'+n.event;seen.set(k,(seen.get(k)||0)+1)}
 ok(![...seen.values()].some(v=>v>1),'G6_N37_PRODUCT_GAP_NOTIFICATION_DUPLICATED');
 return {...d,po_documents:po[0].n,notifications:nl.map(n=>({channel:n.channel,event:n.event,status:n.status})),real_sends:0};
}
// N38 : événement métier conservé ; chaque document manquant doit être détecté par la reprise (dry run) ; aucun doublon, aucun envoi. Aucune injection de panne possible sur le staging.
async function oracleN38(db,{orderId,reference,dryRun}){
 const o=await orderRows(db,orderId);
 ok(o.status==='collected'&&o.payment_status==='paid'&&o.collected_scans===1,'G6_N38_PRODUCT_GAP_EVENT_NOT_KEPT');
 const d=await docState(db,orderId);
 ok(d.duplicate_documents===0&&d.pickup_proof_duplicates===0&&d.invoices<=1,'G6_N38_PRODUCT_GAP_DUPLICATE_DOCUMENT');
 const missing={invoice:d.invoices===1&&d.invoice_pdf===1?0:1,pickup_proof:d.handoffs-d.pickup_proofs};
 const fam=dryRun&&dryRun.families||null;
 ok(!!fam&&dryRun.dry_run===true&&dryRun.issued===0,'G6_N38_SCREEN_MISSING_RESUME_DRY_RUN_NOT_PROVEN');
 if(missing.invoice)ok(fam.invoice&&fam.invoice.missing>=1,'G6_N38_PRODUCT_GAP_RESUME_BLIND_SPOT_INVOICE');
 if(missing.pickup_proof)ok(fam.pickup_proof&&fam.pickup_proof.missing>=1,'G6_N38_PRODUCT_GAP_RESUME_BLIND_SPOT_PICKUP_PROOF');
 const {rows:nl}=await db.query('SELECT status FROM notification_log WHERE order_ref=$1',[reference]);
 ok(!nl.some(n=>/^(sent|delivered|success|ok)$/i.test(n.status)),'G6_N38_PRODUCT_GAP_REAL_SEND_ON_STAGING');
 return {...d,missing_for_order:missing,resume_detects_missing:missing.invoice+missing.pickup_proof>0,dry_run_global_missing:Object.fromEntries(Object.entries(fam).map(([k,v])=>[k,v.missing])),
  failure_leg:'NOT_PROVEN_NO_FAULT_INJECTION_ON_STAGING',real_sends:0};
}
// N30 : Order 360 et KPI Commerce relus par l'admin, comparés à PG ; les commandes de recette ne doivent pas compter dans le KPI commercial.
async function oracleN30(db,{orderId,order360,commerce}){
 ok(order360&&commerce,'G6_N30_SCREEN_MISSING_READS_NOT_PROVEN');
 const o=await orderRows(db,orderId);
 const {rows:[x]}=await db.query(`SELECT total_kmf::bigint AS total_kmf,simulation_scope,created_at,
   (SELECT count(*)::int FROM parcels p WHERE p.order_id=o.id AND p.status::text<>'cancelled') AS parcels FROM orders o WHERE o.id=$1`,[orderId]);
 const bad=[];
 if(order360.status!==o.status)bad.push('STATUS');
 if(order360.payment_status!==o.payment_status)bad.push('PAYMENT_STATUS');
 if(Number(order360.total_kmf)!==Number(x.total_kmf))bad.push('TOTAL_KMF');
 if(order360.items!==o.lines||order360.quantity!==o.qty)bad.push('ITEMS_QTY');
 if(order360.parcels!==x.parcels)bad.push('PARCELS');
 ok(!bad.length,'G6_N30_PRODUCT_GAP_ORDER_360_DIFFERS_FROM_PG_'+bad.join('_'));
 const win=[commerce.from,commerce.to];
 const sum=async scoped=>(await db.query(`SELECT COALESCE(SUM(o.total_kmf+COALESCE(o.wallet_applied_kmf,0)),0)::bigint AS v FROM orders o
   WHERE o.created_at>=$1 AND o.created_at<=$2 AND o.payment_status='paid' AND o.status NOT IN ('cancelled','refunded')
   AND o.simulation_scope IS ${scoped?'NOT ':''}NULL`,win)).rows[0].v;
 const real=Number(await sum(false)),simulated=Number(await sum(true));
 if(Number(commerce.ca_value)!==real){
  const {rows:[q]}=await db.query('SELECT count(*)::int AS n FROM orders WHERE updated_at>$1',[commerce.to]);
  ok(q.n===0,'G6_N30_PREREQ_MISSING_QUIET_WINDOW_'+q.n);
  throw Error('G6_N30_PRODUCT_GAP_COMMERCE_KPI_'+commerce.ca_value+'_VS_PG_'+real);
 }
 const inWindow=new Date(x.created_at)>=new Date(commerce.from)&&new Date(x.created_at)<=new Date(commerce.to);
 const counted=inWindow&&o.payment_status==='paid'&&!['cancelled','refunded'].includes(o.status)&&x.simulation_scope==null;
 ok(!counted,'G6_N30_PRODUCT_GAP_FIXTURE_COUNTED_IN_COMMERCIAL_KPI');
 return {order_360_matches_pg:true,kpi_ca_pg:real,kpi_ca_api:Number(commerce.ca_value),scoped_fixtures_excluded_kmf:simulated,order_in_window:inWindow,order_simulation_scope:x.simulation_scope};
}
// N31 : snapshot monétaire d'affichage conservé dans la devise du marché, cohérent avec les parités fixes ; remboursement non joué dans cette séquence.
async function oracleN31(db,{orderId,market}){
 const {rows:[x]}=await db.query('SELECT total_kmf::numeric AS total_kmf,display_total_amount::numeric AS shown,display_currency,display_parity_snapshot FROM orders WHERE id=$1',[orderId]);
 const want=market==='KM'?'KMF':'XAF';
 ok(x.display_currency===want,'G6_N31_PRODUCT_GAP_DISPLAY_CURRENCY_'+x.display_currency+'_FOR_'+market);
 ok(Number(x.shown)>0&&x.display_parity_snapshot!=null,'G6_N31_PRODUCT_GAP_DISPLAY_SNAPSHOT_MISSING');
 const {rows:p}=await db.query("SELECT currency,eur_rate::numeric AS r FROM currency_parities WHERE currency IN ('KMF',$1)",[want]);
 const rate=c=>Number((p.find(r=>r.currency===c)||{}).r);
 ok(rate('KMF')>0&&rate(want)>0,'G6_N31_PREREQ_MISSING_CURRENCY_PARITIES');
 const expected=Number(x.total_kmf)/rate('KMF')*rate(want);
 ok(Math.abs(Number(x.shown)-expected)<=Math.max(5,expected*0.02),'G6_N31_PRODUCT_GAP_SNAPSHOT_DIFFERS_FROM_FIXED_PARITY_'+x.shown+'_VS_'+Math.round(expected));
 const {rows:[r]}=await db.query('SELECT count(*)::int AS n FROM refunds WHERE order_id=$1',[orderId]);
 ok(r.n===0,'G6_N31_PRODUCT_GAP_REFUND_WITHOUT_GESTURE');
 return {display_currency:x.display_currency,display_total:Number(x.shown),expected_from_parity:Math.round(expected),snapshot_keys:Object.keys(x.display_parity_snapshot||{}),refunds:0,
  refund_leg:'NOT_PROVEN_NO_REFUND_GESTURE_IN_SEQUENCE',floating_purchase_currency:'NOT_REPRESENTABLE_ME_10'};
}
// N39 (G6-G5B, annulation client aux paliers F1, F2, F3) : effets relus en PG, lecture seule.
async function cancelEffects(db,orderId){
 const {rows:[x]}=await db.query(`SELECT o.status::text AS status,o.display_total_amount,m.currency::text AS market_currency,
  (SELECT count(*)::int FROM wallet_transactions t WHERE t.reference_id=o.id AND t.type='credit' AND t.reason='order_cancel') AS credits,
  (SELECT COALESCE(SUM(t.amount_kmf),0)::int FROM wallet_transactions t WHERE t.reference_id=o.id AND t.type='credit' AND t.reason='order_cancel') AS credit_amount,
  (SELECT string_agg(DISTINCT t.currency::text,',') FROM wallet_transactions t WHERE t.reference_id=o.id AND t.type='credit' AND t.reason='order_cancel') AS credit_currency,
  (SELECT count(*)::int FROM refunds r WHERE r.order_id=o.id) AS refunds,
  (SELECT count(*)::int FROM refund_execution_intents i WHERE i.order_id=o.id) AS psp_intents,
  (SELECT count(*)::int FROM purchase_order_authorizations a JOIN purchase_lines pl ON pl.purchase_order_id=a.purchase_order_id JOIN order_items oi ON oi.id=pl.order_item_id
    WHERE oi.order_id=o.id AND a.authorization_type='purchase_commitment') AS commitments,
  (SELECT count(*)::int FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id WHERE oi.order_id=o.id AND pl.cancelled_at IS NULL) AS active_lines
  FROM orders o LEFT JOIN markets m ON m.id=o.market_id WHERE o.id=$1`,[orderId]);
 ok(!!x,'G6_NEG_ORDER_NOT_FOUND');
 return x;
}
// F1 (avant achat) : annulation acceptée, remboursement 100 % crédité au wallet en devise du marché, une fois, sans PSP, aucune ligne d'achat active.
async function oracleN39F1(db,{orderId,cancel}){
 const x=await cancelEffects(db,orderId);
 ok(cancel&&cancel.http>=200&&cancel.http<300,'G6_N39F1_PRODUCT_GAP_CANCEL_REFUSED_HTTP_'+(cancel?cancel.http:null));
 ok(x.status==='cancelled','G6_N39F1_PRODUCT_GAP_NOT_CANCELLED_'+x.status);
 ok(x.credits===1&&x.refunds===1,'G6_N39F1_PRODUCT_GAP_REFUND_COUNT_'+x.credits+'_'+x.refunds);
 ok(x.psp_intents===0,'G6_N39F1_PRODUCT_GAP_PSP_INTENT');
 ok(x.credit_currency===x.market_currency,'G6_N39F1_PRODUCT_GAP_WALLET_CURRENCY_'+x.credit_currency+'_VS_'+x.market_currency);
 ok(x.credit_amount===Math.round(Number(x.display_total_amount)),'G6_N39F1_PRODUCT_GAP_REFUND_NOT_100_PCT_'+x.credit_amount+'_OF_'+x.display_total_amount);
 ok(x.active_lines===0,'G6_N39F1_PRODUCT_GAP_ACTIVE_PURCHASE_LINES_'+x.active_lines);
 return {status:x.status,wallet_credits:x.credits,wallet_amount:x.credit_amount,currency:x.credit_currency,psp_intents:0};
}
// F2 (achat engagé) : aucune annulation ni remboursement silencieux, engagement inchangé (la décision relève d'une demande admin).
async function oracleN39F2(db,{orderId,cancel}){
 const x=await cancelEffects(db,orderId);
 ok(x.status!=='cancelled'&&!(cancel&&cancel.http>=200&&cancel.http<300),'G6_N39F2_PRODUCT_GAP_SILENT_CANCEL_AFTER_COMMITMENT_'+x.status);
 ok(x.credits===0&&x.refunds===0&&x.psp_intents===0,'G6_N39F2_PRODUCT_GAP_SILENT_REFUND_'+x.credits+'_'+x.refunds);
 ok(x.commitments>=1&&x.active_lines>=1,'G6_N39F2_PRODUCT_GAP_ENGAGEMENT_DROPPED_SILENTLY');
 return {status:x.status,wallet_credits:0,refunds:0,commitments:x.commitments,client_http:cancel?cancel.http:null};
}
// F3 (embarqué) : annulation fermée, aucun remboursement.
async function oracleN39F3(db,{orderId,cancel}){
 const x=await cancelEffects(db,orderId);
 ok(x.status!=='cancelled'&&!(cancel&&cancel.http>=200&&cancel.http<300),'G6_N39F3_PRODUCT_GAP_CANCELLED_WHEN_SHIPPED_'+x.status);
 ok(x.credits===0&&x.refunds===0&&x.psp_intents===0,'G6_N39F3_PRODUCT_GAP_REFUND_WHEN_SHIPPED');
 return {status:x.status,wallet_credits:0,refunds:0,client_http:cancel?cancel.http:null};
}
// N25 (G6-G5B, SAV retour et double reprise) : un seul dossier, une seule reprise physique, produit isolé, aucune compensation ni revente.
async function oracleN25(db,{orderId,stockBefore}){
 const o=await orderRows(db,orderId);
 ok(o.status==='collected','G6_N25_PRODUCT_GAP_ORDER_NOT_COLLECTED_'+o.status);
 const {rows:d}=await db.query("SELECT id,status::text AS status,return_quantity FROM disputes WHERE order_id=$1 AND type='product_return'",[orderId]);
 ok(d.length===1&&Number(d[0].return_quantity)===1,'G6_N25_PRODUCT_GAP_DOSSIER_COUNT_'+d.length);
 const {rows:r}=await db.query('SELECT quantity,relay_id FROM relay_product_return_receipts WHERE request_id=$1',[d[0].id]);
 ok(r.length===1&&Number(r[0].quantity)===1,'G6_N25_PRODUCT_GAP_PHYSICAL_RECEIPT_COUNT_'+r.length);
 ok(['open','processing'].includes(d[0].status),'G6_N25_PRODUCT_GAP_DOSSIER_AUTO_RESOLVED_'+d[0].status);
 const {rows:[c]}=await db.query(`SELECT
  (SELECT count(*)::int FROM relay_return_compensations x WHERE x.request_id=$1) AS compensations,
  (SELECT count(*)::int FROM wallet_transactions t WHERE t.reference_id=$2 AND t.type='credit') AS wallet_credits,
  (SELECT count(*)::int FROM refunds f WHERE f.order_id=$2) AS refunds,
  (SELECT count(*)::int FROM refund_execution_intents i WHERE i.order_id=$2) AS psp_intents,
  (SELECT COALESCE(SUM(ls.qty_physical),0)::int FROM local_stock ls JOIN orders o ON o.market_id=ls.market_id JOIN order_items oi ON oi.order_id=o.id AND oi.product_id=ls.product_id WHERE o.id=$2) AS stock_after`,[d[0].id,orderId]);
 ok(c.compensations===0&&c.wallet_credits===0&&c.refunds===0&&c.psp_intents===0,'G6_N25_PRODUCT_GAP_AUTOMATIC_COMPENSATION_ON_PHYSICAL_INTAKE');
 ok(c.stock_after===stockBefore,'G6_N25_PRODUCT_GAP_RETURNED_UNIT_BACK_IN_SELLABLE_STOCK_'+stockBefore+'_TO_'+c.stock_after);
 return {dossiers:1,physical_receipts:1,compensations:0,wallet_credits:0,refunds:0,stock_unchanged:true,dossier_status:d[0].status};
}
// N40 (G6-G5B, prix fournisseur confirmé différent du devis) : écart accepté seulement avec validation séparée ; jamais de paiement, d'autorisation ni de substitution silencieux.
async function oracleN40(db,{orderId,poId,confirm,quoted}){
 const {rows:[l]}=await db.query(`SELECT po.status::text AS po_status,pl.confirmed_quantity,pl.confirmed_unit_price::text AS confirmed_price,pl.supplier_unit_price::text AS unit_price,pl.product_sku_id
  FROM purchase_orders po JOIN purchase_lines pl ON pl.purchase_order_id=po.id WHERE po.id=$1 AND pl.parent_line_id IS NULL`,[poId]);
 ok(!!l&&!!l.product_sku_id,'G6_N40_PRODUCT_GAP_LINE_OR_SKU_LOST');
 const x=await poEffects(db,poId,orderId);
 ok(x.supplier_payments===0&&x.payment_authorizations===0&&x.manual_executions===0,'G6_N40_PRODUCT_GAP_SILENT_PAYMENT_OR_EXECUTION');
 ok(x.hub_units===0,'G6_N40_PRODUCT_GAP_HUB_EFFECT');
 const accepted=confirm&&confirm.http>=200&&confirm.http<300;
 const gap=l.confirmed_price!=null&&Number(l.confirmed_price)!==Number(quoted);
 ok(!(accepted&&gap&&l.po_status==='confirmed'),'G6_N40_PRODUCT_GAP_PRICE_GAP_ACCEPTED_WITHOUT_SEPARATE_VALIDATION_'+quoted+'_TO_'+l.confirmed_price);
 return {po_status:l.po_status,quoted:Number(quoted),confirmed_price:l.confirmed_price==null?null:Number(l.confirmed_price),client_http:confirm?confirm.http:null,payments:0};
}
// Pur : verdict explicite pour un écran manquant ou un défaut produit (jamais un contournement).
function classifyNegative(scenario,message){
 const m=String(message||'');
 if(/PREREQ_MISSING_MULTI_SKU/.test(m))return 'PREREQ_MISSING_MULTI_SKU';
 if(/PREREQ_MISSING_SECOND_RELAY/.test(m))return 'PREREQ_MISSING_SECOND_RELAY';
 if(/PREREQ_MISSING_FOREIGN_MARKET_ORDER/.test(m))return 'PREREQ_MISSING_FOREIGN_MARKET_ORDER';
 const g=new RegExp('G6_'+scenario+'_(SCREEN_MISSING|PRODUCT_GAP)').exec(m);
 return g?g[1]:null;
}
module.exports={NEGATIVE,isNegative,MULTI_SKU_SQL,pickTwoSkus,readMultiSkuProducts,resolveMultiSku,oracleN07,oracleN33,oracleN09,oracleN23,oracleN24,oracleCrossRelay,oracleN20,oracleN04,oracleN11,oracleN12,oracleN13,oracleN14,oracleN15,oracleN16,oracleN28,oracleN32,oracleN30,oracleN31,oracleN35,oracleN36,oracleN37,oracleN38,ecoControls,snapN16,shipmentForOrder,snapJourney,snapLocalTransport,oracleN17,oracleN18,oracleN19,cancelEffects,oracleN39F1,oracleN39F2,oracleN39F3,oracleN25,oracleN40,importPo,classifyNegative,oracleN08,snapN10,oracleN10};
// N08 : une seule commande, une seule ligne, une unité, une clé consommée, aucun paiement ni réservation en double.
async function oracleN08(db,{orderId,buyerId}){
 const {rows:[n]}=await db.query('SELECT count(*)::int AS n FROM orders WHERE user_id=$1',[buyerId]);
 ok(n.n===1,'G6_N08_PRODUCT_GAP_ORDERS_'+n.n);
 const o=await orderRows(db,orderId);
 ok(o.user_id===buyerId&&o.lines===1&&o.qty===1,'G6_N08_PRODUCT_GAP_ORDER_LINES_'+o.lines+'_'+o.qty);
 ok(o.cash_count===0&&o.control_count===0&&o.payment_status!=='paid','G6_N08_PRODUCT_GAP_PAYMENT_EFFECT');
 ok(o.allocations<=1&&o.purchase_lines<=1,'G6_N08_PRODUCT_GAP_DOUBLE_RESERVATION');
 const {rows:[k]}=await db.query('SELECT count(*)::int AS keys FROM order_checkout_idempotency WHERE user_id=$1 AND response_snapshot IS NOT NULL',[buyerId]);
 ok(k.keys===1,'G6_N08_PRODUCT_GAP_COMPLETED_KEYS_'+k.keys);
 return {orders_for_buyer:n.n,lines:o.lines,qty:o.qty,completed_keys:k.keys,cash_collections:o.cash_count,allocations:o.allocations,purchase_lines:o.purchase_lines};
}
// N10 : instantané PG lecture seule de la commande, des événements PSP portant le préfixe du scénario et de la transaction mobile money ciblée.
async function snapN10(db,{orderId,prefix,txId=null}){
 const {rows:[o]}=await db.query(`SELECT o.payment_status::text AS payment_status,o.status::text AS status,
  (SELECT count(*)::int FROM cash_collections c WHERE c.order_id=o.id) AS cash_count,
  (SELECT count(*)::int FROM stripe_events_processed e WHERE e.stripe_event_id LIKE $2) AS psp_events
  FROM orders o WHERE o.id=$1`,[orderId,prefix+'%']);
 ok(!!o,'G6_N10_ORDER_NOT_FOUND');
 let tx=null;
 if(txId){const {rows}=await db.query('SELECT status::text AS status,updated_at FROM mobile_money_transactions WHERE id=$1',[txId]);tx=rows[0]||null}
 return {...o,tx_status:tx?tx.status:null,tx_updated_at:tx?String(tx.updated_at):null};
}
// N10 : aucun règlement ni événement PSP après webhooks non signés/dupliqués ; la transaction mobile money est inchangée.
function oracleN10(before,after){
 ok(!!before&&!!after,'G6_N10_SNAPSHOT_MISSING');
 ok(after.payment_status===before.payment_status&&after.payment_status!=='paid'&&after.status===before.status,'G6_N10_PRODUCT_GAP_ORDER_SETTLED_BY_UNSIGNED_WEBHOOK');
 ok(after.cash_count===before.cash_count&&after.cash_count===0,'G6_N10_PRODUCT_GAP_PAYMENT_RECORDED');
 ok(after.psp_events===0&&before.psp_events===0,'G6_N10_PRODUCT_GAP_UNSIGNED_EVENT_RECORDED');
 ok(after.tx_status===before.tx_status&&after.tx_updated_at===before.tx_updated_at,'G6_N10_PRODUCT_GAP_MOBILE_MONEY_TX_CHANGED');
 return {payment_status:after.payment_status,cash_collections:after.cash_count,psp_events:after.psp_events,mobile_money_tx:after.tx_status};
}
