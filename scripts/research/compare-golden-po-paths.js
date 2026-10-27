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
 const digest=crypto.createHash('sha256').update(JSON.stringify({a,b,mismatches})).digest('hex');
 return {schema:'golden-po-shape-differential/v1',
  variants:['grouped','historical'],count:2,
  verdict:mismatches.length?'CROSS_PATH_ASYMMETRY_HYPOTHESIS':'NO_ASYMMETRY_OBSERVED',
  mismatchCount:mismatches.length,mismatches,
  normalized:{grouped:a,historical:b},digest,
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
  console.log('FP_GOLDEN_PO_DIFF '+JSON.stringify({verdict:report.verdict,mismatches:report.mismatches,digest:report.digest}));
  if(report.mismatchCount)process.exitCode=1;
 }catch(e){console.error('FP_GOLDEN_PO_COMPARE_FAILED',e.stack||e);process.exitCode=1}
}
module.exports={norm,comparePaths};
