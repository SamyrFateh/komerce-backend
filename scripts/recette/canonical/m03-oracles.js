/** @komerce-arch-lite
 * @role g6-m03-mixed-basket-oracles
 * @domain orders
 * @layer script
 * @owner backend-core
 * @purpose Read-only PG oracles for the M03 mixed basket (local line + import lines): key oracle = never collected before import delivery.
 * @impact-areas staging-only
 */
'use strict';
const {MIN_IMPORT_SOURCES}=require('./m03-prereq');
async function readSnapshot(db,orderId){
 const {rows:[order]}=await db.query('SELECT status::text AS status,payment_status::text AS payment_status FROM orders WHERE id=$1',[orderId]);
 const {rows:lines}=await db.query(`
  SELECT oi.id,p.product_ref,oi.fulfillment_source::text AS fulfillment_source,oi.quantity::int AS quantity,
   COALESCE(SUM(pi.qty_received),0)::int AS qty_received,COALESCE(SUM(pi.qty_collected),0)::int AS qty_collected
  FROM order_items oi JOIN products p ON p.id=oi.product_id
  LEFT JOIN parcel_items pi ON pi.order_item_id=oi.id
   AND EXISTS (SELECT 1 FROM parcels pa WHERE pa.id=pi.parcel_id AND pa.cancelled_at IS NULL)
  WHERE oi.order_id=$1 GROUP BY oi.id,p.product_ref ORDER BY oi.created_at,oi.id`,[orderId]);
 const {rows:parcels}=await db.query(`
  SELECT pa.id,pa.status::text AS status,
   ARRAY_AGG(DISTINCT CASE WHEN oi.fulfillment_source='IMPORT' THEN 'import' ELSE 'local' END) AS lanes
  FROM parcels pa JOIN parcel_items pi ON pi.parcel_id=pa.id JOIN order_items oi ON oi.id=pi.order_item_id
  WHERE pa.order_id=$1 AND pa.cancelled_at IS NULL GROUP BY pa.id`,[orderId]);
 return {order,lines:lines.map(l=>({...l,quantity:Number(l.quantity),qty_received:Number(l.qty_received),qty_collected:Number(l.qty_collected)})),parcels};
}
// Pur. phase : 'basket' (après commande), 'local_available', 'local_collected' (oracle clé), 'final'.
function evaluate(s,phase){
 const bad=[],local=s.lines.filter(l=>l.fulfillment_source==='LOCAL_STOCK'),imp=s.lines.filter(l=>l.fulfillment_source==='IMPORT');
 if(!['structure','basket','local_available','local_collected','final'].includes(phase))throw Error('G6_M03_PHASE_UNKNOWN');
 if(local.length!==1)bad.push('local_lines_'+local.length);
 if(imp.length<MIN_IMPORT_SOURCES)bad.push('import_lines_'+imp.length);
 if(s.lines.some(l=>!['LOCAL_STOCK','IMPORT'].includes(l.fulfillment_source)))bad.push('unknown_fulfillment');
 const status=s.order?.status;
 if(phase==='structure'){
  // forme du panier seulement (valable à tout moment)
 }else if(phase==='basket'){
  if(s.lines.some(l=>l.qty_received||l.qty_collected))bad.push('already_received_or_collected');
 }else if(phase==='local_available'){
  if(local.some(l=>l.qty_received!==l.quantity||l.qty_collected!==0))bad.push('local_not_available');
  if(imp.some(l=>l.qty_received||l.qty_collected))bad.push('import_touched_before_delivery');
  if(status==='collected')bad.push('order_collected_early');
 }else if(phase==='local_collected'){
  if(local.some(l=>l.qty_collected!==l.quantity))bad.push('local_not_handed_over');
  if(imp.some(l=>l.qty_collected))bad.push('import_collected_before_delivery');
  // Oracle clé : la remise de la partie locale ne clôt jamais la commande.
  if(status==='collected')bad.push('order_collected_before_import_delivery');
 }else{
  if(s.lines.some(l=>l.qty_collected!==l.quantity))bad.push('line_not_collected');
  if(status!=='collected')bad.push('order_not_collected_after_import_delivery');
 }
 return bad;
}
function assertPhase(s,phase){
 const bad=evaluate(s,phase);
 if(bad.length)throw Error('G6_M03_ORACLE_FAILED_'+phase+':'+bad.join(','));
 return {phase,order_status:s.order?.status,local_lines:s.lines.filter(l=>l.fulfillment_source==='LOCAL_STOCK').length,
  import_lines:s.lines.filter(l=>l.fulfillment_source==='IMPORT').length,parcels:s.parcels.length};
}
async function assertMixedPhase(db,orderId,phase){return assertPhase(await readSnapshot(db,orderId),phase)}
module.exports={readSnapshot,evaluate,assertPhase,assertMixedPhase};
