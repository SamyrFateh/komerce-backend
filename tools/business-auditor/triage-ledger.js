'use strict';
/**
 * Human-reviewed source findings, exact rule + path only. Conservative:
 * source review is never proof of a defect; the counterexample is still owed.
 * New/moved findings remain unreviewed, never silently exempted.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {SOURCE_BLOBS}=require('./reviewed-blobs');
function gitBlobHash(content){
 const bytes=Buffer.isBuffer(content)?content:Buffer.from(content);
 return crypto.createHash('sha1')
  .update(Buffer.from('blob '+bytes.length+'\0'))
  .update(bytes).digest('hex');
}
function reviewerSourceState(file,options={}){
 if(!options.root)return 'NOT_RECHECKED';
 if(path.isAbsolute(file)||file.split(/[\\/]/).includes('..'))
  return 'INVALID_SOURCE_PATH';
 const expected=SOURCE_BLOBS[file];
 if(!expected)return 'BASELINE_NOT_RECORDED';
 try{
  const read=options.readFile||fs.readFileSync;
  const data=read(path.join(options.root,file));
  return gitBlobHash(data)===expected?'SOURCE_UNCHANGED':'SOURCE_CHANGED_REVIEW_STALE';
 }catch(e){return 'SOURCE_UNAVAILABLE_REVIEW_STALE'}
}
const ENTRY=Object.freeze({
 'LS-04|routes/admin/system.js': ['ADMIN_FIXTURE_WRITER','NEEDS_SCOPE_REVIEW','Admin system fixture/seeding endpoint, verify disabled or guarded in real deployments'],
 'LS-04|routes/parcels.js': ['DIRECT_RUNTIME_WRITER','TARGETED_NEGATIVE_TEST','DELETE /api/parcels/:id/items/:item_id bypasses traced add owner; verify transition and audit effects'],
 'LS-03|routes/wallet.js': ['FINANCIAL_REQUEST_IDENTITY','TARGETED_RETRY_TEST','Admin credit uses Date.now request key: replay same request across time and inspect durable idempotence'],
 'LS-04|scripts/research/golden-parcel-maturity-pg.js': ['DISPOSABLE_RESEARCH_FIXTURE','NOT_RUNTIME_PROOF','Research SQL intentionally creates parcel membership'],
 'LS-04|scripts/research/golden-shared-multiorder-handoff-pg.js': ['DISPOSABLE_RESEARCH_FIXTURE','NOT_RUNTIME_PROOF','Shared parcel research fixture; preserve sample but do not count runtime exposure'],
 'LS-04|scripts/seed-a8-staging-two-orders.js': ['ONE_OFF_DATA_SEED','NEEDS_SCOPE_REVIEW','Seed script may write staging if manually executed: verify operational permissions and retirement'],
 'LS-04|services/auto-parcel.js': ['DIRECT_RUNTIME_WRITER','TARGETED_NEGATIVE_TEST','Writes parcel_items outside canonical membership service; verify same-market, stock and uniqueness'],
 'LS-05|services/auto-parcel.js': ['SILENT_CONFLICT_AND_COUNT','TARGETED_NEGATIVE_TEST','SQL ignore-on-conflict followed by assigned++ without checking rowCount; verify response count on duplicate'],
 'LS-04|services/parcel-auto-create-service.js': ['DIRECT_RUNTIME_WRITER','TARGETED_NEGATIVE_TEST','Per-item savepoint rollback is silent: verify parcel header and item memberships stay consistent'],
 'LS-05|services/parcel-item-mutation-service.js': ['CANONICAL_OWNER_OPERATION','EXPECTED_OWNER_PATTERN','Canonical membership owner intentionally uses conflict fallback; verify caller interprets rowCount'],
 'LS-04|services/parcel-operations.js': ['DIRECT_RUNTIME_WRITER','TARGETED_NEGATIVE_TEST','Partial parcel membership direct SQL; verify quantity and owning lifecycle'],
 'LS-04|services/parcelOptimizationService.js': ['DIRECT_RUNTIME_WRITER','TARGETED_NEGATIVE_TEST','Legacy optimization persists parcel lines; verify whether production entrypoints remain active'],
 'LS-05|services/parcelOptimizationService.js': ['SILENT_CONFLICT_AND_COUNT','TARGETED_NEGATIVE_TEST','SQL ignore-on-conflict then totalAssigned++ without rowCount test; verify duplicates and reporting'],
 'LS-06|services/payment-paypal.js': ['EXTERNAL_PSP_SIDE_EFFECT','NEEDS_TRANSACTION_TRACE','Capture and refund PSP calls; check durable intent/idempotency and post-response reconciliation'],
 'LS-01|services/payment-service.js': ['CANONICAL_OWNER_OPERATION','EXPECTED_OWNER_PATTERN','Guarded payment_status writer uses payment-status-validator, not automatically a bypass of order status'],
 'LS-03|services/paypal-client.js': ['FINANCIAL_REQUEST_IDENTITY','TARGETED_RETRY_TEST','Fallback PayPal-Request-Id uses Date.now when no persistent providerRequestKey; determine reachable callers'],
 'LS-06|services/refund-service.js': ['EXTERNAL_PSP_SIDE_EFFECT','NEEDS_TRANSACTION_TRACE','Stripe refund carries stable idempotencyKey and inserts pending first; review transaction commit and recovery path'],
 'LS-04|services/simulator/cleanup.js': ['SIMULATOR_WRITER','NOT_RUNTIME_PROOF','Simulator cleanup SQL; check segregation from real business and production access'],
 'LS-04|services/simulator/state-advancer.js': ['SIMULATOR_WRITER','NOT_RUNTIME_PROOF','Simulator state advancement; check segregation from real business'],
 'LS-04|tools/business-auditor/v15-concurrency-runner.js': ['DISPOSABLE_PG_PROOF_HARNESS','NOT_RUNTIME_PROOF','Committed fixture seeding in isolated local komerce_test; deleted and checked after two-connection physical race; not a production writer'],
 'LS-04|tools/business-auditor/v12-physical-parcel-runner.js': ['DISPOSABLE_PG_PROOF_HARNESS','NOT_RUNTIME_PROOF','Auditor harness alone pre-seeds physical temp parcel_items to demonstrate conflict; not production application writer'],
 'LS-05|tools/business-auditor/v12-physical-parcel-runner.js': ['DISPOSABLE_PG_PROOF_HARNESS','NOT_RUNTIME_PROOF','Harness checks the SQL emitted by the real owner and captures physical rowCount; keyword match is not another service-level conflict bug'],
 'LS-03|tools/business-auditor/code-detectors.test.js': ['TEST_SOURCE_FALSE_POSITIVE','NOT_RUNTIME_PROOF','Synthetic clock-based request key in scanner test: the source is not an executing financial writer'],
 'LS-01|tools/business-auditor/engine.test.js': ['TEST_SOURCE_FALSE_POSITIVE','NOT_RUNTIME_PROOF','SQL guard test contains literal UPDATE orders; no runtime business writer'],
 'LS-06|utils/refunds.js': ['EXTERNAL_PSP_SIDE_EFFECT','TARGETED_RETRY_TEST','Stripe refund call lacks explicit idempotency key in this helper; verify reachability before declaring vulnerability'],
});
const PRIOR_EVIDENCE=Object.freeze({
 'LS-05|services/auto-parcel.js':Object.freeze({
  issue:2949,level:'SERVICE_MOCK_REPRODUCED_NOT_PHYSICAL_PG',
  observation:'Earlier issue #2949 reports rowCount=0 yet items_assigned=1 in 2/2 service-mock tests; real PostgreSQL concurrency still required',
 }),
});
const key=f=>String(f.rule)+'|'+String(f.file);
function qualifyStaticTriage(rows,options={}){
 const cache=new Map();
 return rows.map(t=>{
  const entry=ENTRY[key(t)];
  if(!cache.has(t.file))cache.set(t.file,reviewerSourceState(t.file,options));
  const sourceState=cache.get(t.file);
  const currentReviewValid=options.root?Boolean(entry&&sourceState==='SOURCE_UNCHANGED'):null;
  return {...t,
   reviewerSourceState:sourceState,
   reviewedSourceBlob:SOURCE_BLOBS[t.file]||null,
   currentReviewValid,
   evidenceReview:entry?entry[0]:'UNREVIEWED',
   proposedTest:entry?entry[1]:'OWNER_REVIEW_REQUIRED',
   groundedObservation:entry?entry[2]:'New signal: inspect source and design nominal/counterexample',
   reviewedFromSource:Boolean(entry),
   priorEvidence:PRIOR_EVIDENCE[key(t)]||null,
   // No static code review ever proves runtime exploitability or a money error.
   confirmedBug:false};
 });
}
function triageCounts(rows){
 const groups={},risk=[];
 for(const t of rows){
  groups[t.evidenceReview]=(groups[t.evidenceReview]||0)+1;
  if(['TARGETED_NEGATIVE_TEST','TARGETED_RETRY_TEST','NEEDS_TRANSACTION_TRACE'].includes(t.proposedTest))risk.push({
   file:t.file,line:t.line,rule:t.rule,owner:t.owner,observation:t.groundedObservation,proposedTest:t.proposedTest});
 }
 return {byReview:groups,targetedCandidateCount:risk.length,targetedCandidates:risk,
  currentReviewsVerified:rows.filter(t=>t.currentReviewValid===true).length,
  staleOrUnknownReviews:rows.filter(t=>t.currentReviewValid===false).length};
}
module.exports={ENTRY,PRIOR_EVIDENCE,gitBlobHash,reviewerSourceState,qualifyStaticTriage,triageCounts};
