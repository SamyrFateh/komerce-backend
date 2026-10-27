#!/usr/bin/env node
'use strict';
/**
 * Differential R&D oracle for two executions of the *same existing Golden*.
 * Compare business decision/evidence shapes, never generated identifiers.
 * Two matching broken paths do NOT certify business truth.
 */
const fs=require('node:fs'),crypto=require('node:crypto');
const REQUIRED_CATEGORIES=['itemIds','purchaseLineIds','executionLineIds',
 'supplierPaymentIds','fulfillmentIds','hubAllocationIds','physicalUnitIds','parcelIds','scanIds'];
function assertUnsubmitted(p, expectedShape) {
 const s=p.pre_submission;
 if(!s || s.schema!=='golden-po-unsubmitted-checkpoint/v1'
    || s.persisted_shape!==expectedShape
    || s.persisted_status!==(expectedShape==='grouped'?'draft':'pending')
    || s.verdict!=='NO_RECORDED_SUPPLIER_EXECUTION'
    || !Array.isArray(s.issues) || s.issues.length
    || s.execution_count!==0 || s.payment_count!==0)
  throw Error('Unsubmitted PO not independently proved in persisted database');
}
function assertP2P4(p) {
 const w=p.p1_p7_wiring;
 if(!w||w.schema!=='komerce-p1-p7-cross-boundary-research/v1' ||
    w.execution!=='CANONICAL_READ_ONLY_OWNER_ADAPTERS' ||
    !Array.isArray(w.wired_edges) ||
    !['P2_P3_PURCHASE_REQUIREMENT','P3_P4_HUB_RECEIPT']
      .every(k=>w.wired_edges.includes(k)) ||
    w.owner_read_errors?.length || !Array.isArray(w.owner_read_errors))
   throw Error('P2-P4 canonical owner wiring missing or unreadable');
 const edge=k=>w.boundaries?.find(b=>b.id===k);
 const purchase=edge('P2_P3_PURCHASE_REQUIREMENT'),hub=edge('P3_P4_HUB_RECEIPT');
 const facts=w.purchasing_hub?.facts,diag=w.purchasing_hub?.diagnostics;
 if(!purchase||!hub||hub.status!=='NO_CONTRADICTION_OBSERVED' ||
    hub.contradictions?.length || !Array.isArray(hub.contradictions) ||
    purchase.status==='CONTRADICTION_HYPOTHESIS' ||
    !facts||facts.line_count!==1||facts.allocation_count!==1||facts.fulfillment_count!==1 ||
    facts.inbound_verdict!=='INBOUND_MATCHED' ||
    !Number.isSafeInteger(Number(facts.received_quantity)) ||
    Number(facts.received_quantity)<1 ||
    Number(facts.received_quantity)!==Number(facts.effective_quantity) ||
    !diag || diag.contradictions?.length || !Array.isArray(diag.contradictions))
   throw Error('P2-P4 physical owner identity and quantity proof incomplete');
 return {purchase_status:purchase.status,hub_status:hub.status,
  physical_qty:Number(facts.received_quantity),inbound_verdict:facts.inbound_verdict,
  line_count:facts.line_count,allocation_count:facts.allocation_count};
}
function assertP4P2(p) {
 const w=p.p1_p7_wiring, edge=w?.boundaries?.find(b=>b.id==='P4_P2_RELAY_HANDOFF');
 const facts=w?.physical_handoff?.facts,diag=w?.physical_handoff?.diagnostics;
 if(!w?.wired_edges?.includes('P4_P2_RELAY_HANDOFF') ||
    edge?.status!=='NO_CONTRADICTION_OBSERVED' ||
    !Array.isArray(edge.contradictions)||edge.contradictions.length ||
    !facts||facts.handoff_verdict!=='HANDOFF_MATCHED' ||
    !Number.isSafeInteger(facts.parcel_count)||facts.parcel_count<1 ||
    !Number.isSafeInteger(facts.item_parcel_count)||facts.item_parcel_count<1 ||
    !Number.isSafeInteger(facts.scan_count)||facts.scan_count<1 ||
    !diag||!Array.isArray(diag.contradictions)||diag.contradictions.length ||
    !Array.isArray(diag.gaps)||diag.gaps.length)
   throw Error('P4-P2 true parcel membership and handoff evidence missing');
 return {handoff_verdict:facts.handoff_verdict,
  parcels:facts.parcel_count,item_parcels:facts.item_parcel_count,
  scans:facts.scan_count};
}
function assertP5P2(p) {
 const w=p.p1_p7_wiring;
 const edge=w?.boundaries?.find(x=>x.id==='P5_P2_PAYMENT_CLOSURE');
 const finance=w?.customer_finance;
 const facts=finance?.facts,diag=finance?.diagnostics;
 // The disposable Golden is synthetic and does NOT attest a real PSP
 // event. The proper condition is *explicit non-proof*, not false PASS.
 if(!w?.wired_edges?.includes('P5_P2_PAYMENT_CLOSURE') ||
    !edge||edge.status!=='EVIDENCE_GAP' ||
    !Array.isArray(edge.contradictions)||edge.contradictions.length ||
    !facts||facts.synthetic!==true ||
    facts.closure_verdict!=='FINANCIAL_CLOSE_MATCHED' ||
    facts.mode!=='stripe_eur' ||
    facts.psp_reference_present!==false ||
    !diag||diag.finance_outcome!=='NOT_CERTIFICATION' ||
    !Array.isArray(diag.contradictions)||diag.contradictions.length ||
    !Array.isArray(diag.gaps) ||
    !diag.gaps.includes('SYNTHETIC_PAYMENT_NOT_PSP_PROOF') ||
    !diag.gaps.includes('STRIPE_PAID_NO_PSP_REFERENCE'))
   throw Error('P5-P2 finance: synthetic Golden payment is not PSP evidence; explicit gap required');
 const probe=w.unpaid_closure_probe;
 if(!probe || !(
   (probe.outcome==='OWNER_RECONCILED_AFTER_TEMP_UNPAID' &&
    probe.verdict==='FINANCIAL_CLOSE_MISMATCH' &&
    probe.reason==='FINANCIAL_CLOSE_CUSTOMER_PAYMENT_NOT_PAID' &&
    probe.payment_status==='pending') ||
   (probe.outcome==='DATABASE_GUARD_REJECTED_UNPAID_REWRITE' &&
    ['23514','P0001'].includes(probe.code))
 ))throw Error('P5-P2 real PostgreSQL unpaid-close negative probe absent or inconclusive');
 return {finance_scope:'SYNTHETIC_PAYMENT_NOT_PSP_PROVED',
  closure_status:facts.closure_verdict,psp_ref_proved:false,
  unpaid_probe_outcome:probe.outcome,
  unpaid_probe_verdict:probe.verdict||'SQL_GUARD_REJECTED'};
}
function assertP3P6(p) {
 const w=p.p1_p7_wiring;
 const edge=w?.boundaries?.find(x=>x.id==='P3_P6_PURCHASE_COST');
 const cost=w?.supplier_cost, facts=cost?.facts,diag=cost?.diagnostics;
 // Our Golden directly seeds an allocation marked actual but DOES NOT
 // record a supplier_payment_settlements debit. Claiming real verified KMF
 // from that allocation is specifically a false green.
 if(!w?.wired_edges?.includes('P3_P6_PURCHASE_COST')||
    !edge||edge.status!=='EVIDENCE_GAP' ||
    !Array.isArray(edge.contradictions)||edge.contradictions.length ||
    !facts||facts.product_purchase_actual_count!==1||
    Number(facts.allocation_amount_kmf)!==7000||
    facts.settlement_real_kmf!==null ||
    !diag||!Array.isArray(diag.contradictions)||diag.contradictions.length ||
    !Array.isArray(diag.gaps)||
    !diag.gaps.includes('ACTUAL_ALLOCATION_WITHOUT_SETTLEMENT_PROOF'))
   throw Error('P3-P6 actual allocation must not become a proved supplier settlement');
 const probe=w.foreign_cost_allocation_probe;
 if(!probe||!(
   (probe.outcome==='CROSS_ORDER_COST_ALLOCATION_REPRODUCED'&&
     probe.hypothesis==='COST_ALLOCATION_FOREIGN_ORDER')||
   (probe.outcome==='SQL_COST_ALLOCATION_ORDER_GUARD'&&
     ['23514','23503','P0001'].includes(probe.sqlstate))
 ))throw Error('P3-P6 persisted cross-order cost check is missing');
 return {purchase_cost_evidence:'ACTUAL_ALLOCATION_WITHOUT_SETTLEMENT_PROOF',
  item_allocation_kmf:7000,verified_supplier_settlement_kmf:null,
  cost_poison_outcome:probe.outcome};
}
function assertP4P6(p){
 const w=p.p1_p7_wiring,edge=w?.boundaries?.find(x=>x.id==='P4_P6_LOGISTICS_COST');
 const cost=w?.logistics_cost,f=cost?.facts,d=cost?.diagnostics;
 if(!w?.wired_edges?.includes('P4_P6_LOGISTICS_COST')||
   !edge||edge.status!=='NO_CONTRADICTION_OBSERVED'||
   !Array.isArray(edge.contradictions)||edge.contradictions.length||
   !f||f.member_parcel_count!==1||f.item_parcel_count!==1||
   f.actual_cost_count!==2||f.compared_owner_cost_types!==2||
   Number(f.allocated_kmf?.freight)!==1500||
   Number(f.allocated_kmf?.customs)!==2500||
   !d||!Array.isArray(d.contradictions)||d.contradictions.length||
   !Array.isArray(d.gaps)||d.gaps.length)
   throw Error('P4-P6 exact parcel-to-item freight/duty real-owner evidence missing');
 const probe=w.foreign_parcel_logistics_cost_probe;
 const detected=probe?.outcome==='UNLINKED_LOGISTICS_COST_PARCEL_REPRODUCED' &&
   Array.isArray(probe.hypotheses) &&
   probe.hypotheses.includes('LOGISTICS_COST_PARCEL_NOT_CONTAINING_ITEM') &&
   probe.hypotheses.includes('LOGISTICS_COST_SHIPMENT_PARCEL_UNLINKED');
 const guarded=probe?.outcome==='SQL_LOGISTICS_COST_PARCEL_GUARD' &&
   ['23514','23503','P0001'].includes(probe.sqlstate);
 if(!detected&&!guarded)
   throw Error('P4-P6 real SQL wrong-parcel cost probe absent or inconclusive');
 return {nominal:'CORRECT_PARCEL_AND_SHIPMENT',
   freight_kmf:1500,customs_kmf:2500,
   foreign_parcel_probe:probe.outcome};
}
function assertP5P6(p){
 const w=p.p1_p7_wiring;
 const e=w?.boundaries?.find(x=>x.id==='P5_P6_CASH_REALITY');
 const f=w?.funds_cost?.facts,d=w?.funds_cost?.diagnostics;
 if(!w?.wired_edges?.includes('P5_P6_CASH_REALITY')||
    !e||e.status!=='EVIDENCE_GAP'||e.contradictions?.length||
    !Array.isArray(e.contradictions)||
    !f||f.synthetic!==true||f.mode!=='stripe_eur'||f.collections!==0||
    f.actual_fee_allocations!==0||
    !d||!Array.isArray(d.gaps)||
    !d.gaps.includes('SYNTHETIC_GOLDEN_PAYMENT_NOT_EXTERNAL_PROOF')||
    !Array.isArray(d.contradictions)||d.contradictions.length)
   throw Error('P5-P6: synthetic customer funds and payment fees are not independently certified');
 const probe=w.cross_rail_funds_probe;
 const detected=probe?.outcome==='STRIPE_ORDER_CASH_COLLECTION_ACCEPTED'&&
   probe.hypothesis==='STRIPE_ORDER_HAS_CASH_COLLECTION';
 const guarded=probe?.outcome==='SQL_CROSS_RAIL_COLLECTION_GUARD'&&
   ['23514','23503','P0001'].includes(probe.sqlstate);
 if(!detected&&!guarded)
   throw Error('P5-P6 real SQL cross-rail cash collection proof missing');
 return {evidence:'NO_SIGNED_CUSTOMER_FUNDS_OR_REAL_PAYMENT_FEE',
   cash_collection_count:0,fee_allocation_count:0,negative_outcome:probe.outcome};
}
function assertP6P1P7P5(p){
 const w=p.p1_p7_wiring;
 const price=w?.price_review,sett=w?.country_settlement;
 const ePrice=w?.boundaries?.find(e=>e.id==='P6_P1_PRICE_REVIEW');
 const eSett=w?.boundaries?.find(e=>e.id==='P7_P5_COUNTRY_SETTLEMENT');
 if(!w?.wired_edges?.includes('P6_P1_PRICE_REVIEW')||
    !w?.wired_edges?.includes('P7_P5_COUNTRY_SETTLEMENT')||
    w.totals?.notWired!==0||
    !ePrice||ePrice.status!=='EVIDENCE_GAP'||ePrice.contradictions?.length||
    !price||price.facts?.price_status!==null||
    !price.diagnostics?.gaps?.includes('NO_HUMAN_MARKET_PRICE_DECISION')||
    !eSett||eSett.status!=='EVIDENCE_GAP'||eSett.contradictions?.length||
    !sett||sett.facts?.settlement_count!==0||
    !sett.diagnostics?.gaps?.includes('NO_COUNTRY_SETTLEMENT_ATTESTATION'))
   throw Error('P6-P1 / P7-P5: owner decisions are not independently documented');
 const pr=w.unaudited_price_probe,sp=w.draft_settlement_probe;
 const priceCaught=pr?.outcome==='PRICE_ACTIVATE_EVENT_WITHOUT_ACTOR_ACCEPTED'&&
   pr.hypothesis==='UNATTRIBUTED_PRICE_ACTIVATE_EVENT';
 const priceGuard=pr?.outcome==='SQL_PRICE_ACTIVATION_EVENT_GUARD'&&
   ['23514','23503','23502','P0001'].includes(pr.sqlstate);
 const settlementCaught=sp?.outcome==='DRAFT_ASSIGNMENT_SETTLEMENT_ACCEPTED'&&
   sp.hypothesis==='NEW_READY_SETTLEMENT_ON_INACTIVE_ASSIGNMENT';
 const settlementGuard=sp?.outcome==='SQL_DRAFT_SETTLEMENT_GUARD'&&
   ['23514','23503','23502','P0001'].includes(sp.sqlstate);
 if(!priceCaught&&!priceGuard)
   throw Error('P6-P1 PostgreSQL unaudited price event adversary missing');
 if(!settlementCaught&&!settlementGuard)
   throw Error('P7-P5 PostgreSQL DRAFT assignment settlement adversary missing');
 return {human_price:'NO_HUMAN_DECISION_IN_SYNTHETIC_GOLDEN',
   settlement:'NO_CENTRAL_ATTESTATION_IN_SYNTHETIC_GOLDEN',
   price_probe:pr.outcome,settlement_probe:sp.outcome};
}
const norm=(p)=>{
 if(!p || typeof p!=='object')throw Error('Golden evidence JSON object required');
 if(p.identity_status!=='NO_IDENTITY_CONTRADICTION_OBSERVED')
  throw Error('Nominal Golden identity continuity must be independently clean');
 if(p.checkpoint!=='FINANCIAL_CLOSE_MATCHED')
  throw Error('Nominal canonical financial close not matched');
 if(!Array.isArray(p.progressive_checkpoints)||p.progressive_checkpoints.length!==4)
  throw Error('All four Golden boundaries required');
 for(const key of REQUIRED_CATEGORIES)
  if(!Number.isSafeInteger(p.verified_counts?.[key]) || p.verified_counts[key]<1)
   throw Error('Full nine-category canonical identity evidence required: '+key);
 return {
  pre_submission_verdict:p.pre_submission.verdict,
  p2_p4_owner_truth:assertP2P4(p),
  p4_p2_handoff_truth:assertP4P2(p),
  p5_p2_finance_truth:assertP5P2(p),
  p3_p6_purchase_cost_truth:assertP3P6(p),
  p4_p6_logistics_cost_truth:assertP4P6(p),
  p5_p6_funds_cost_truth:assertP5P6(p),
  p6_p1_p7_p5_final_truth:assertP6P1P7P5(p),
  identity_status:p.identity_status,
  final_business_verdict:p.checkpoint,
  stage_projections:p.progressive_checkpoints.map(s=>({
   stage:s.stage,status:s.status,missing:[...(s.gaps||[])].sort(),
  })),
  identity_categories:Object.entries(p.verified_counts||{}).sort(([a],[b])=>a.localeCompare(b)),
  adversarial_sql_guard:p.real_sql_mutation_rejected===true?String(p.real_sql_guard_code):'NOT_REJECTED',
  in_memory_detector:[...(p.perturbation_detected||[])].sort(),
 };
};
function comparePaths(first,second){
 if(first.po_shape!=='grouped'||second.po_shape!=='historical')
  throw Error('Expected grouped vs historical evidence pair');
 if(first.persisted_po_shape!=='grouped'||second.persisted_po_shape!=='historical'
   ||first.header_carries_order_item!==false||second.header_carries_order_item!==true)
  throw Error('PO shape assertions must be backed by canonical persisted PO headers');
 assertUnsubmitted(first,'grouped');
 assertUnsubmitted(second,'historical');
 const a=norm(first),b=norm(second);
 const mismatches=[];
 for(const key of Object.keys(a))
  if(JSON.stringify(a[key])!==JSON.stringify(b[key]))
   mismatches.push({field:key,grouped:a[key],historical:b[key]});
 // Early Hub receipt is a deliberately non-equivalent boundary: record the
 // observed result separately instead of pretending it is a Golden mismatch.
 const groupedProbe=first.pre_submission_hub_probe;
 const historicalProbe=second.pre_submission_hub_probe;
 if(!groupedProbe||!historicalProbe)throw Error('Both actual PostgreSQL Hub probes required');
 const earlyHub={
  grouped:groupedProbe,historical:historicalProbe,
  hypothesis:groupedProbe.outcome==='ERROR'||historicalProbe.outcome==='ERROR'
   ? 'PROBE_INCONCLUSIVE'
   : (groupedProbe.outcome!==historicalProbe.outcome
       ? 'EARLY_HUB_RECEIPT_ASYMMETRY_HYPOTHESIS':'NO_EARLY_HUB_OUTCOME_DIFFERENCE'),
 };
 const digest=crypto.createHash('sha256').update(JSON.stringify({a,b,mismatches,earlyHub})).digest('hex');
 return {schema:'golden-po-shape-differential/v1',
  variants:['grouped','historical'],count:2,
  verdict:mismatches.length?'CROSS_PATH_ASYMMETRY_HYPOTHESIS':'NO_ASYMMETRY_OBSERVED',
  mismatchCount:mismatches.length,mismatches,
  normalized:{grouped:a,historical:b},earlyHub,digest,
  caveats:['The same Golden fixture inserts minimal canonical facts; no external provider execution.',
          'Matching outcomes are not a certificate of HTTP/staging or complete P1-P7.',
          'Entity UUIDs are intentionally compared only inside each individual trail, never across runs.'],
 };
}
if(require.main===module){
 const [a,b,out]=process.argv.slice(2);
 if(!a||!b||!out){console.error('Usage: compare-golden-po-paths grouped.json historical.json report.json');process.exit(2)}
 try{
  const report=comparePaths(JSON.parse(fs.readFileSync(a)),JSON.parse(fs.readFileSync(b)));
  fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
  console.log('FP_GOLDEN_PO_DIFF '+JSON.stringify({verdict:report.verdict,mismatches:report.mismatches,earlyHub:report.earlyHub,digest:report.digest}));
  if(report.mismatchCount)process.exitCode=1;
 }catch(e){console.error('FP_GOLDEN_PO_COMPARE_FAILED',e.stack||e);process.exitCode=1}
}
module.exports={norm,comparePaths};
