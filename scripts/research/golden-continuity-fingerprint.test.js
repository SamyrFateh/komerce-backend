'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {projectContinuity}=require('./golden-continuity-fingerprint');

const base=()=>{
 const gates=['SOURCE_PROVED','REFINERY_PROVED','CATALOG_RELEASE_PROVED','STOREFRONT_PROVED',
              'CHECKOUT_ORIGIN_PROVED','PAYMENT_FINAL_PROVED']
  .map(key=>({key,status:'PROVED',evidence:key==='CHECKOUT_ORIGIN_PROVED'?{market_code:'KM'}:{}}));
 return {
  ids:{product_id:'p1',market_code:'KM',order_reference:'O-1'},thread:{product_id:'p1',market:'KM',order_reference:'O-1',trace_id:'GT-1'},
  gates,certification:'NON CERTIFIÉE',stage:'PRÊT POUR RECETTE',
 };
};
const fulfillment=()=>({
 order:{id:'order1',reference:'O-1',market_code:'KM',payment_status:'paid'},
 steps:['CLIENT_ORDER','CLIENT_PAYMENT','PURCHASING','SUPPLIER_EXECUTION','FULFILLMENT','HUB_INBOUND','CUSTOMS','RELAY_AVAILABLE','CUSTOMER_HANDOFF','FINANCIAL_CLOSE']
  .map(key=>({key,passed:true})),
 verdict:'FINANCIAL_CLOSE_MATCHED',
});
const gate=(r,k)=>r.gates.find(x=>x.key===k);
const cp=(r,k)=>r.checkpoints.find(x=>x.key===k);

test('consistent evidence threads remain research-only (never GO)',()=>{
 const x=projectContinuity(base(),fulfillment());
 assert.equal(x.totals.contradiction_hypotheses,0);
 assert.equal(x.totals.evidence_gaps,0);
 assert.equal(x.no_go_granted,true);
 assert.equal(x.status,'RESEARCH_ONLY_NOT_CERTIFICATION');
});
test('market chosen in Golden differs from canonical order market — conflict',()=>{
 const u=base(),d=fulfillment();
 gate(u,'CHECKOUT_ORIGIN_PROVED').evidence.market_code='CM';
 d.order.market_code='CM';
 const x=projectContinuity(u,d);
 assert.equal(cp(x,'P2_BOUTIQUE_TO_ORDER').status,'CONTRADICTION_HYPOTHESIS');
 assert.deepEqual(cp(x,'P2_BOUTIQUE_TO_ORDER').contradictions,
  ['CHECKOUT_ORDER_MARKET_MISMATCH','ORDER_PROJECTION_MARKET_MISMATCH']);
});
test('nominal payment and missing actual Hub proof are gaps, not bugs',()=>{
 const u=base(),d=fulfillment();
 d.steps.find(x=>x.key==='HUB_INBOUND').passed=false;
 gate(u,'PAYMENT_FINAL_PROVED').status='NON_PROUVE';
 const r=projectContinuity(u,d);
 assert.equal(cp(r,'P3_TO_P6_PAYMENT_TO_FINANCE').status,'EVIDENCE_GAP');
 assert.equal(r.totals.contradiction_hypotheses,0);
});
test('payment anomaly contradicted by claimed paid order creates candidate',()=>{
 const u=base();gate(u,'PAYMENT_FINAL_PROVED').status='ANOMALIE';
 const r=projectContinuity(u,fulfillment());
 assert.ok(cp(r,'P3_TO_P6_PAYMENT_TO_FINANCE').contradictions.includes('PAYMENT_AUTHORITY_ANOMALY_VS_ORDER_PAYMENT_PASS'));
});
test('same canonical projection with changed timestamps yields identical digest',()=>{
 const u=base(),d=fulfillment();
 const a=projectContinuity({...u,observed_at:'2026-01-01'},d);
 const b=projectContinuity({...u,observed_at:'2026-10-26'},{...d,observed_at:'now'});
 assert.equal(a.fingerprint,b.fingerprint);
});
test('an absent chain cannot become certified',()=>{
 const u=base();u.thread=null;u.gates=[];
 const r=projectContinuity(u);
 assert.equal(r.totals.contradiction_hypotheses,0);
 assert.equal(r.totals.evidence_gaps,3);
 assert.equal(r.no_go_granted,true);
});
