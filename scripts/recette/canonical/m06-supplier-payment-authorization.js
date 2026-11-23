/** @komerce-arch-lite
 * @role g6-m06-supplier-payment-authorization-input
 * @domain purchasing
 * @layer script
 * @owner backend-core
 * @purpose Derive the separate internal supplier-payment authorization only from persisted M06 purchase facts.
 * @impact-areas staging-only
 */
'use strict';

const text=value=>typeof value==='string'?value.trim():'';
const fail=code=>{throw Error(code)};
const money4=value=>Number(Number(value).toFixed(4));

function deriveM06SupplierPaymentAuthorization(state,proofRef){
 if(!state||typeof state!=='object')fail('G6_M06_PAYMENT_AUTH_STATE_REQUIRED');
 const proof=text(proofRef);
 if(proof.length<4||proof.length>240)fail('G6_M06_PAYMENT_AUTH_PROOF_REQUIRED');
 if(state.scenario_id!=='M06'||state.market!=='KM'||state.simulation_scope!=='G6-BUYER'||
    state.payment_status!=='paid'||state.po_status!=='confirmed'||state.trigger_mode!=='manual')
  fail('G6_M06_PAYMENT_AUTH_ORDER_SCOPE_INVALID');
 if(state.product_ref!=='KPR-000255'||state.procure_on_order!==true||
    state.fulfillment_source!=='IMPORT'||Number(state.order_quantity)!==3||
    Number(state.confirmed_quantity)!==3)fail('G6_M06_PAYMENT_AUTH_ON_ORDER_LINE_INVALID');
 if(Number(state.commitment_count)!==1||Number(state.payment_authorization_count)!==0||
    Number(state.external_payment_rows)!==0)fail('G6_M06_PAYMENT_AUTHORITY_STATE_INVALID');
 const executions=Array.isArray(state.executions)?state.executions:[];
 if(executions.length<2)fail('G6_M06_PAYMENT_AUTH_MULTI_SELLER_PURCHASE_REQUIRED');
 const sellers=new Set();let quantity=0,total=0;let currency=null;
 for(const e of executions){
  const seller=text(e.seller_label),proofRef=text(e.proof_ref),cur=text(e.currency).toUpperCase();
  const qty=Number(e.quantity),amount=Number(e.amount);
  if(seller.length<2||!proofRef||!Number.isSafeInteger(qty)||qty<1||
     !Number.isFinite(amount)||amount<=0||cur!=='EUR')fail('G6_M06_PAYMENT_AUTH_EXECUTION_INVALID');
  sellers.add(seller.toLocaleLowerCase());quantity+=qty;total+=amount;currency=cur;
 }
 if(sellers.size<2)fail('G6_M06_PAYMENT_AUTH_DISTINCT_SELLERS_REQUIRED');
 if(quantity!==3)fail('G6_M06_PAYMENT_AUTH_EXECUTION_QUANTITY_INVALID');
 total=money4(total);
 const confirmed=money4(Number(state.confirmed_unit_price)*Number(state.confirmed_quantity));
 if(!(total>0)||Math.abs(total-confirmed)>0.0001)fail('G6_M06_PAYMENT_AUTH_PURCHASE_TOTAL_MISMATCH');
 const commitment=Number(state.commitment_amount);
 if(!Number.isFinite(commitment)||commitment<=0||
    text(state.commitment_currency).toUpperCase()!==currency||total>commitment+0.0001)
  fail('G6_M06_PAYMENT_AUTH_EXCEEDS_COMMITMENT');
 return Object.freeze({amount:total,currency,proof_ref:proof,execution_count:executions.length,
  distinct_sellers:sellers.size,quantity,source:'PERSISTED_MANUAL_PURCHASE_TOTAL'});
}

module.exports={deriveM06SupplierPaymentAuthorization};
