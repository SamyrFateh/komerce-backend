'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {comparePaths}=require('./compare-golden-po-paths');
const make=(shape)=>({po_shape:shape,persisted_po_shape:shape,header_carries_order_item:shape==='historical',identity_status:'NO_IDENTITY_CONTRADICTION_OBSERVED',
 checkpoint:'FINANCIAL_CLOSE_MATCHED',
 progressive_checkpoints:[
  {stage:'SUPPLIER_EXECUTION_NOT_HUB_RECEIPT',status:'MISSING_IDENTITY_EVIDENCE',gaps:['NO_HUB_ALLOCATION','NO_PARCEL_MEMBERSHIP']},
  {stage:'HUB_RECEIPT_BEFORE_PARCEL',status:'MISSING_IDENTITY_EVIDENCE',gaps:['NO_PARCEL_MEMBERSHIP']},
  {stage:'AT_RELAY_NO_CUSTOMER_SCAN',status:'MISSING_IDENTITY_EVIDENCE',gaps:['NO_CUSTOMER_HANDOFF_SCAN']},
  {stage:'CUSTOMER_HANDOFF_AND_FINANCIAL_CLOSE',status:'NO_IDENTITY_CONTRADICTION_OBSERVED',gaps:[]},
 ],
 verified_counts:{itemIds:1,purchaseLineIds:1,hubAllocationIds:1,physicalUnitIds:1,parcelIds:1,scanIds:1},
 real_sql_mutation_rejected:true,real_sql_guard_code:'23514',
 perturbation_detected:['PURCHASE_SKU_SUBSTITUTION','HUB_ALLOCATION_SKU_MISMATCH'],
 canonical_order_id:'random-order-id',
});
test('equivalent paths agree with independent source IDs',()=>{
 const a=make('grouped'),b=make('historical');b.canonical_order_id='different-order-id';
 assert.equal(comparePaths(a,b).mismatchCount,0);
});
test('detects purchasing/hub boundary discrepancy',()=>{
 const a=make('grouped'),b=make('historical');
 b.progressive_checkpoints[1].gaps.push('NO_HUB_ALLOCATION');
 const r=comparePaths(a,b);
 assert.equal(r.verdict,'CROSS_PATH_ASYMMETRY_HYPOTHESIS');
 assert.deepEqual(r.mismatches.map(x=>x.field),['stage_projections']);
});
test('detects wrong supplier/hub item count',()=>{
 const a=make('grouped'),b=make('historical');b.verified_counts.hubAllocationIds=0;
 assert.deepEqual(comparePaths(a,b).mismatches.map(x=>x.field),['identity_categories']);
});
test('rejects missing or wrong final canonical owner proof',()=>{
 const a=make('grouped'),b=make('historical');b.checkpoint='FINANCIAL_CLOSE_PENDING';
 assert.throws(()=>comparePaths(a,b),/financial close not matched/);
});
test('requires both separately named PO forms',()=>{
 const a=make('grouped'),b=make('grouped');
 assert.throws(()=>comparePaths(a,b),/grouped vs historical/);
});

test('rejects ungrounded PO shape labels even if nominal signatures match',()=>{
 const a=make('grouped'),b=make('historical');
 b.persisted_po_shape='grouped';
 assert.throws(()=>comparePaths(a,b),/canonical persisted PO headers/);
});
