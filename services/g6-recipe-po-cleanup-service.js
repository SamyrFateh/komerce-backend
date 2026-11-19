/** @komerce-arch-lite
 * @role g6-recipe-po-cancellation
 * @domain purchasing
 * @layer service
 * @owner purchasing
 * @purpose Annule atomiquement une PO engagée de recette exclusivement G6-BUYER, sans contact fournisseur.
 * @db-read purchase_orders, purchase_lines, order_items, orders, v_purchase_line_progress, supplier_execution_payments
 * @db-write purchase_orders, purchase_lines
 * @db-write-via:utils/alerts.js alerts
 * @db-txn single_atomic_recipe_po_cancellation
 * @impact-areas purchasing, orders, staging-recette
 */
'use strict';
const db=require('../db');
const {fail,requireUuid,withTransaction}=require('./purchasing-grouped-service').shared;
const ELIGIBLE=['notified','confirmed'];
function scopeVerdict(rows,status){
 if(!ELIGIBLE.includes(status))return {eligible:false,code:'G6_PO_STATUS_REFUSED'};
 if(!rows.length || rows.some(r=>r.simulation_scope!=='G6-BUYER'||r.payment_mode!=='cash_relais'))
  return {eligible:false,code:'G6_PO_MIXED_OR_UNREADABLE'};
 return {eligible:true,code:'G6_PO_ALLOWED'};
}
async function recipePoEligibility(poId,q=db){
 requireUuid(poId,'po_id');
 const {rows:[po]}=await q.query('SELECT id, status, order_id FROM purchase_orders WHERE id=$1',[poId]);
 if(!po || po.order_id!==null)return {eligible:false,code:'G6_PO_NOT_GROUPED'};
 const {rows}=await q.query(`SELECT DISTINCT o.id,o.simulation_scope,o.payment_mode
 FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id
 JOIN orders o ON o.id=oi.order_id
 WHERE pl.purchase_order_id=$1`,[poId]);
 return scopeVerdict(rows,po.status);
}
async function cancelG6RecipePo(poId,reason,actor){
 requireUuid(poId,'po_id');
 const motif=typeof reason==='string'?reason.trim():'';
 if(motif.length<8 || motif.length>500)throw fail(400,'G6_REASON_REQUIRED','Motif obligatoire (8–500 caractères)');
 if(!actor?.id || actor.role!=='admin')throw fail(403,'G6_ADMIN_ONLY','Action réservée à l’administrateur');
 return withTransaction(async client=>{
  const {rows:[po]}=await client.query('SELECT id,status,order_id FROM purchase_orders WHERE id=$1 FOR UPDATE',[poId]);
  if(!po)throw fail(404,'PURCHASE_ORDER_NOT_FOUND','PO introuvable');
  if(po.order_id!==null)throw fail(409,'G6_PO_NOT_GROUPED','PO historique non admissible');
  const {rows:lines}=await client.query(`SELECT pl.id,oi.order_id,o.simulation_scope,o.payment_mode
    FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id
    JOIN orders o ON o.id=oi.order_id
    WHERE pl.purchase_order_id=$1 ORDER BY pl.id FOR UPDATE OF pl`,[poId]);
  const verdict=scopeVerdict(lines,po.status);
  if(!verdict.eligible)throw fail(409,verdict.code,'PO non admissible : toutes les commandes doivent être G6-BUYER, cash relais, avec statut notified/confirmed');
  const ids=lines.map(l=>l.id);
  const {rows:received}=await client.query(`SELECT line_id,received_quantity FROM v_purchase_line_progress
     WHERE line_id=ANY($1::uuid[])`,[ids]);
  if(received.some(x=>Number(x.received_quantity)>0))throw fail(409,'G6_PO_PHYSICAL_RECEIPT','PO avec marchandise reçue : clôture physique requise');
  const orderIds=[...new Set(lines.map(l=>l.order_id))];
  const {rows:paid}=await client.query(`SELECT id FROM supplier_execution_payments WHERE purchase_order_id=$1 AND real_debit_verified IS TRUE LIMIT 1`,[poId]);
  if(paid.length)throw fail(409,'G6_PO_REAL_DEBIT','Débit fournisseur réel détecté : annulation de recette refusée');
  // PostgreSQL triggers own the cancellation of these committed lines.
  // The G6-only detachment is permitted only after the PO becomes terminal
  // and the trigger has archived cancelled_at / cancel_reason.
  await client.query("SELECT set_config('komerce.g6_recipe_po_id',$1,true)",[poId]);
  const {rowCount}=await client.query(`UPDATE purchase_orders
    SET status='cancelled',updated_at=NOW(),
        notes=CONCAT(COALESCE(notes,''),$2::text)
    WHERE id=$1 AND status IN ('notified','confirmed')`,
    [poId,'\\n[G6-RECIPE-PO] actor='+actor.id+' reason='+motif+' (sans contact fournisseur)']);
  if(rowCount!==1)throw fail(409,'G6_PO_CONCURRENT_CHANGE','Statut PO modifié en parallèle');
  const {rowCount:detached}=await client.query(`UPDATE purchase_lines
    SET purchase_order_id=NULL, updated_at=NOW()
    WHERE id=ANY($1::uuid[]) AND purchase_order_id=$2 AND cancelled_at IS NOT NULL`,[ids,poId]);
  if(detached!==ids.length)throw fail(409,'G6_PO_LINES_NOT_CANCELLED','Toutes les lignes de recette doivent être annulées avant détachement');
  const {resolveRecipePoAlerts}=require('../utils/alerts');
  await resolveRecipePoAlerts(client,{poId,orderIds,actorId:actor.id});
  return {purchase_order_id:poId,status:'cancelled',detached:ids,orders:orderIds,external_calls:0};
 });
}
module.exports={scopeVerdict,recipePoEligibility,cancelG6RecipePo};
