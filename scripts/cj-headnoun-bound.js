#!/usr/bin/env node
/** @komerce-arch-lite
 * @role cj498-opus-one-shot-reuse-upper-bound
 * @domain catalog
 * @layer tooling
 * @owner backend-core
 * @purpose One-shot frozen A→B maximum-reuse calculation before human family review; no classification writes.
 * @db-read none
 * @db-write none
 * @impact-areas catalog,sourcing,isolated-ci,offline-rd
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {loadInputs,buildA,keyFromTitle}=require('./cj-headnoun-ab-experiment');
const SHA='9ff18f6f902f2e72fc893a90da96b61058c77028d55e941381631fc9fb8116de';
function bound(rows,threshold=3) {
 if(!Number.isInteger(threshold)||threshold<1)throw Error('INVALID_PREDECLARED_THRESHOLD');
 const A=buildA(rows,[]);
 const keys=new Set(A.families.filter(f=>f.priority>=threshold).map(f=>f.key));
 // Key selection is based entirely on A. Inspect B exactly once after it is fixed.
 const B=rows.filter(r=>r.split==='B');
 const review=B.filter(r=>r.v1.status==='REVIEW_REQUIRED');
 const hits=B.map(r=>({ref:r.ref,v1_status:r.v1.status,title:r.title,
  key:keyFromTitle(r.title,r.root,[])?.key||null}))
  .filter(r=>r.key&&keys.has(r.key));
 const reviewHits=hits.filter(r=>r.v1_status==='REVIEW_REQUIRED');
 const rate=review.length?reviewHits.length/review.length:null;
 const decision=rate!==null&&rate<.25
  ?'NO_GO_UNDER_OPUS_25_PERCENT_REUSE_THRESHOLD'
  :'POTENTIALLY_ELIGIBLE_BUT_REQUIRES_REAL_HUMAN_REVIEW_AND_GOLD';
 return {
  method:'OPTIMISTIC_UPPER_BOUND_NOT_HUMAN_APPROVAL',
  source_sha256:SHA,certification:'NOT_CERTIFIED',
  split:'FROZEN_A_TO_B_INTERNAL_HOLDOUT_PREVIOUSLY_EXPLORED',
  priority_threshold:threshold,
  A_products:rows.filter(r=>r.split==='A').length,
  A_candidate_families:A.families.length,
  A_eligible_families:keys.size,
  A_eligible_product_refs:A.families.filter(f=>f.priority>=threshold).reduce((n,f)=>n+f.count,0),
  B_products:B.length,B_review_products:review.length,
  B_potential_reuse_all_statuses:hits.length,
  B_potential_reuse_review:reviewHits.length,
  B_review_max_coverage_rate:rate,
  reused_review_matches:reviewHits,
  decision,
  notes:[
   'No human family APPROVE decisions exist; this assumes ALL A families >= threshold are perfectly approved.',
   'False families, exceptions and reviewer time can only reduce useful reuse; theoretical rate is an upper bound for these fixed keys.',
   'The predeclared Opus test reviews only A families with size * distinct-segments >= 3. Threshold 2 is a sensitivity check, not a new design.',
   'B was used for the terminal decision; do NOT adjust keys/stop words or rerun experiments to improve holdout numbers.',
   '95% precision, human time savings, true supplier generalization and category correctness are NOT measured.',
   'Decision applies to head-noun family reuse on CJ498, NOT the existing V1 commercial classifier.'
  ]
 };
}
function main(argv){
 const [source,v1,dest]=argv;
 if(!source||!v1||!dest)throw Error('Usage: node scripts/cj-headnoun-bound.js <frozen-source.json> <v1-decisions.json> <output-directory>');
 const rows=loadInputs(source,v1);
 // Pre-specified primary stop rule plus one less selective sensitivity check.
 const primary=bound(rows,3),sensitivity=bound(rows,2);
 fs.mkdirSync(dest,{recursive:true});
 const report={status:'ONE_SHOT_EXPERIMENT_TERMINATED',
  primary,sensitivity,
  final_decision:primary.decision,
  recommendation:primary.decision.startsWith('NO_GO')
   ?'Do not ask for 11 unnecessary human reviews. Preserve V1, close this R&D iteration and proceed to canonical business E2E.'
   :'Proceed to independently timed human A review before opening any more B labels.',
  human_approvals:0,measured_precision:null,measured_human_minutes:null,
  production_changes:0};
 fs.writeFileSync(path.join(dest,'B-theoretical-reuse-bound.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({A:primary.A_products,B:primary.B_products,
  A_eligible_families:primary.A_eligible_families,
  B_review:primary.B_review_products,
  B_reuse_max:primary.B_potential_reuse_review,
  rate:primary.B_review_max_coverage_rate,
  sensitivity_B_reuse_max:sensitivity.B_potential_reuse_review,
  decision:primary.decision,certification:'NOT_CERTIFIED'}));
 return report;
}
if(require.main===module){try{main(process.argv.slice(2))}catch(e){
 console.error('[OPUS_ONE_SHOT_BOUND] '+e.message);process.exitCode=1;
}}
module.exports={bound,main};
