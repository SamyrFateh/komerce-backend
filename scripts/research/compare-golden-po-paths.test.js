'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {comparePaths}=require('./compare-golden-po-paths');
const make=(shape)=>({po_shape:shape,persisted_po_shape:shape,header_carries_order_item:shape==='historical',identity_status:'NO_IDENTITY_CONTRADICTION_OBSERVED',
 checkpoint:'FINANCIAL_CLOSE_MATCHED',

 p1_p7_wiring:{
  schema:'komerce-p1-p7-cross-boundary-research/v1',
  execution:'CANONICAL_READ_ONLY_OWNER_ADAPTERS',
  wired_edges:['P7_P1_MARKET_PRICING','P7_P1_MARKET_EXPOSURE','P7_P2_CHECKOUT',
   'P1_P2_SELLABLE_UNIT','P2_P3_PURCHASE_REQUIREMENT','P3_P4_HUB_RECEIPT',
   'P4_P2_RELAY_HANDOFF','P5_P2_PAYMENT_CLOSURE','P3_P6_PURCHASE_COST',
   'P4_P6_LOGISTICS_COST','P5_P6_CASH_REALITY'],
  owner_read_errors:[],
  foreign_cost_allocation_probe:{outcome:'CROSS_ORDER_COST_ALLOCATION_REPRODUCED',hypothesis:'COST_ALLOCATION_FOREIGN_ORDER'},
  cross_rail_funds_probe:{outcome:'STRIPE_ORDER_CASH_COLLECTION_ACCEPTED',
     hypothesis:'STRIPE_ORDER_HAS_CASH_COLLECTION'},
  foreign_parcel_logistics_cost_probe:{outcome:'UNLINKED_LOGISTICS_COST_PARCEL_REPRODUCED',
    hypotheses:['LOGISTICS_COST_PARCEL_NOT_CONTAINING_ITEM','LOGISTICS_COST_SHIPMENT_PARCEL_UNLINKED']},
  unpaid_closure_probe:{outcome:'OWNER_RECONCILED_AFTER_TEMP_UNPAID',
   verdict:'FINANCIAL_CLOSE_MISMATCH',
   reason:'FINANCIAL_CLOSE_CUSTOMER_PAYMENT_NOT_PAID',payment_status:'pending'},
  boundaries:[
   {id:'P2_P3_PURCHASE_REQUIREMENT',status:'EVIDENCE_GAP',contradictions:[],gaps:['UNKNOWN_OWNER_OR_CONSUMER_VERDICT']},
   {id:'P3_P4_HUB_RECEIPT',status:'NO_CONTRADICTION_OBSERVED',contradictions:[],gaps:[]},
   {id:'P4_P2_RELAY_HANDOFF',status:'NO_CONTRADICTION_OBSERVED',contradictions:[],gaps:[]},
   {id:'P5_P2_PAYMENT_CLOSURE',status:'EVIDENCE_GAP',contradictions:[],gaps:['UNKNOWN_OWNER_OR_CONSUMER_VERDICT']},
   {id:'P3_P6_PURCHASE_COST',status:'EVIDENCE_GAP',contradictions:[],gaps:['UNKNOWN_OWNER_OR_CONSUMER_VERDICT']},
   {id:'P4_P6_LOGISTICS_COST',status:'NO_CONTRADICTION_OBSERVED',contradictions:[],gaps:[]},
   {id:'P5_P6_CASH_REALITY',status:'EVIDENCE_GAP',contradictions:[],gaps:['UNKNOWN_OWNER_OR_CONSUMER_VERDICT']}
  ],
  funds_cost:{
    facts:{order_id:'o1',synthetic:true,mode:'stripe_eur',collections:0,
      actual_fee_allocations:0,shadow_fee_state:'not_expected'},
    diagnostics:{gaps:['SYNTHETIC_GOLDEN_PAYMENT_NOT_EXTERNAL_PROOF','PAYMENT_FEE_NOT_ACTUALLY_VALUED'],
      contradictions:[]}
  },
  logistics_cost:{
    facts:{member_parcel_count:1,item_parcel_count:1,actual_cost_count:2,
      compared_owner_cost_types:2,allocated_kmf:{freight:1500,customs:2500}},
    diagnostics:{contradictions:[],gaps:[]}
  },
  supplier_cost:{
   facts:{product_purchase_actual_count:1,allocation_amount_kmf:7000,
    settlement_real_kmf:null,shadow_purchase_state:'estimated_only'},
   diagnostics:{contradictions:[],gaps:['ACTUAL_ALLOCATION_WITHOUT_SETTLEMENT_PROOF']}
  },
  customer_finance:{
   facts:{mode:'stripe_eur',synthetic:true,psp_reference_present:false,
    closure_verdict:'FINANCIAL_CLOSE_MATCHED',closure_mode:'normal'},
   diagnostics:{finance_outcome:'NOT_CERTIFICATION',contradictions:[],
    gaps:['SYNTHETIC_PAYMENT_NOT_PSP_PROOF','STRIPE_PAID_NO_PSP_REFERENCE']}
  },
  physical_handoff:{
   facts:{parcel_count:1,item_parcel_count:1,scan_count:1,handoff_verdict:'HANDOFF_MATCHED'},
   diagnostics:{contradictions:[],gaps:[]}
  },
  purchasing_hub:{
   facts:{line_count:1,allocation_count:1,fulfillment_count:1,
     inbound_verdict:'INBOUND_MATCHED',effective_quantity:1,received_quantity:1,
     po_shape:shape},
   diagnostics:{contradictions:[],gaps:['SYNTHETIC_GOLDEN_CLIENT_PAYMENT_NOT_PROVED']}
  },
 },

 progressive_checkpoints:[
  {stage:'SUPPLIER_EXECUTION_NOT_HUB_RECEIPT',status:'MISSING_IDENTITY_EVIDENCE',gaps:['NO_HUB_ALLOCATION','NO_PARCEL_MEMBERSHIP']},
  {stage:'HUB_RECEIPT_BEFORE_PARCEL',status:'MISSING_IDENTITY_EVIDENCE',gaps:['NO_PARCEL_MEMBERSHIP']},
  {stage:'AT_RELAY_NO_CUSTOMER_SCAN',status:'MISSING_IDENTITY_EVIDENCE',gaps:['NO_CUSTOMER_HANDOFF_SCAN']},
  {stage:'CUSTOMER_HANDOFF_AND_FINANCIAL_CLOSE',status:'NO_IDENTITY_CONTRADICTION_OBSERVED',gaps:[]},
 ],
 pre_submission_hub_probe:{outcome:shape==='grouped'?'QUARANTINED':'RECEIVED',
  reason_code:shape==='grouped'?'HUB_PURCHASE_ORDER_NOT_SUBMITTED':null,
  allocation_count:shape==='grouped'?0:1},
 pre_submission:{schema:'golden-po-unsubmitted-checkpoint/v1',persisted_shape:shape,
  persisted_status:shape==='grouped'?'draft':'pending',execution_count:0,payment_count:0,
  verdict:'NO_RECORDED_SUPPLIER_EXECUTION',issues:[]},
 verified_counts:{itemIds:1,purchaseLineIds:1,executionLineIds:1,supplierPaymentIds:1,
  fulfillmentIds:1,hubAllocationIds:1,physicalUnitIds:1,parcelIds:1,scanIds:1},
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
test('rejects wrong supplier/hub item count even before differential comparison',()=>{
 const a=make('grouped'),b=make('historical');b.verified_counts.hubAllocationIds=0;
 assert.throws(()=>comparePaths(a,b),/Full nine-category canonical identity evidence required: hubAllocationIds/);
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

test('pair is rejected when both lack persisted pre-submission facts',()=>{
 const a=make('grouped'),b=make('historical');
 delete a.pre_submission;delete b.pre_submission;
 assert.throws(()=>comparePaths(a,b),/not independently proved/);
});
test('grouped draft cannot be silently replaced by pending status',()=>{
 const a=make('grouped'),b=make('historical');
 a.pre_submission.persisted_status='pending';
 assert.throws(()=>comparePaths(a,b),/not independently proved/);
});
test('historical pending cannot be silently replaced by draft status',()=>{
 const a=make('grouped'),b=make('historical');
 b.pre_submission.persisted_status='draft';
 assert.throws(()=>comparePaths(a,b),/not independently proved/);
});
test('supplier execution without submission is not normalised away',()=>{
 const a=make('grouped'),b=make('historical');
 a.pre_submission.execution_count=1;
 assert.throws(()=>comparePaths(a,b),/not independently proved/);
});
test('two equally incomplete trails are not accepted as equivalent',()=>{
 const a=make('grouped'),b=make('historical');
 a.verified_counts.supplierPaymentIds=0;
 b.verified_counts.supplierPaymentIds=0;
 assert.throws(()=>comparePaths(a,b),/Full nine-category/);
});

test('observable Hub entry behavior can be asymmetric even when nominal Goldens agree',()=>{
 const r=comparePaths(make('grouped'),make('historical'));
 assert.equal(r.mismatchCount,0);
 assert.equal(r.earlyHub.hypothesis,'EARLY_HUB_RECEIPT_ASYMMETRY_HYPOTHESIS');
 assert.equal(r.earlyHub.grouped.outcome,'QUARANTINED');
 assert.equal(r.earlyHub.historical.outcome,'RECEIVED');
});
test('Hub probe exception remains inconclusive, never called a business defect',()=>{
 const a=make('grouped'),b=make('historical');
 b.pre_submission_hub_probe={outcome:'ERROR',reason_code:'unexpected',allocation_count:null};
 assert.equal(comparePaths(a,b).earlyHub.hypothesis,'PROBE_INCONCLUSIVE');
});
test('missing real Hub probe is a hard evidence gap',()=>{
 const a=make('grouped'),b=make('historical');
 delete a.pre_submission_hub_probe;
 assert.throws(()=>comparePaths(a,b),/Both actual PostgreSQL Hub probes required/);
});

test('fail closed: both Goldens missing the same new P2-P4 checkpoint',()=>{
 const a=make('grouped'),b=make('historical');
 delete a.p1_p7_wiring;delete b.p1_p7_wiring;
 assert.throws(()=>comparePaths(a,b),/P2-P4 canonical owner wiring missing/);
});
test('fail closed: both Goldens superficially green without usable physical receipts',()=>{
 const a=make('grouped'),b=make('historical');
 a.p1_p7_wiring.purchasing_hub.facts.received_quantity=0;
 b.p1_p7_wiring.purchasing_hub.facts.received_quantity=0;
 assert.throws(()=>comparePaths(a,b),/P2-P4 physical owner identity and quantity proof incomplete/);
});
test('fail closed: one owner real-world stock verdict disagrees with recorded P3-P4 seam',()=>{
 const a=make('grouped'),b=make('historical');
 a.p1_p7_wiring.boundaries[1].status='CONTRADICTION_HYPOTHESIS';
 assert.throws(()=>comparePaths(a,b),/P2-P4 physical owner identity and quantity proof incomplete/);
});
test('pair must not pretend historical/po-group shapes are the same',()=>{
 const a=make('grouped'),b=make('historical');
 assert.equal(a.p1_p7_wiring.purchasing_hub.facts.po_shape,'grouped');
 assert.equal(b.p1_p7_wiring.purchasing_hub.facts.po_shape,'historical');
 assert.equal(comparePaths(a,b).mismatchCount,0);
});

test('both Goldens without handoff are not nominally equal',()=>{
 const a=make('grouped'),b=make('historical');
 delete a.p1_p7_wiring.physical_handoff;
 delete b.p1_p7_wiring.physical_handoff;
 assert.throws(()=>comparePaths(a,b),/P4-P2 true parcel membership/);
});
test('shared parcel false green: missing member item identity is fail-closed',()=>{
 const a=make('grouped'),b=make('historical');
 a.p1_p7_wiring.physical_handoff.facts.item_parcel_count=0;
 b.p1_p7_wiring.physical_handoff.facts.item_parcel_count=0;
 assert.throws(()=>comparePaths(a,b),/P4-P2 true parcel membership/);
});
test('both Golden paths must have scan, not just parcel.collected',()=>{
 const a=make('grouped'),b=make('historical');
 a.p1_p7_wiring.physical_handoff.facts.scan_count=0;
 b.p1_p7_wiring.physical_handoff.facts.scan_count=0;
 assert.throws(()=>comparePaths(a,b),/P4-P2 true parcel membership/);
});

test('both matching Goldens without a finance owner read never prove customer payment',()=>{
 const a=make('grouped'),b=make('historical');
 delete a.p1_p7_wiring.customer_finance;
 delete b.p1_p7_wiring.customer_finance;
 assert.throws(()=>comparePaths(a,b),/P5-P2 finance/);
});
test('both synthetic payment fixtures mislabeled PSP proved are rejected',()=>{
 const a=make('grouped'),b=make('historical');
 for(const p of [a,b]){
  p.p1_p7_wiring.boundaries.find(x=>x.id==='P5_P2_PAYMENT_CLOSURE').status='NO_CONTRADICTION_OBSERVED';
  p.p1_p7_wiring.customer_finance.diagnostics.gaps=[];
 }
 assert.throws(()=>comparePaths(a,b),/P5-P2 finance/);
});
test('one deceptively persisted Stripe ref cannot be treated as a real PSP charge',()=>{
 const a=make('grouped'),b=make('historical');
 b.p1_p7_wiring.customer_finance.facts.psp_reference_present=true;
 assert.throws(()=>comparePaths(a,b),/P5-P2 finance/);
});

test('both Goldens must include real unpaid payment PostgreSQL negative outcome',()=>{
 const a=make('grouped'),b=make('historical');
 delete a.p1_p7_wiring.unpaid_closure_probe;
 delete b.p1_p7_wiring.unpaid_closure_probe;
 assert.throws(()=>comparePaths(a,b),/P5-P2 real PostgreSQL unpaid-close negative probe/);
});
test('bad negative probe that still financially matches must reject equal fixtures',()=>{
 const a=make('grouped'),b=make('historical');
 for(const x of [a,b]){
  x.p1_p7_wiring.unpaid_closure_probe.verdict='FINANCIAL_CLOSE_MATCHED';
 }
 assert.throws(()=>comparePaths(a,b),/P5-P2 real PostgreSQL unpaid-close negative probe/);
});

test('both Goldens without supplier-cost canonical owner observation are rejected',()=>{
 const a=make('grouped'),b=make('historical');
 delete a.p1_p7_wiring.supplier_cost;delete b.p1_p7_wiring.supplier_cost;
 assert.throws(()=>comparePaths(a,b),/P3-P6 actual allocation/);
});
test('a synthetic supplier purchase cost must never masquerade as proven real KMF',()=>{
 const a=make('grouped'),b=make('historical');
 for(const p of [a,b]){
   p.p1_p7_wiring.supplier_cost.facts.settlement_real_kmf=7000;
   p.p1_p7_wiring.boundaries.find(e=>e.id==='P3_P6_PURCHASE_COST').status='NO_CONTRADICTION_OBSERVED';
 }
 assert.throws(()=>comparePaths(a,b),/P3-P6 actual allocation/);
});

test('both matching PO variants missing SQL cost trace must fail comparison',()=>{
 const a=make('grouped'),b=make('historical');
 delete a.p1_p7_wiring.foreign_cost_allocation_probe;
 delete b.p1_p7_wiring.foreign_cost_allocation_probe;
 assert.throws(()=>comparePaths(a,b),/P3-P6 persisted cross-order cost check is missing/);
});
test('a protective SQL constraint is a valid result in both PO variants',()=>{
 const a=make('grouped'),b=make('historical');
 a.p1_p7_wiring.foreign_cost_allocation_probe={outcome:'SQL_COST_ALLOCATION_ORDER_GUARD',sqlstate:'23514'};
 b.p1_p7_wiring.foreign_cost_allocation_probe={outcome:'SQL_COST_ALLOCATION_ORDER_GUARD',sqlstate:'23514'};
 assert.equal(comparePaths(a,b).mismatchCount,0);
});

test('both Golden paths lacking P4-P6 physical-cost reads cannot pass',()=>{
 const a=make('grouped'),b=make('historical');
 delete a.p1_p7_wiring.logistics_cost;delete b.p1_p7_wiring.logistics_cost;
 assert.throws(()=>comparePaths(a,b),/P4-P6 exact parcel-to-item/);
});
test('P4-P6 2 matching missing freight proof envelopes must not pass',()=>{
 const a=make('grouped'),b=make('historical');
 a.p1_p7_wiring.logistics_cost.facts.actual_cost_count=1;
 b.p1_p7_wiring.logistics_cost.facts.actual_cost_count=1;
 assert.throws(()=>comparePaths(a,b),/P4-P6 exact parcel-to-item/);
});
test('P4-P6 both missing real negative parcel probe must be rejected',()=>{
 const a=make('grouped'),b=make('historical');
 delete a.p1_p7_wiring.foreign_parcel_logistics_cost_probe;
 delete b.p1_p7_wiring.foreign_parcel_logistics_cost_probe;
 assert.throws(()=>comparePaths(a,b),/P4-P6 real SQL wrong-parcel/);
});
test('P4-P6 SQL protective foreign-parcel constraint is an acceptable counterexample outcome',()=>{
 const a=make('grouped'),b=make('historical');
 for(const e of [a,b])
  e.p1_p7_wiring.foreign_parcel_logistics_cost_probe={
   outcome:'SQL_LOGISTICS_COST_PARCEL_GUARD',sqlstate:'23514'};
 assert.equal(comparePaths(a,b).mismatchCount,0);
});

test('P5-P6 cannot pass if both Goldens omit the independent cash-cost observer',()=>{
 const a=make('grouped'),b=make('historical');
 delete a.p1_p7_wiring.funds_cost;delete b.p1_p7_wiring.funds_cost;
 assert.throws(()=>comparePaths(a,b),/P5-P6: synthetic customer funds/);
});
test('P5-P6 twin false PSP proof is rejected, not accepted as equivalent',()=>{
 const a=make('grouped'),b=make('historical');
 for(const x of [a,b])
   x.p1_p7_wiring.boundaries.find(e=>e.id==='P5_P6_CASH_REALITY').status='NO_CONTRADICTION_OBSERVED';
 assert.throws(()=>comparePaths(a,b),/P5-P6: synthetic customer funds/);
});
test('P5-P6 both Goldens must have real negative cross-rail SQL counterexample',()=>{
 const a=make('grouped'),b=make('historical');
 delete a.p1_p7_wiring.cross_rail_funds_probe;delete b.p1_p7_wiring.cross_rail_funds_probe;
 assert.throws(()=>comparePaths(a,b),/P5-P6 real SQL cross-rail/);
});
test('P5-P6 SQL protective constraint is also acceptable, with exact SQLSTATE',()=>{
 const a=make('grouped'),b=make('historical');
 for(const x of [a,b])
  x.p1_p7_wiring.cross_rail_funds_probe={outcome:'SQL_CROSS_RAIL_COLLECTION_GUARD',sqlstate:'23514'};
 assert.equal(comparePaths(a,b).mismatchCount,0);
});
