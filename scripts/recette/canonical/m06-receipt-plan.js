/** @komerce-arch-lite
 * @role g6-m06-physical-receipt-plan
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Validate the M06 physical-receipt preconditions from persisted Hub purchase facts without inventing a quantity or proof.
 * @impact-areas staging-only
 */
'use strict';

const text=value=>typeof value==='string'?value.trim():'';
const fail=code=>{throw Error(code)};
const money4=value=>Number(Number(value).toFixed(4));

function buildM06ReceiptPlan(state,proofRef){
 if(!state||typeof state!=='object')fail('G6_M06_RECEIPT_STATE_REQUIRED');
 const proof=text(proofRef);
 if(proof.length<6||proof.length>500)fail('G6_M06_RECEIPT_PROOF_REQUIRED');
 if(state.scenario_id!=='M06'||state.market!=='KM'||state.simulation_scope!=='G6-BUYER'||
   state.payment_status!=='paid'||state.po_status!=='confirmed'||state.trigger_mode!=='manual')
  fail('G6_M06_RECEIPT_ORDER_SCOPE_INVALID');
 if(state.product_ref!=='KPR-000255'||state.procure_on_order!==true||
   state.fulfillment_source!=='IMPORT'||Number(state.order_quantity)!==3||
   Number(state.confirmed_quantity)!==3||!state.product_sku_id)
  fail('G6_M06_RECEIPT_ON_ORDER_LINE_INVALID');
 const executions=Array.isArray(state.executions)?state.executions:[];
 if(executions.length<2)fail('G6_M06_RECEIPT_MANUAL_PURCHASE_MISSING');
 const sellers=new Set();let executedQuantity=0,executedTotal=0;
 for(const e of executions){
  const seller=text(e.seller_label),executionProof=text(e.proof_ref),currency=text(e.currency).toUpperCase();
  const quantity=Number(e.quantity),amount=Number(e.amount);
  if(seller.length<2||executionProof.length<4||currency!=='EUR'||
    !Number.isSafeInteger(quantity)||quantity<1||!Number.isFinite(amount)||amount<=0)
   fail('G6_M06_RECEIPT_MANUAL_EXECUTION_INVALID');
  sellers.add(seller.toLocaleLowerCase());executedQuantity+=quantity;executedTotal+=amount;
 }
 if(sellers.size<2)fail('G6_M06_RECEIPT_DISTINCT_SELLERS_REQUIRED');
 if(executedQuantity!==3)fail('G6_M06_RECEIPT_PURCHASE_QUANTITY_INVALID');
 executedTotal=money4(executedTotal);
 if(Number(state.commitment_count)!==1||Number(state.payment_authorization_count)!==1||
   Number(state.external_payment_rows)!==0||Number(state.settlement_rows)!==0)
  fail('G6_M06_RECEIPT_AUTHORITY_STATE_INVALID');
 const commitment=Number(state.commitment_amount),payment=Number(state.payment_authorization_amount);
 const currency=text(state.commitment_currency).toUpperCase();
 if(!Number.isFinite(commitment)||commitment<=0||!Number.isFinite(payment)||
   currency!=='EUR'||text(state.payment_authorization_currency).toUpperCase()!==currency||
   executedTotal>commitment+0.0001||Math.abs(payment-executedTotal)>0.0001)
  fail('G6_M06_RECEIPT_PURCHASE_AUTHORIZATION_RECONCILIATION_INVALID');
 if(Number(state.received_quantity)!==0||Number(state.purchase_allocations_count)!==0||
   Number(state.receive_placements_count)!==0)
  fail('G6_M06_RECEIPT_ALREADY_RECEIVED');
 return Object.freeze({purchase_order_id:state.po_id,order_id:state.order_id,
  product_sku_id:state.product_sku_id,quantity:3,currency,confirmed_total:executedTotal,
  execution_count:executions.length,distinct_sellers:sellers.size,proof_ref:proof,
  source:'OPERATOR_SUPPLIED_PHYSICAL_RECEIPT'});
}

module.exports={buildM06ReceiptPlan};
