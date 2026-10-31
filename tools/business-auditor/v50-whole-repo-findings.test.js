'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {analyze,markdown}=require('./v50-whole-repo-findings');
const sha='a'.repeat(40);
function fixture(){
 const pair=i=>({id:'p'+i,domain:i%2?'finance':'logistics',
  table:i%2?'refunds':'parcel_items',rankScore:100-i,
  ownerSource:'services/payment-paypal.js',actorSources:['routes/orders.js',
   'services/payment-paypal.js'],matchingIndependentRules:[],
  runtimeReachabilityProven:false,crossDomainReview:true});
 const risks=[pair(0),pair(1),pair(2),pair(3)];
 const discovery={contract:'komerce-autonomous-code-diff-discovery/v48',
  sha,selection:{mode:'ALL_REVIEWED_OWNERS'},summary:{ownerErrors:0,
   reviewedOwnersExecuted:5,observedSignals:['SRC3_ARCHIVE_EVENT_OLD_STATE_LOST']},
  ownerSourceFingerprints:Object.fromEntries([
   'services/inventory-service.js','services/fx-authority.js',
   'services/market-operation-guard.js','services/order-status-machine.js',
   'services/sourcing-candidate-import-service.js'].map(x=>[x,'h'])),
  observations:['INVENTORY','FX','MARKET','ORDER','SOURCING'].map(mode=>({
   mode,sourceMutantIdProvided:false,cloneDropped:true,signals:[]}))
 };
 const audit={contract:'komerce-unified-business-logic-auditor/v35',mode:'full',sha,
  sourceDiscovery:{sha,selectionHash:'hash',
   inventory:{coverage:{trackedJsFiles:65,applicationFiles:25,
    canonicalSchemaTables:213},
    summary:{candidateWrites:200,physicalTableCandidates:170,
     notProvenTableCandidates:30,tablesFound:80,
     ownershipReviewCandidates:53,crossDomainReviewCandidates:11}},
   pairs:{reviewQueue:risks,equivalenceClasses:4,unpairedSchemaTables:[
    {table:'cash_collections',domain:'finance',writerCount:1,sqlOccurrences:3}]},
   summary:{priorityUnexecutable:4,singleWriterOrUnpairedTables:1}},
  selectionSha:'hash',
  static:{scannedFiles:65,trackedFiles:65,
   suspicions:2,findings:[{id:'s1',file:'services/refund-handler.js',line:11},
    {id:'s2',file:'services/auto-parcel.js',line:12}]},
  data:{rules:Array.from({length:7},(_,i)=>({id:'KBA-'+(i+1),
   status:'NO_SIGNAL_IN_SAMPLE_QUERY',detectedAtLeast:0}))},
  physicalCaseIndex:Array.from({length:12},(_,i)=>({
    id:'c'+i,domain:i%2?'finance':'logistics',verdict:'PASS_WITH_EVIDENCE',
    cloneDropped:true})),
  semanticInvariantLedger:{byDomain:[{domain:'inventory',certified:3}]},
  summary:{featureInvariantsDeclared:479,featureInvariantsCertified:3}};
 const census={contract:'komerce-feature-invariant-census/v35',
  summary:{declaredInvariants:479},all:Array.from({length:479},(_,i)=>({
   id:'i'+i,domain:'inventory'}))};
 return {audit,discovery,census};
}
test('repository-wide enumerator preserves ALL writer pairs, including non-executable ones',()=>{
 const x=analyze(fixture());
 assert.equal(x.summary.writerPairs,4);
 assert.equal(x.risks.length,4);
 assert.equal(x.summary.writerPairsNotExperimentallyTested,4);
 assert.equal(x.summary.applicationFilesWithoutOwnerHarness,20);
 assert.equal(x.summary.exactInvariantsNotCertified,476);
 assert.equal(x.summary.previouslyUnrecordedProductionBugsConfirmed,0);
 assert.equal(x.domains.find(x=>x.domain==='finance').writerPairs,2);
 assert.ok(markdown(x).includes('NON PROUVÉ'));
});
test('truncation, mixed SHA or missing physical cases is a hard error, never GO',()=>{
 const x=fixture();x.audit.sourceDiscovery.pairs.reviewQueue.pop();
 assert.throws(()=>analyze(x),/V50_WHOLE_REPO_ERROR/);
 const y=fixture();y.discovery.sha='b'.repeat(40);
 assert.throws(()=>analyze(y),/V50_WHOLE_REPO_ERROR/);
 const z=fixture();z.audit.physicalCaseIndex[1].cloneDropped=false;
 assert.throws(()=>analyze(z),/V50_WHOLE_REPO_ERROR/);
});
test('missing owner evidence is NOT counted as broad physical coverage',()=>{
 const x=fixture();x.discovery.summary.reviewedOwnersExecuted=4;
 assert.throws(()=>analyze(x),/V50_WHOLE_REPO_ERROR/);
});
