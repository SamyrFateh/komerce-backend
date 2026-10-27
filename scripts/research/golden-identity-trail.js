'use strict';
/**
 * R&D Golden — read-only chain of custody/identities from canonical PostgreSQL.
 * Discover via IDs, never by price/reference label, and never manufacture facts.
 * SQL owner stays in Komerce; this checks cross-feature identity consistency.
 * Output is a HYPOTHESIS, NOT a certification or an automatic business gate.
 */
const crypto=require('node:crypto');
const str=x=>x===null||x===undefined?null:String(x);
const uniq=a=>[...new Set(a.filter(Boolean))];
function analyzeGoldenTrail({order,items=[],purchaseLines=[],executionLines=[],supplierPayments=[],
  fulfillments=[],allocations=[],placements=[],parcels=[],scans=[]}) {
 if(!order?.id) throw Error('Canonical order ID required');
 const issues=[],gaps=[];
 const issue=(code,stage,refs)=>issues.push({code,stage,refs});
 const gap=(code,stage)=>gaps.push({code,stage});
 const itemById=new Map(items.map(x=>[str(x.id),x]));
 const lineById=new Map(purchaseLines.map(x=>[str(x.id),x]));
 const allocationById=new Map(allocations.map(x=>[str(x.id),x]));
 const parcelById=new Map(parcels.map(x=>[str(x.parcel_id),x]));
 if(!items.length)gap('NO_ORDER_ITEMS','ORDER');
 for(const item of items) {
  if(str(item.order_id)!==str(order.id))issue('ORDER_ITEM_OWNER_MISMATCH','ORDER',{order_item_id:item.id});
  if(!item.sku_id)gap('SOLD_SKU_UNAVAILABLE','ORDER');
 }
 for(const line of purchaseLines) {
  const item=itemById.get(str(line.order_item_id));
  if(!item){issue('PURCHASE_LINE_FOREIGN_ORDER_ITEM','PURCHASING',{purchase_line_id:line.id});continue;}
  if(str(line.product_sku_id)!==str(item.sku_id))
   issue('PURCHASE_SKU_SUBSTITUTION','PURCHASING',{order_item_id:item.id,purchase_line_id:line.id});
  if(line.po_order_id && str(line.po_order_id)!==str(order.id))
   issue('PURCHASE_ORDER_OWNER_MISMATCH','PURCHASING',{purchase_line_id:line.id});
  if(line.po_supplier_id && str(line.po_supplier_id)!==str(line.supplier_id))
   issue('PURCHASE_SUPPLIER_MISMATCH','PURCHASING',{purchase_line_id:line.id});
  if(!line.purchase_order_id)gap('PURCHASE_LINE_NOT_ATTACHED','PURCHASING');
 }
 if(!purchaseLines.length)gap('NO_PURCHASE_LINES','PURCHASING');
 for(const exec of executionLines) {
  const line=lineById.get(str(exec.purchase_line_id));
  if(!line){issue('SUPPLIER_EXECUTION_UNKNOWN_LINE','SUPPLIER',{purchase_line_id:exec.purchase_line_id});continue;}
  if(str(exec.purchase_order_id)!==str(line.purchase_order_id))
   issue('SUPPLIER_EXECUTION_PO_MISMATCH','SUPPLIER',{purchase_line_id:line.id});
 }
 if(!executionLines.length)gap('NO_SUPPLIER_EXECUTION','SUPPLIER');
 if(!supplierPayments.length)gap('NO_SUPPLIER_PAYMENT_PROOF','SUPPLIER_PAYMENT');
 if(!fulfillments.length)gap('NO_SUPPLIER_FULFILLMENT_PROOF','SUPPLIER_FULFILLMENT');
 for(const allocation of allocations) {
  const item=itemById.get(str(allocation.order_item_id));
  const line=lineById.get(str(allocation.purchase_line_id));
  if(!item || !line){issue('HUB_UNKNOWN_ORDER_OR_PURCHASE_LINE','HUB',{allocation_id:allocation.id});continue;}
  if(str(allocation.order_id)!==str(item.order_id) || str(allocation.order_id)!==str(order.id))
   issue('HUB_ALLOCATION_ORDER_OWNER_MISMATCH','HUB',{allocation_id:allocation.id});
  if(str(line.order_item_id)!==str(allocation.order_item_id))
   issue('HUB_ALLOCATION_PURCHASE_LINE_MISMATCH','HUB',{allocation_id:allocation.id});
  if(str(allocation.product_sku_id)!==str(item.sku_id)||str(allocation.product_sku_id)!==str(line.product_sku_id))
   issue('HUB_ALLOCATION_SKU_MISMATCH','HUB',{allocation_id:allocation.id});
  if(str(allocation.purchase_order_id)!==str(line.purchase_order_id))
   issue('HUB_ALLOCATION_PO_MISMATCH','HUB',{allocation_id:allocation.id});
  if(str(allocation.market_id)!==str(order.market_id))
   issue('HUB_ALLOCATION_MARKET_MISMATCH','HUB',{allocation_id:allocation.id});
  if(str(allocation.supplier_id)!==str(line.supplier_id))
   issue('HUB_ALLOCATION_SUPPLIER_MISMATCH','HUB',{allocation_id:allocation.id});
 }
 if(!allocations.length)gap('NO_HUB_ALLOCATION','HUB');
 for(const placement of placements) {
  if(!allocationById.has(str(placement.allocation_id)))
   issue('HUB_PLACEMENT_UNKNOWN_ALLOCATION','HUB',{placement_id:placement.id});
 }
 if(!placements.length)gap('NO_HUB_PHYSICAL_UNIT_PLACEMENT','HUB');
 for(const parcel of parcels) {
  const item=itemById.get(str(parcel.order_item_id));
  if(!item){issue('PARCEL_UNKNOWN_ORDER_ITEM','PARCEL',{parcel_id:parcel.parcel_id});continue;}
  if(str(parcel.product_id)!==str(item.product_id))
   issue('PARCEL_PRODUCT_IDENTITY_MISMATCH','PARCEL',{parcel_id:parcel.parcel_id,order_item_id:item.id});
  // carrier_order_id is deliberately NOT required to equal the line owner:
  // shared parcels are canonical and were proven separately.
 }
 if(!parcels.length)gap('NO_PARCEL_MEMBERSHIP','PARCEL');
 for(const scan of scans) {
  if(str(scan.order_id)!==str(order.id))
   issue('HANDOFF_FOREIGN_ORDER_SCAN','HANDOFF',{scan_id:scan.id});
  if(!parcelById.has(str(scan.parcel_id)))
   issue('HANDOFF_SCAN_NON_MEMBER_PARCEL','HANDOFF',{scan_id:scan.id});
 }
 if(!scans.length)gap('NO_CUSTOMER_HANDOFF_SCAN','HANDOFF');
 const observed={orderId:order.id,itemIds:uniq(items.map(x=>x.id)),purchaseLineIds:uniq(purchaseLines.map(x=>x.id)),
   executionLineIds:uniq(executionLines.map(x=>x.purchase_line_id)),supplierPaymentIds:uniq(supplierPayments.map(x=>x.id)),
   fulfillmentIds:uniq(fulfillments.map(x=>x.id)),hubAllocationIds:uniq(allocations.map(x=>x.id)),
   physicalUnitIds:uniq(placements.map(x=>x.physical_unit_id)),parcelIds:uniq(parcels.map(x=>x.parcel_id)),
   scanIds:uniq(scans.map(x=>x.id))};
 const digest=crypto.createHash('sha256').update(JSON.stringify({issues,gaps,observed})).digest('hex');
 return {schema:'komerce-golden-identity-trail/v1',evidenceLevel:'READ_ONLY_EXISTING_CANONICAL_FACTS',
   approvedOracle:false,certifiedE2E:false,status:issues.length?'IDENTITY_CONTRADICTION_HYPOTHESIS':
     gaps.length?'MISSING_IDENTITY_EVIDENCE':'NO_IDENTITY_CONTRADICTION_OBSERVED',
   issues,gaps,observed,digest,
   limitations:['Does not prove live external supplier, payment, transport or human handoff.',
     'Financial close verdict comes solely from its existing canonical reconciler.',
     'Matching IDs do not demonstrate that all business stages actually succeeded.']};
}
async function collectGoldenTrail(db,orderId){
 if(!db||typeof db.query!=='function'||!orderId)throw Error('Read-only SQL executor and orderId required');
 const query=(sql,args)=>db.query(sql,args).then(x=>x.rows);
 const orders=await query('SELECT id,reference,market_id FROM orders WHERE id=$1',[orderId]);
 if(orders.length!==1)throw Error('Canonical order not found or ambiguous');
 const items=await query('SELECT id,order_id,sku_id,product_id,quantity FROM order_items WHERE order_id=$1',[orderId]);
 const itemIds=items.map(x=>x.id);
 // The empty-array ANY predicate matches nothing, not the entire table.
 const purchaseLines=await query(`SELECT pl.id,pl.purchase_order_id,pl.order_item_id,pl.product_sku_id,pl.supplier_id,
     po.order_id AS po_order_id,po.supplier_id AS po_supplier_id
   FROM purchase_lines pl LEFT JOIN purchase_orders po ON po.id=pl.purchase_order_id
   WHERE pl.order_item_id=ANY($1::uuid[])`,[itemIds]);
 const lineIds=purchaseLines.map(x=>x.id);
 const executionLines=await query(`SELECT seol.purchase_line_id,seol.supplier_execution_order_id,
     seo.purchase_order_id
   FROM supplier_execution_order_lines seol
   JOIN supplier_execution_orders seo ON seo.id=seol.supplier_execution_order_id
   WHERE seol.purchase_line_id=ANY($1::uuid[])`,[lineIds]);
 const executionIds=uniq(executionLines.map(x=>x.supplier_execution_order_id));
 const supplierPayments=await query(`SELECT sep.id,sep.purchase_order_id,sep.supplier_execution_order_id
   FROM supplier_execution_payments sep
   WHERE sep.supplier_execution_order_id=ANY($1::uuid[])`,[executionIds]);
 const fulfillments=await query(`SELECT sf.id,sf.supplier_execution_order_id
   FROM supplier_execution_fulfillments sf
   WHERE sf.supplier_execution_order_id=ANY($1::uuid[])`,[executionIds]);
 const allocations=await query(`SELECT id,order_id,order_item_id,product_sku_id,purchase_line_id,purchase_order_id,supplier_id,market_id
   FROM hub_purchase_allocations
   WHERE order_item_id=ANY($1::uuid[]) OR purchase_line_id=ANY($2::uuid[])`,[itemIds,lineIds]);
 const allocationIds=allocations.map(x=>x.id);
 const placements=await query(`SELECT id,allocation_id,physical_unit_id FROM hub_physical_unit_placements
   WHERE allocation_id=ANY($1::uuid[])`,[allocationIds]);
 const parcels=await query(`SELECT pi.id,pi.order_item_id,pi.product_id,pi.parcel_id,
   p.order_id AS carrier_order_id,p.status
   FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id
   WHERE pi.order_item_id=ANY($1::uuid[])`,[itemIds]);
 const parcelIds=uniq(parcels.map(x=>x.parcel_id));
 const scans=await query(`SELECT id,order_id,parcel_id,step,pickup_method
   FROM scans WHERE order_id=$1 AND parcel_id=ANY($2::uuid[]) AND step='collected'`,[orderId,parcelIds]);
 return analyzeGoldenTrail({order:orders[0],items,purchaseLines,executionLines,supplierPayments,
   fulfillments,allocations,placements,parcels,scans});
}
module.exports={analyzeGoldenTrail,collectGoldenTrail};
