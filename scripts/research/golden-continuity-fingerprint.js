'use strict';

/**
 * EXPERIMENTAL / read-only: reconcile facts already projected by the Golden owners.
 * Nothing here grants business authority, creates test data or certifies E2E.
 * Inputs: projectUpstreamEvidence() and projectGoldenEvidence() results, same order.
 */
const crypto=require('node:crypto');
const UPSTREAM=['SOURCE_PROVED','REFINERY_PROVED','CATALOG_RELEASE_PROVED','STOREFRONT_PROVED'];
const FULFILLMENT=['CLIENT_PAYMENT','PURCHASING','HUB_INBOUND','CUSTOMER_HANDOFF','FINANCIAL_CLOSE'];
const clean=v=>v==null||String(v).trim()===''?null:String(v).trim();
const upper=v=>clean(v)?.toUpperCase()||null;
const same=(a,b)=>a!==null&&b!==null&&a===b;
function makeCheckpoint(key,contradictions,gaps,links){
 const status=contradictions.length?'CONTRADICTION_HYPOTHESIS':gaps.length?'EVIDENCE_GAP':'CONSISTENT_WITH_AVAILABLE_PROOFS';
 return {key,status,contradictions,gaps,links};
}
function projectContinuity(upstream,downstream=null){
 if(!upstream||typeof upstream!=='object'||!Array.isArray(upstream.gates))throw Error('Canonical upstream gate projection required');
 if(downstream&&!Array.isArray(downstream.steps))throw Error('Golden order steps must come from canonical projection');
 const gate=k=>upstream.gates.find(x=>x.key===k);
 const step=k=>downstream?.steps?.find(x=>x.key===k);
 const ids=upstream.ids||{},thread=upstream.thread||{};
 const expectedMarket=upper(ids.market_code),checkoutMarket=upper(gate('CHECKOUT_ORIGIN_PROVED')?.evidence?.market_code);
 const selectedMarket=upper(thread.market);
 const purchaseMarket=upper(downstream?.order?.market_code);
 const expectedReference=clean(ids.order_reference),threadReference=clean(thread.order_reference);
 const orderReference=clean(downstream?.order?.reference);
 const expectedProduct=clean(ids.product_id),threadProduct=clean(thread.product_id);
 const productConflicts=[],productGaps=[];
 if(expectedProduct&&threadProduct&&!same(expectedProduct,threadProduct))productConflicts.push('PRODUCT_THREAD_MISMATCH');
 if(!expectedProduct||!threadProduct)productGaps.push('PRODUCT_THREAD_NOT_LINKED');
 for(const k of UPSTREAM){
  if(gate(k)?.status!=='PROVED')productGaps.push(k+':'+(gate(k)?.status||'MISSING'));
 }
 const checkoutConflicts=[],checkoutGaps=[];
 if(expectedMarket&&checkoutMarket&&expectedMarket!==checkoutMarket)checkoutConflicts.push('CHECKOUT_ORDER_MARKET_MISMATCH');
 if(expectedMarket&&selectedMarket&&expectedMarket!==selectedMarket)checkoutConflicts.push('SELECTED_THREAD_MARKET_MISMATCH');
 if(!checkoutMarket)checkoutGaps.push('CANONICAL_CHECKOUT_MARKET_UNAVAILABLE');
 if(!expectedMarket)checkoutGaps.push('TARGET_MARKET_UNAVAILABLE');
 if(expectedReference&&threadReference&&expectedReference!==threadReference)checkoutConflicts.push('ORDER_REFERENCE_MISMATCH');
 if(downstream&&expectedReference&&orderReference&&expectedReference!==orderReference)checkoutConflicts.push('ORDER_PROJECTION_REFERENCE_MISMATCH');
 if(downstream&&expectedMarket&&purchaseMarket&&expectedMarket!==purchaseMarket)checkoutConflicts.push('ORDER_PROJECTION_MARKET_MISMATCH');
 if(!expectedReference||!threadReference)checkoutGaps.push('SINGLE_ORDER_THREAD_NOT_PROVED');
 if(downstream&&!orderReference)checkoutGaps.push('ORDER_PROJECTION_REFERENCE_UNAVAILABLE');
 if(gate('CHECKOUT_ORIGIN_PROVED')?.status!=='PROVED')checkoutGaps.push('CHECKOUT_ORIGIN_NOT_PROVED');
 const fulfillmentConflicts=[],fulfillmentGaps=[];
 if(!downstream)fulfillmentGaps.push('GOLDEN_ORDER_PROJECTION_NOT_SUPPLIED');
 const paymentGate=gate('PAYMENT_FINAL_PROVED');
 const paymentStep=step('CLIENT_PAYMENT');
 if(paymentGate?.status==='ANOMALIE'&&paymentStep?.passed===true)fulfillmentConflicts.push('PAYMENT_AUTHORITY_ANOMALY_VS_ORDER_PAYMENT_PASS');
 if(paymentGate?.status!=='PROVED')fulfillmentGaps.push('CANONICAL_PAYMENT_NOT_PROVED');
 if(paymentStep?.passed!==true)fulfillmentGaps.push('ORDER_PAYMENT_NOT_PROVED');
 for(const k of FULFILLMENT.slice(1))if(step(k)?.passed!==true)fulfillmentGaps.push(k+'_NOT_PROVED');
 const checkpoints=[
  makeCheckpoint('P1_SOURCE_TO_CATALOGUE',productConflicts,productGaps,
   {product_id:expectedProduct,thread_product_id:threadProduct}),
  makeCheckpoint('P2_BOUTIQUE_TO_ORDER',checkoutConflicts,checkoutGaps,
   {target_market:expectedMarket,order_market:checkoutMarket,downstream_market:purchaseMarket,
    target_order_reference:expectedReference,thread_order_reference:threadReference,downstream_order_reference:orderReference,
    trace_id:clean(thread.trace_id)}),
  makeCheckpoint('P3_TO_P6_PAYMENT_TO_FINANCE',fulfillmentConflicts,fulfillmentGaps,
   {payment_authority_status:paymentGate?.status||null,order_payment_passed:paymentStep?.passed===true,
    purchasing:step('PURCHASING')?.passed===true,hub_inbound:step('HUB_INBOUND')?.passed===true,
    handoff:step('CUSTOMER_HANDOFF')?.passed===true,finance:step('FINANCIAL_CLOSE')?.passed===true}),
 ];
 const observed=checkpoints.map(({key,status,contradictions,gaps,links})=>({key,status,contradictions,gaps,links}));
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify(observed)).digest('hex');
 return {
  schema:'komerce-golden-continuity/v1',status:'RESEARCH_ONLY_NOT_CERTIFICATION',
  doctrine:'consume_canonical_projection_read_only_no_parallel_business_engine',
  evidence_level:'PROJECTION_ONLY',fingerprint,
  provenance:{upstream:'services/golden-upstream-evidence.js',checkout:'services/golden-checkout-thread.js',
    downstream:'services/golden-e2e-cockpit.js',recorded_run:null,approved_oracle:false},
  checkpoints,
  totals:{contradiction_hypotheses:checkpoints.filter(x=>x.status==='CONTRADICTION_HYPOTHESIS').length,
    evidence_gaps:checkpoints.filter(x=>x.status==='EVIDENCE_GAP').length},
  no_go_granted:true,
 };
}
module.exports={projectContinuity};
