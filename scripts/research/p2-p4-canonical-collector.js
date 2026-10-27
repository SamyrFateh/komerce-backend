'use strict';
/**
 * R&D read-only purchasing -> physical-Hub seam.
 *
 * - exact order-item grain, NEVER infer grouped PO's order_id from header;
 * - a single specific purchase line is required for line-grain comparison;
 * - actual usable physical qty comes from v_purchase_line_progress (P4 owner);
 * - arrival verdict comes from reconcileHubInbound (P4 owner), not a homegrown
 *   "received_qty" counter or supplier tracking reference.
 * - no missing/ambiguous evidence is ever certified.
 */
const {reconcileHubInbound}=require('../../services/hub-inbound-reconciliation');
const {record,statusOfGate}=require('./p1-p7-canonical-collector');
const {evaluateBoundary,MAP}=require('./p1-p7-boundary-oracle');
const seam=id=>MAP.find(x=>x.id===id);
const integer=x=>Number.isSafeInteger(Number(x))&&Number(x)>=0?Number(x):null;
function assessP2P4({item,lines=[],progress=[],allocations=[],fulfillmentIds=[],inbound=null,paymentGate=null}={}) {
 if(!item?.order_item_id||!item?.sku_id)throw Error('Exact persisted customer order item required');
 const evidenceGaps=[];
 const line=lines.length===1?lines[0]:null;
 if(lines.length!==1)evidenceGaps.push(lines.length?'PURCHASE_LINES_AMBIGUOUS_FOR_LINE_GRAIN':'PURCHASE_LINE_MISSING');
 const physical=progress.length===1?progress[0]:null;
 if(line&&progress.length!==1)evidenceGaps.push('PURCHASE_PROGRESS_NOT_UNIQUE');
 const allocation=allocations.length===1?allocations[0]:null;
 if(line&&allocations.length>1)evidenceGaps.push('MULTIPLE_HUB_ALLOCATIONS_NEED_AGGREGATE_LINE_PROOF');
 const inboundStatus=String(inbound?.verdict||'');
 const receiptProved=Boolean(line&&physical&&allocation&&
   physical.cancelled===false &&
   integer(physical.received_quantity)!==null&&integer(physical.effective_quantity)!==null&&
   Number(physical.effective_quantity)>0 &&
   Number(physical.received_quantity)===Number(physical.effective_quantity)&&
   inboundStatus==='INBOUND_MATCHED'&&
   (inbound.purchase_line_ids||[]).some(id=>String(id)===String(line.id)));
 const p2status=statusOfGate(paymentGate);
 const p3status=!line?'UNKNOWN':line.cancelled_at?'BLOCKED':
   line.purchase_order_id&&line.po_status==='confirmed'?'PROVED':'UNKNOWN';
 const p4status=inboundStatus==='MISMATCH'?'BLOCKED':receiptProved?'PROVED':'UNKNOWN';
 const p2p3=record('P2_P3_PURCHASE_REQUIREMENT',p2status,p3status,
  {order_item_id:item.order_item_id,sku_id:item.sku_id},
  {order_item_id:line?.order_item_id||null,sku_id:line?.product_sku_id||null},{
   order_id:item.order_id,source_payment_gate:paymentGate?.status||'MISSING',
   po_shape:line?.po_order_id==null&&line?'grouped':'historical',
   po_status:line?.po_status||null});
 const p3p4=record('P3_P4_HUB_RECEIPT',p3status,p4status,
  {purchase_line_id:line?.id||null,sku_id:line?.product_sku_id||null},
  {purchase_line_id:allocation?.purchase_line_id||(
   allocation?.purchase_line_id==null&&allocation?.purchase_order_id===line?.purchase_order_id
    &&allocation?.order_item_id===line?.order_item_id?line?.id:null),
   sku_id:allocation?.product_sku_id||null},
  {order_item_id:item.order_item_id,po_id:line?.purchase_order_id||null,
   po_shape:line?.po_order_id==null&&line?'grouped':'historical',
   effective_qty:physical?.effective_quantity??null,
   usable_received_qty:physical?.received_quantity??null,
   inbound_verdict:inboundStatus||'NOT_RUN',inbound_reason:inbound?.reason||null,
   supplier_fulfillment_candidates:fulfillmentIds.length,allocation_candidates:allocations.length});
 const contradictions=[];
 if(line && line.po_order_id!=null&&String(line.po_order_id)!==String(item.order_id))
  contradictions.push('PURCHASE_PO_FOREIGN_ORDER');
 if(line && line.po_supplier_id && line.supplier_id &&
    String(line.po_supplier_id)!==String(line.supplier_id))
  contradictions.push('PURCHASE_PO_FOREIGN_SUPPLIER');
 if(allocation && String(allocation.order_id)!==String(item.order_id))
  contradictions.push('HUB_ALLOCATION_FOREIGN_ORDER');
 if(allocation && String(allocation.order_item_id)!==String(item.order_item_id))
  contradictions.push('HUB_ALLOCATION_FOREIGN_ITEM');
 if(allocation && line && String(allocation.purchase_order_id)!==String(line.purchase_order_id))
  contradictions.push('HUB_ALLOCATION_FOREIGN_PO');
 if(inboundStatus==='INBOUND_MATCHED'&&physical&&
    (integer(physical.received_quantity)===null||integer(physical.effective_quantity)===null||
      Number(physical.effective_quantity)===0||
      Number(physical.received_quantity)!==Number(physical.effective_quantity)))
  contradictions.push('INBOUND_MATCHED_WITHOUT_FULL_USABLE_PHYSICAL_QUANTITY');
 if(fulfillmentIds.length>1)evidenceGaps.push('MULTIPLE_SUPPLIER_FULFILLMENTS_NOT_AGGREGATED');
 if(fulfillmentIds.length===0)evidenceGaps.push('NO_SUPPLIER_FULFILLMENT_LINK');
 if(line?.cancelled_at)evidenceGaps.push('PURCHASE_LINE_CANCELLED');
 const result={
  proofs:{P2_P3_PURCHASE_REQUIREMENT:p2p3,P3_P4_HUB_RECEIPT:p3p4},
  diagnostics:{contradictions:[...new Set(contradictions)],gaps:[...new Set(evidenceGaps)],
   owner_inbound_verdict:inboundStatus||'NOT_RUN',has_line:!!line,
   source_payment_status:p2status},
 };
 // Owner-to-owner contradictions are additional hypotheses, not "PASS" for
 // identity-only fields of the generic oracle.
 return result;
}
async function collectP2P4Canonical(db,{item,upstream,readers={}}={}) {
 if(!db||typeof db.query!=='function'||!item?.order_item_id)throw Error('Exact order item and DB required');
 const sql=(q,v)=>db.query(q,v).then(r=>r.rows);
 const lines=await sql(
  'SELECT pl.id,pl.order_item_id,pl.product_sku_id,pl.purchase_order_id,pl.cancelled_at,'+
  ' pl.supplier_id,po.order_id AS po_order_id,po.status AS po_status,'+
  ' po.supplier_id AS po_supplier_id FROM purchase_lines pl '+
  'LEFT JOIN purchase_orders po ON po.id=pl.purchase_order_id WHERE pl.order_item_id=$1 '+
  'ORDER BY pl.created_at,pl.id LIMIT 3',[item.order_item_id]);
 const line=lines.length===1?lines[0]:null;
 let progress=[],allocations=[],fulfillmentIds=[],inbound=null;
 if(line){
  progress=await sql('SELECT line_id,order_item_id,purchase_order_id,po_shape,effective_quantity,'+
    ' received_quantity,cancelled FROM v_purchase_line_progress WHERE line_id=$1',[line.id]);
  allocations=await sql('SELECT id,order_id,order_item_id,purchase_line_id,purchase_order_id,'+
   ' product_sku_id FROM hub_purchase_allocations WHERE purchase_line_id=$1 OR '+
   '(purchase_line_id IS NULL AND purchase_order_id=$2 AND order_item_id=$3)'+
   ' ORDER BY id LIMIT 3',[line.id,line.purchase_order_id,line.order_item_id]);
  const found=await sql('SELECT DISTINCT sf.id FROM supplier_execution_fulfillments sf '+
   'JOIN supplier_execution_order_lines seol ON seol.supplier_execution_order_id=sf.supplier_execution_order_id '+
   'WHERE seol.purchase_line_id=$1 ORDER BY sf.id LIMIT 3',[line.id]);
  fulfillmentIds=found.map(x=>x.id);
  if(fulfillmentIds.length===1){
   const reconcile=readers.reconcileInbound||reconcileHubInbound;
   inbound=await reconcile(db,{supplierFulfillmentId:fulfillmentIds[0]});
  }
 }
 const paymentGate=upstream?.gates?.find(g=>g.key==='PAYMENT_FINAL_PROVED')||null;
 const assessed=assessP2P4({item,lines,progress,allocations,fulfillmentIds,inbound,paymentGate});
 return {...assessed,owner_provenance:{
  order:'orders/order_items by exact order_item_id',
  purchase:'purchase_lines/purchase_orders at purchase_line grain',
  quantity:'v_purchase_line_progress usable physical stock',
  hub:'services/hub-inbound-reconciliation.reconcileHubInbound',
  externalSupplierVerified:false,
 },facts:{line_count:lines.length,allocation_count:allocations.length,
  fulfillment_count:fulfillmentIds.length,
  order_item_id:item.order_item_id,purchase_line_id:line?.id||null,
  po_shape:line?.po_order_id==null&&line?'grouped':'historical',
  inbound_verdict:inbound?.verdict||null,
  effective_quantity:progress[0]?.effective_quantity??null,
  received_quantity:progress[0]?.received_quantity??null}};
}
module.exports={assessP2P4,collectP2P4Canonical};
