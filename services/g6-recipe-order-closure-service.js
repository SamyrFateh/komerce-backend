/** @komerce-arch-lite
 * @role g6-recipe-order-hub-closure
 * @domain orders
 * @layer service
 * @owner orders
 * @purpose Transactional staging-only G6-BUYER close with canonical parcel, Hub and stock lifecycle.
 * @db-read orders, order_items, purchase_lines, purchase_orders, parcels, customs_shipment_parcels, international_shipment_relay_receipts
 * @db-write-via:hub-physical-identity hub_physical_unit_placements, hub_physical_units, hub_custody_events
 * @db-write-via:parcel-operations parcels
 * @db-write-via:order-status-machine orders, order_status_history, local_stock_allocations, product_skus, products
 * @db-txn single_atomic_admin_recipe_closure
 * @impact-areas orders, logistics, staging-recette
 */
'use strict';
const db=require('../db');
const {transitionOrderStatus}=require('./order-status-machine');
const {transitionParcelStatus}=require('./parcel-operations');
const {releaseG6RecipeHubPlacements}=require('./hub-physical-identity');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LATE=new Set(['preparation','shipped','in_transit','available']);
function err(status,code,message){return Object.assign(new Error(message||code),{status,code});}
function validateScope(order,actor,reason,hasReceivedPo){
 if(!actor?.id||actor.role!=='admin')throw err(403,'G6_RECIPE_ADMIN_REQUIRED');
 if(!UUID.test(String(order?.id||'')))throw err(404,'G6_RECIPE_ORDER_NOT_FOUND');
 if(order.simulation_scope!=='G6-BUYER')throw err(403,'G6_RECIPE_SCOPE_REFUSED','Commande hors G6-BUYER');
 if(order.payment_mode!=='cash_relais')throw err(409,'G6_RECIPE_PAYMENT_MODE_REFUSED');
 if(!LATE.has(order.status) && !hasReceivedPo)throw err(409,'G6_RECIPE_STATUS_REFUSED');
 if(['collected','cancelled','refunded'].includes(order.status))throw err(409,'G6_RECIPE_ALREADY_TERMINAL');
 if(Number(order.wallet_applied_kmf||0)>0)throw err(409,'G6_RECIPE_WALLET_APPLIED');
 if(typeof reason!=='string'||reason.trim().length<8||reason.trim().length>500)
   throw err(400,'G6_RECIPE_REASON_REQUIRED','Motif de clôture obligatoire (8–500 caractères)');
 return true;
}
async function hasReceivedPurchaseOrder(q,orderId){
 const {rows}=await q.query(`SELECT 1 FROM purchase_lines pl
 JOIN order_items oi ON oi.id=pl.order_item_id
 JOIN purchase_orders po ON po.id=pl.purchase_order_id
 WHERE oi.order_id=$1 AND po.status IN ('hub_received','received','partially_received')
 LIMIT 1`,[orderId]);
 return rows.length>0;
}
async function closeG6RecipeAtHub(orderId,reason,actor){
 if(process.env.KOMERCE_ENV!=='staging')throw err(403,'G6_RECIPE_STAGING_ONLY');
 if(!UUID.test(String(orderId||'')))throw err(400,'G6_RECIPE_ID_INVALID');
 const client=await db.getClient();
 try{
  await client.query('BEGIN');
  const {rows:[order]}=await client.query(`SELECT id,reference,status,simulation_scope,payment_mode,wallet_applied_kmf
    FROM orders WHERE id=$1 FOR UPDATE`,[orderId]);
  if(!order)throw err(404,'G6_RECIPE_ORDER_NOT_FOUND');
  const hasReceivedPo=await hasReceivedPurchaseOrder(client,orderId);
  validateScope(order,actor,reason,hasReceivedPo);
  const {rows:[receipt]}=await client.query(`SELECT 1 FROM international_shipment_relay_receipts r
    JOIN order_items oi ON oi.id=r.order_item_id WHERE oi.order_id=$1 LIMIT 1`,[orderId]);
  if(receipt)throw err(409,'G6_RECIPE_RELAY_RECEIPT_REFUSED','Le relais détient déjà une preuve de réception');
  const {rows:parcels}=await client.query(`SELECT id,status::text AS status FROM parcels
    WHERE order_id=$1 ORDER BY id FOR UPDATE`,[orderId]);
  if(parcels.some(p=>p.status==='collected'))throw err(409,'G6_RECIPE_PARCEL_COLLECTED');
  const {rows:customs}=await client.query(`SELECT 1 FROM customs_shipment_parcels cp
    JOIN parcels p ON p.id=cp.parcel_id WHERE p.order_id=$1 LIMIT 1`,[orderId]);
  if(customs.length)throw err(409,'G6_RECIPE_PARCEL_SHIPMENT_REFUSED');
  // No browser/SQL cleanup: Logistics owns the removal of active placements and immutable evidence.
  // Required local transaction scope for migration 465's G6-only PACKED placement guard.
  await client.query("SELECT set_config('komerce.g6_recipe_order_id',$1,true)",[orderId]);
  const physical=await releaseG6RecipeHubPlacements(client,{orderId,actorId:actor.id,reason:reason.trim()});
  let releasedParcels=0;
  for(const p of parcels){
   if(p.status==='cancelled')continue;
   const result=await transitionParcelStatus(client,p.id,'cancelled',{cancelReason:'[G6-RECIPE] '+reason.trim()});
   if(!result?.ok)throw err(409,'G6_RECIPE_PARCEL_TRANSITION_REFUSED');
   releasedParcels++;
  }
  const result=await transitionOrderStatus({
   orderId,newStatus:'cancelled',actor,source:'cancel',dbClient:client,
   cancelReason:'[G6-RECIPE] '+reason.trim(),
   note:'Clôture de recette G6 — marchandise conservée au Hub/quarantaine, sans remboursement PSP ni contact fournisseur. '+reason.trim(),
  });
  if(!result?.success||result.newStatus!=='cancelled')throw err(409,'G6_RECIPE_ORDER_TRANSITION_REFUSED',result?.error);
  await client.query('COMMIT');
  return {order_id:orderId,status:'cancelled',physical,parcels_cancelled:releasedParcels,
    psp_refunds:0,supplier_contacts:0,reason:reason.trim()};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
 finally{client.release();}
}
module.exports={LATE,validateScope,hasReceivedPurchaseOrder,closeG6RecipeAtHub};
