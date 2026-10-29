'use strict';
function compare(baseline,record){
 if(baseline?.contract!=='komerce-business-concurrency-baseline/v15'||
  record?.contract!=='komerce-physical-concurrency-proof/v15'||
  record.verdict?.contract!=='komerce-canonical-pg-concurrency-predicate/v15')
  throw Error('TOOL_ERROR: missing V1.5 baseline or physical proof');
 const actual={
  verdict:record.verdict.verdict,
  sequentialMax:record.verdict.sequential.maximum,
  concurrentMax:record.verdict.concurrent.maximum,
  limit:record.verdict.capacity,
  cleanup:record.raw?.allFixturesDeleted
 };
 const expected={
  verdict:baseline.expectedVerdict,
  sequentialMax:baseline.expectedSequentialMax,
  concurrentMax:baseline.expectedConcurrentMax,
  limit:baseline.expectedLimit,
  cleanup:baseline.expectedCleanupVerified
 };
 const changes=Object.keys(expected).filter(k=>actual[k]!==expected[k])
  .map(k=>({field:k,expected:expected[k],observed:actual[k]}));
 return {contract:'komerce-business-concurrency-baseline-gate/v15',
  outcome:changes.length?'REVIEW_REQUIRED':'BASELINE_MATCH',
  changes,issue:baseline.issue,
  productionIncidentConfirmed:false,
  note:'Known research candidate remains a defect to investigate even on baseline match'};
}
module.exports={compare};
