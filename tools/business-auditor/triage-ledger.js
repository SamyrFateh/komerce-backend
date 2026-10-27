'use strict';
/**
 * Human-reviewed source findings, exact rule + path only. Conservative:
 * source review is never proof of a defect; the counterexample is still owed.
 * New/moved findings remain unreviewed, never silently exempted.
 */
const ENTRY=Object.freeze({
 'LS-04|routes/admin/system.js': ['ADMIN_FIXTURE_WRITER','NEEDS_SCOPE_REVIEW','Admin system fixture/seeding endpoint, verify disabled or guarded in real deployments'],
 'LS-04|routes/parcels.js': ['DIRECT_RUNTIME_WRITER','TARGETED_NEGATIVE_TEST','DELETE /api/parcels/:id/items/:item_id bypasses traced add owner; verify transition and audit effects'],
 'LS-03|routes/wallet.js': ['FINANCIAL_REQUEST_IDENTITY','TARGETED_RETRY_TEST','Admin credit uses Date.now request key: replay same request across time and inspect durable idempotence'],
 'LS-04|scripts/research/golden-parcel-maturity-pg.js': ['DISPOSABLE_RESEARCH_FIXTURE','NOT_RUNTIME_PROOF','Research SQL intentionally creates parcel membership'],
 'LS-04|scripts/research/golden-shared-multiorder-handoff-pg.js': ['DISPOSABLE_RESEARCH_FIXTURE','NOT_RUNTIME_PROOF','Shared parcel research fixture; preserve sample but do not count runtime exposure'],
 'LS-04|scripts/seed-a8-staging-two-orders.js': ['ONE_OFF_DATA_SEED','NEEDS_SCOPE_REVIEW','Seed script may write staging if manually executed: verify operational permissions and retirement'],
 'LS-04|services/auto-parcel.js': ['DIRECT_RUNTIME_WRITER','TARGETED_NEGATIVE_TEST','Writes parcel_items outside canonical membership service; verify same-market, stock and uniqueness'],
 'LS-05|services/auto-parcel.js': ['SILENT_CONFLICT_AND_COUNT','TARGETED_NEGATIVE_TEST','ON CONFLICT DO NOTHING followed by assigned++ without checking rowCount; verify response count on duplicate'],
 'LS-04|services/parcel-auto-create-service.js': ['DIRECT_RUNTIME_WRITER','TARGETED_NEGATIVE_TEST','Per-item savepoint rollback is silent: verify parcel header and item memberships stay consistent'],
 'LS-05|services/parcel-item-mutation-service.js': ['CANONICAL_OWNER_OPERATION','EXPECTED_OWNER_PATTERN','Canonical membership owner intentionally uses conflict fallback; verify caller interprets rowCount'],
 'LS-04|services/parcel-operations.js': ['DIRECT_RUNTIME_WRITER','TARGETED_NEGATIVE_TEST','Partial parcel membership direct SQL; verify quantity and owning lifecycle'],
 'LS-04|services/parcelOptimizationService.js': ['DIRECT_RUNTIME_WRITER','TARGETED_NEGATIVE_TEST','Legacy optimization persists parcel lines; verify whether production entrypoints remain active'],
 'LS-05|services/parcelOptimizationService.js': ['SILENT_CONFLICT_AND_COUNT','TARGETED_NEGATIVE_TEST','ON CONFLICT DO NOTHING then totalAssigned++ without rowCount test; verify duplicates and reporting'],
 'LS-06|services/payment-paypal.js': ['EXTERNAL_PSP_SIDE_EFFECT','NEEDS_TRANSACTION_TRACE','Capture and refund PSP calls; check durable intent/idempotency and post-response reconciliation'],
 'LS-01|services/payment-service.js': ['CANONICAL_OWNER_OPERATION','EXPECTED_OWNER_PATTERN','Guarded payment_status writer uses payment-status-validator, not automatically a bypass of order status'],
 'LS-03|services/paypal-client.js': ['FINANCIAL_REQUEST_IDENTITY','TARGETED_RETRY_TEST','Fallback PayPal-Request-Id uses Date.now when no persistent providerRequestKey; determine reachable callers'],
 'LS-06|services/refund-service.js': ['EXTERNAL_PSP_SIDE_EFFECT','NEEDS_TRANSACTION_TRACE','Stripe refund carries stable idempotencyKey and inserts pending first; review transaction commit and recovery path'],
 'LS-04|services/simulator/cleanup.js': ['SIMULATOR_WRITER','NOT_RUNTIME_PROOF','Simulator cleanup SQL; check segregation from real business and production access'],
 'LS-04|services/simulator/state-advancer.js': ['SIMULATOR_WRITER','NOT_RUNTIME_PROOF','Simulator state advancement; check segregation from real business'],
 'LS-01|tools/business-auditor/engine.test.js': ['TEST_SOURCE_FALSE_POSITIVE','NOT_RUNTIME_PROOF','SQL guard test contains literal UPDATE orders; no runtime business writer'],
 'LS-06|utils/refunds.js': ['EXTERNAL_PSP_SIDE_EFFECT','TARGETED_RETRY_TEST','Stripe refund call lacks explicit idempotency key in this helper; verify reachability before declaring vulnerability'],
});
const key=f=>String(f.rule)+'|'+String(f.file);
function qualifyStaticTriage(rows){
 return rows.map(t=>{
  const entry=ENTRY[key(t)];
  return {...t,
   evidenceReview:entry?entry[0]:'UNREVIEWED',
   proposedTest:entry?entry[1]:'OWNER_REVIEW_REQUIRED',
   groundedObservation:entry?entry[2]:'New signal: inspect source and design nominal/counterexample',
   reviewedFromSource:Boolean(entry),
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
 return {byReview:groups,targetedCandidateCount:risk.length,targetedCandidates:risk};
}
module.exports={ENTRY,qualifyStaticTriage,triageCounts};
