'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {plan}=require('./v36-impact-selector');
function discovery(){
 return {contract:'komerce-metadata-driven-selection/v29',
  sha:'a'.repeat(40),selectionHash:'b'.repeat(64),
  pairs:{reviewQueue:[
   {id:'pair-A',table:'orders',domain:'orders',rankScore:180,
    ownerSource:'services/order-status-machine.js',actorSources:['routes/orders/status.js']},
   {id:'pair-B',table:'order_items',domain:'orders',rankScore:120,
    ownerSource:'services/order-status-machine.js',actorSources:['services/inventory-service.js']},
   {id:'pair-C',table:'refunds',domain:'finance',rankScore:250,
    ownerSource:'services/payment-paypal.js',actorSources:['routes/orders/cancel.js']}
  ]}};
}
function census(){return {all:[
 {id:'INV-1',source:'features/orders.feature.js',domain:'orders'},
 {id:'INV-2',source:'features/sourcing.feature.js',domain:'sourcing'}
]}}
test('exact affected owner picks ranked pairs, bounded budget, never executes',()=>{
 const r=plan({paths:['services/order-status-machine.js'],discovery:discovery(),
  census:census(),budget:1});
 assert.equal(r.selected.length,1);
 assert.equal(r.selected[0].pairId,'pair-A');
 assert.equal(r.omitted.length,1);
 assert.equal(r.omitted[0].reason,'BUDGET_EXHAUSTED_NOT_COVERED');
 assert.equal(r.physicalExecutions,0);
 assert.equal(r.newGeneratedExperiments,0);
 assert.equal(r.selected[0].physicalExecutionAuthorized,false);
 assert.equal(r.verdict,'STATIC_TRIAGE_ONLY');
 assert.ok(r.compatibleReviewedAdapters.some(x=>x.id==='orders-sourcing'));
});
test('same inputs always yield same reproducible selection hash',()=>{
 const x={paths:['services/order-status-machine.js','features/orders.feature.js'],discovery:discovery(),
  census:census(),budget:2};
 assert.equal(plan(x).planHash,plan({...x,paths:[...x.paths].reverse()}).planHash);
});
test('feature-card changes expose statements without pretending coverage',()=>{
 const r=plan({paths:['features/sourcing.feature.js'],discovery:discovery(),census:census()});
 assert.deepEqual(r.impact.impactedCardInvariants,['INV-2']);
 assert.equal(r.invariantCoveragePercent,null);
 assert.deepEqual(r.selected,[]);
});
test('unmatched files are not silently certified',()=>{
 const r=plan({paths:['services/unknown.js'],discovery:discovery(),census:census()});
 assert.deepEqual(r.impact.unknownFiles,['services/unknown.js']);
 assert.equal(r.verdict,'STATIC_TRIAGE_ONLY');
});
test('missing evidence, traversal and invalid budget fail closed',()=>{
 assert.throws(()=>plan({paths:['../secret'],discovery:discovery(),census:census()}),/G3_SELECTOR_TOOL_ERROR/);
 assert.throws(()=>plan({paths:[],discovery:discovery(),census:census()}),/G3_SELECTOR_TOOL_ERROR/);
 assert.throws(()=>plan({paths:['x'],discovery:{},census:census()}),/G3_SELECTOR_TOOL_ERROR/);
 assert.throws(()=>plan({paths:['x'],discovery:discovery(),census:census(),budget:40}),/G3_SELECTOR_TOOL_ERROR/);
});
test('matching a static pair never creates an executable fixture or a confirmed bug',()=>{
 const x=plan({paths:['services/payment-paypal.js'],discovery:discovery(),census:census()});
 assert.equal(x.selected[0].confirmedBug,false);
 assert.equal(x.selected[0].fixtureAvailable,false);
 assert.equal(x.selected[0].runtimeReachabilityProven,false);
});
