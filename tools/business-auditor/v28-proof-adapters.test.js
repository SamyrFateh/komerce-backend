'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {frozenSelection,inspectCase,rejectFakeFix,REGISTRY}=require('./v28-proof-adapters');
function financial(mode){
 return {mode,capture:{eur:20,kmf:10000},simulation:'PAYPAL_FETCH_STRICT_NO_EXTERNAL_NETWORK',
  authMiddlewareExecuted:false,localCloneVerified:true,
  outcomes:{paypal:{http:mode==='BA'?200:200}},
  state:{refunds:mode==='BA'?[{refund_method:'paypal',status:'completed',
    stripe_refund_id:'pp1',amount_eur:20}]:[],
   pspEvents:[{id:'pp1',amountEur:20}],walletCreditKmf:mode==='BA'?0:10000}};
}
function logistics(mode){
 const nominal=mode==='NOMINAL';
 return {mode,realOwnerCalled:true,realCanonicalSchema:true,noProductionTouch:true,
  authMiddlewareExecuted:false,sessionCount:2,ownerInsertCalls:1,
  actualIndexes:[{name:'unique_order_item_per_parcel',
   definition:'CREATE UNIQUE INDEX unique_order_item_per_parcel ON parcel_items (order_item_id)'}],
  fixture:{itemCount:1},ownerInserted:nominal?1:0,physicalRows:[nominal?1:0],
  before:{activeCount:0},after:{activeCount:nominal?1:0,openCount:nominal?1:0},
  response:{success:true,items_assigned:1}};
}
test('selection freezes ordered cross-domain interleaving under fixed budget',()=>{
 assert.deepEqual(frozenSelection({maxCases:4}).selected.map(c=>c.id),[
  'FIN-REFUND-BA','LOG-PARCEL-NOMINAL','FIN-REFUND-AB','LOG-PARCEL-CANCELLED']);
 assert.equal(frozenSelection({maxCases:2}).selected.length,2);
 assert.equal(frozenSelection({maxCases:4,domains:['logistics']}).selected.length,2);
 const a=frozenSelection({maxCases:4}),b=frozenSelection({maxCases:4});
 assert.equal(a.hash,b.hash);
 assert.equal(a.selectionKind,'FROZEN_CALIBRATION_REGISTRY_NOT_GENERAL_AUTO_DISCOVERY');
});
test('reject unsupported or unlimited experiment selection',()=>{
 for(const q of [{maxCases:5},{maxCases:0},{maxCases:1.5},
   {domains:['inventory']},{domains:['finance','finance']}])
  assert.throws(()=>frozenSelection(q),/V28_TOOL_ERROR/);
});
test('physical financial nominal BA and economically bad AB are distinguished',()=>{
 const yes=inspectCase(REGISTRY[0],financial('BA'));
 assert.equal(yes.result,'PASS_WITH_EVIDENCE');
 assert.equal(yes.quantified.economicOutflowCents,2000);
 const bug=inspectCase(REGISTRY[2],financial('AB'));
 assert.equal(bug.result,'BUSINESS_VIOLATION');
 assert.ok(bug.signals.includes('I1_ECONOMIC_REFUNDS_EXCEED_CAPTURE'));
});
test('independent financial oracle catches forged additional PSP refund',()=>{
 const mutated=rejectFakeFix(REGISTRY[0],financial('BA'));
 assert.ok(mutated.signals.includes('I1_ECONOMIC_REFUNDS_EXCEED_CAPTURE'));
 assert.ok(mutated.signals.includes('I2_PSP_REFUND_MISSING_FROM_LEDGER'));
});
test('real parcel nominal and cancelled membership have opposite verdicts',()=>{
 assert.equal(inspectCase(REGISTRY[1],logistics('NOMINAL')).result,'PASS_WITH_EVIDENCE');
 const bad=inspectCase(REGISTRY[3],logistics('CANCELLED_MEMBERSHIP'));
 assert.equal(bad.result,'BUSINESS_VIOLATION');
 assert.ok(bad.signals.includes('L3_ORDER_NOT_IN_EXACTLY_ONE_ACTIVE_PARCEL'));
});
test('counterfeit count fix does not conceal missing active parcel',()=>{
 const r=rejectFakeFix(REGISTRY[3],logistics('CANCELLED_MEMBERSHIP'));
 assert.ok(r.signals.includes('L3_ORDER_NOT_IN_EXACTLY_ONE_ACTIVE_PARCEL'));
 assert.ok(r.signals.includes('L2_SUCCESS_WITHOUT_WRITE_OR_IDEMPOTENT_CLASSIFICATION'));
});
test('oracle fails closed on missing actual owner or canonical schema proof',()=>{
 const x=logistics('NOMINAL');x.realOwnerCalled=false;
 assert.throws(()=>inspectCase(REGISTRY[1],x),/V27_ORACLE_TOOL_ERROR|V28_TOOL_ERROR/);
});
test('financial test cannot claim live authentication',()=>{
 const x=financial('BA');x.authMiddlewareExecuted=true;
 assert.throws(()=>inspectCase(REGISTRY[0],x),/V28_TOOL_ERROR/);
});
