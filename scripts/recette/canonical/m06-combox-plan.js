/** @komerce-arch-lite
 * @role g6-m06-direct-combox-plan
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Validate the exact received M06 package and quantity before direct COMBOX composition.
 * @impact-areas staging-only
 */
'use strict';
const text=value=>typeof value==='string'?value.trim():'';
function fail(code){throw Error(code);}
function buildM06ComboxPlan(state,proofRef){
 if(!state||typeof state!=='object')fail('G6_M06_COMBOX_STATE_REQUIRED');
 const proof=text(proofRef);
 if(proof.length<6||proof.length>500)fail('G6_M06_COMBOX_PROOF_REQUIRED');
 if(state.scenario_id!=='M06'||state.market!=='KM'||state.simulation_scope!=='G6-BUYER'||
   state.payment_status!=='paid'||state.po_status!=='hub_received'||
   state.product_ref!=='KPR-000255'||state.procure_on_order!==true||
   state.fulfillment_source!=='IMPORT'||Number(state.order_quantity)!==3||
   Number(state.received_quantity)!==3)fail('G6_M06_COMBOX_ORDER_RECEIPT_INVALID');
 if(Number(state.payment_authorization_count)!==1||Number(state.external_payment_rows)!==0||
   Number(state.settlement_rows)!==0||Number(state.local_stock_allocations_count)!==0)
  fail('G6_M06_COMBOX_FINANCE_OR_LOCAL_STOCK_INVALID');
 if(!state.receipt_unit_id||!/^SUPPLIER_PACKAGE-[a-f0-9-]{36}$/i.test(String(state.receipt_reference||''))||
   state.receipt_state!=='RECEIVED'||!state.allocation_id||
   Number(state.allocation_quantity)!==3||Number(state.placement_quantity)!==3||
   state.placement_operation!=='RECEIVE'||state.receipt_evidence_method!=='MANUAL'||
   text(state.receipt_evidence_ref).length<6)
  fail('G6_M06_COMBOX_PHYSICAL_RECEIPT_INVALID');
 if(Number(state.box_count)!==0||Number(state.direct_combox_placement_count)!==0)
  fail('G6_M06_COMBOX_ALREADY_STARTED');
 return Object.freeze({order_id:state.order_id,po_id:state.po_id,line_id:state.line_id,
  receipt_unit_id:state.receipt_unit_id,receipt_reference:state.receipt_reference,
  allocation_id:state.allocation_id,quantity:3,receipt_proof_ref:state.receipt_evidence_ref,proof_ref:proof,
  source:'OPERATOR_SUPPLIED_DIRECT_COMBOX_PROOF'});
}
module.exports={buildM06ComboxPlan};
