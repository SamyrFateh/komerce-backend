/** @komerce-arch-lite
 * @role g6-recipe-po-cancel-service
 * @domain purchasing
 * @layer service
 * @owner backend-core
 * @purpose Admin-only local cancellation of a supplier PO exclusively linked to G6-BUYER cash recipes.
 * @db-read purchase_orders, purchase_lines, order_items, orders, hub_purchase_allocations, supplier_execution_payments
 * @db-write-via:alerts-persistence-boundary alerts
 * @db-write purchase_orders, purchase_lines, alerts
 * @db-txn owned
 * @impact-areas purchasing, orders, alerts, staging-only
 */
'use strict';
const db = require('../db');
const {resolveRecipePurchaseOrderAlerts}=require('../utils/alerts');
const UUID = /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const SCOPE = 'G6-BUYER';
function reject(status,code,message){const e=new Error(message||code);e.status=status;e.code=code;return e;}
function assertPeers(rows){
  if(!rows.length)throw reject(409,'G6_PO_NO_ORDERS','PO sans commande vérifiable : refus');
  if(rows.some(r=>r.simulation_scope!==SCOPE))throw reject(403,'G6_PO_MIXED_SCOPE','PO partagée avec une commande non G6 : refus');
  if(rows.some(r=>r.payment_mode!=='cash_relais'))throw reject(403,'G6_PO_NON_CASH','PO non exclusivement cash relais : refus');
  return [...new Set(rows.map(r=>r.order_id))];
}
async function readEligibility(poId,q=db){
  const {rows}=await q.query(`SELECT o.id AS order_id,o.simulation_scope,o.payment_mode
    FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id
    JOIN orders o ON o.id=oi.order_id WHERE pl.purchase_order_id=$1 ORDER BY pl.id`,[poId]);
  try{return {eligible:assertPeers(rows).length>0};}catch(error){return {eligible:false,reason:error.code||'G6_PO_NOT_ELIGIBLE'};}
}
async function cancelRecipePo(poId,{actor,reason}={}){
  if(!UUID.test(String(poId||'')))throw reject(400,'G6_PO_INVALID_ID');
  if(actor?.role!=='admin'||!actor.id)throw reject(403,'G6_PO_ADMIN_ONLY');
  const why=String(reason||'').trim();
  if(why.length<8||why.length>500)throw reject(400,'G6_PO_REASON_REQUIRED','Motif de 8 à 500 caractères obligatoire');
  const client=await db.getClient();
  try{
    await client.query('BEGIN');
    const {rows:[po]}=await client.query('SELECT id,status,order_id FROM purchase_orders WHERE id=$1 FOR UPDATE',[poId]);
    if(!po)throw reject(404,'G6_PO_NOT_FOUND');
    if(po.order_id!==null||!['notified','confirmed'].includes(po.status))
      throw reject(409,'G6_PO_STATUS_FORBIDDEN','Seul un PO groupé notifié ou confirmé est éligible');
    const {rows:lines}=await client.query(`SELECT pl.id AS line_id,pl.cancelled_at,o.id AS order_id,o.simulation_scope,o.payment_mode
      FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id
      JOIN orders o ON o.id=oi.order_id
      WHERE pl.purchase_order_id=$1 ORDER BY pl.id FOR UPDATE OF pl`,[poId]);
    const orders=assertPeers(lines);
    const {rows:physical}=await client.query(
      'SELECT 1 FROM hub_purchase_allocations WHERE purchase_order_id=$1 LIMIT 1',[poId]);
    if(physical.length)throw reject(409,'G6_PO_PHYSICAL_RECEIVED','PO avec réception physique : utiliser la clôture D, ne pas détacher');
    const {rows:debits}=await client.query(
      'SELECT 1 FROM supplier_execution_payments WHERE purchase_order_id=$1 AND real_debit_verified=TRUE LIMIT 1',[poId]);
    if(debits.length)throw reject(409,'G6_PO_REAL_DEBIT','Débit fournisseur réel : action de recette refusée');
    // Une seule transaction : aucune requête fournisseur, aucun PSP.
    await client.query(`UPDATE purchase_orders SET status='cancelled',updated_at=NOW(),
      notes=CONCAT(COALESCE(notes,''),$2::text) WHERE id=$1`,
      [poId,'\n[G6-CLEANUP PO] '+new Date().toISOString()+' actor='+actor.id+' reason='+why]);
    // I3 (migration 263) interdit de détacher une ligne d'un PO engagé.
    // Conserver la FK historique et sa preuve de transmission ; seule l'annulation
    // métier de chaque ligne est autorisée (I5, écriture unique). Aucun trigger affaibli.
    const {rows:cancelled}=await client.query(`UPDATE purchase_lines SET
      cancelled_at=NOW(),cancel_reason=$2::text,updated_at=NOW()
      WHERE purchase_order_id=$1 AND cancelled_at IS NULL RETURNING id`,
      [poId,'G6-CLEANUP PO · '+why]);
    // Certaines commandes G6 sont déjà annulées et leurs lignes aussi.
    // La garde I5 rend cancelled_at/cancel_reason immuables : ne jamais les
    // réécrire. Les lignes sont verrouillées ; seul le sous-ensemble encore
    // actif doit avoir été effectivement annulé par notre UPDATE.
    const openBefore=lines.filter(l=>l.cancelled_at==null).length;
    if(cancelled.length!==openBefore)throw reject(409,'G6_PO_CONCURRENT_CHANGE',`G6_PO_CONCURRENT_CHANGE expected_active=${openBefore} updated=${cancelled.length} locked_lines=${lines.length}`);
    await resolveRecipePurchaseOrderAlerts(client,{poId,orderIds:orders,actorId:actor.id});
    await client.query('COMMIT');
    return {purchase_order_id:poId,status:'cancelled',cancelled_lines:lines.map(x=>x.line_id),newly_cancelled_lines:cancelled.map(x=>x.id),orders,external_calls:0};
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    if(/^23[0-9A-Z]{3}$/.test(e.code||'')){
      // Le SQLSTATE et le nom de contrainte sont exposés sans révéler de SQL,
      // de preuve fournisseur ni de données personnelles dans le JSON.
      const error=reject(409,'G6_PO_DB_CONSTRAINT','Annulation PO bloquée par une contrainte PostgreSQL');
      error.pgCode=e.code;
      if(/^[a-zA-Z0-9_]+$/.test(e.constraint||''))error.constraint=e.constraint;
      const match=/^([a-zA-Z0-9_]+):/.exec(e.message||'');
      if(match)error.dbReason=match[1];
      throw error;
    }
    throw e;
  }
  finally{client.release();}
}
module.exports={assertPeers,readEligibility,cancelRecipePo};
