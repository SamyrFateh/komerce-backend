'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {scenarioEvidence,domainForTable}=require('./v29-metadata-selector');
const {validateDiscovery,humanDigest}=require('./v29-unified-discovery');
const sha='12'.repeat(20),rank='af'.repeat(32);
const source=()=>({
 contract:'komerce-prioritized-pair-selector/v22',rankHash:rank,
 rank:[{id:'PAIR-REFUNDS',table:'refunds',score:1000,
  actors:[{source:'routes/orders/cancel.js'},{source:'services/payment-paypal.js'}]}]});
const inventory=()=>({contract:'komerce-business-writer-inventory/v1',
 writes:[{table:'parcel_items',file:'services/auto-parcel.js',
  physicalTableDeclared:true,binding:'DIRECT_QUERY_ARGUMENT',line:201}]});
test('metadata-driven calibrated recipes are backed by live owner/table signatures',()=>{
 const r=scenarioEvidence(inventory(),source());
 assert.deepEqual(r.selected.map(x=>x.id),[
  'FIN-REFUND-BA','LOG-PARCEL-NOMINAL','FIN-REFUND-AB','LOG-PARCEL-CANCELLED']);
 assert.equal(r.selected[0].ownerEvidence.pairId,'PAIR-REFUNDS');
 assert.deepEqual(r.selected[1].ownerEvidence.writerLines,[201]);
 assert.equal(r.contract,'komerce-owner-grounded-calibrated-recipe-selection/v29');
 assert.match(r.hash,/^[0-9a-f]{64}$/);
 assert.equal(r.mode,'SOURCE_DISCOVERED_OWNER_ANCHORED_RECIPES');
});
test('bounded selection keeps nominal across two domains before violations',()=>{
 assert.deepEqual(scenarioEvidence(inventory(),source(),{maxCases:2})
  .selected.map(x=>x.id),['FIN-REFUND-BA','LOG-PARCEL-NOMINAL']);
 assert.equal(scenarioEvidence(inventory(),source(),{maxCases:2}).unselected.length,2);
});
test('single-domain scope does not invent unrelated executable witnesses',()=>{
 assert.deepEqual(scenarioEvidence(inventory(),source(),{domains:['logistics']})
  .selected.map(x=>x.id),['LOG-PARCEL-NOMINAL','LOG-PARCEL-CANCELLED']);
});
test('missing source writer proves adapter no longer eligible (fail closed)',()=>{
 assert.throws(()=>scenarioEvidence({...inventory(),writes:[]},source()),/writer no longer present/);
 assert.throws(()=>scenarioEvidence(inventory(),{...source(),rank:[]}),/writer no longer present/);
});
test('source-only pair is not a runtime bug and budget cannot grow unchecked',()=>{
 for(const opts of [{maxCases:5},{maxCases:0},{domains:['inventory']},
  {domains:['finance','finance']}])
  assert.throws(()=>scenarioEvidence(inventory(),source(),opts),/V29_SELECTION_TOOL_ERROR/);
});
test('domain inference remains explicit and unrecognized tables are not healthy',()=>{
 assert.equal(domainForTable('parcel_items'),'logistics');
 assert.equal(domainForTable('refunds'),'finance');
 assert.equal(domainForTable('unknown_thing'),'unclassified');
 assert.equal(domainForTable('inventory_items'),'inventory');
});
test('full report selection requires source ranking, invariant registry and source provenance',()=>{
 const d={contract:'komerce-metadata-driven-selection/v29',sha,
  selectionHash:rank,pairs:{equivalenceClasses:1,reviewQueue:[{}]},
  inventory:{summary:{candidateWrites:10}},rules:{count:7},
  calibration:{selected:[{id:'FIN-REFUND-BA',ownerEvidence:{pairId:'x'}}],
   hash:rank},
  summary:{requiresNewAdapterForFullCoverage:true}};
 assert.doesNotThrow(()=>validateDiscovery(d,sha));
 assert.throws(()=>validateDiscovery({...d,rules:{count:0}},sha),/V29_SELECTION_TOOL_ERROR/);
 assert.throws(()=>validateDiscovery({...d,calibration:{selected:[],hash:rank}},sha),/V29_SELECTION_TOOL_ERROR/);
 assert.throws(()=>validateDiscovery(d,'ab'.repeat(20)),/V29_SELECTION_TOOL_ERROR/);
});

test('single report Markdown uses the persisted sourceDiscovery payload',()=>{
 const r={sourceDiscovery:{sha,selectionHash:rank,
  summary:{totalWriterPairs:2,equivalenceClasses:1,
   singleWriterOrUnpairedTables:3},
  calibration:{selected:[{id:'FIN-REFUND-BA',selectionReason:'OWNER_GRAPH',
   ownerEvidence:{pairId:'x'}}]},
  pairs:{reviewQueue:[{table:'refunds',domain:'finance',rankScore:1200,
   physicalStatus:'ADAPTER_NOT_CERTIFIED_FOR_THIS_PAIR'}]}}};
 const md=humanDigest(r);
 assert.match(md,/ADAPTATEUR ET ORACLE À DÉVELOPPER/);
 assert.match(md,/OWNER_GRAPH/);
 assert.match(md,/refunds/);
});
