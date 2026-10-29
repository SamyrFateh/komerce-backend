'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {truth,benchmark}=require('./v38-calibration-benchmark');
const {readiness}=require('./v38-release-readiness');
const sha='d'.repeat(40);
function audit(){
 const cases=Object.entries(truth).map(([id,t])=>({
  id,domain:'test',verdict:t.label==='HEALTHY'?'PASS_WITH_EVIDENCE':'BUSINESS_VIOLATION',
  cloneDropped:true,independentOracle:true}));
 return {contract:'komerce-unified-business-logic-auditor/v35',
  sha,physicalCaseIndex:cases,
  orchestrator:{recursivelyChainedV30toV33:false},
  summary:{physicalCasesTotal:12,partialPhysicalDomains:8,
   featureInvariantsDeclared:478,featureInvariantsCertified:0,
   invariantCoveragePercent:null},
  invariantCoverage:{featureCardInvariantsCertified:0,
   summary:{coveragePercent:null}},
  allBusinessDomainsCertified:false};
}
test('G4 frozen truth set is exactly 12 cases, 3 violations and 9 healthy',()=>{
 assert.equal(Object.keys(truth).length,12);
 assert.equal(Object.values(truth).filter(x=>x.label==='VIOLATION').length,3);
 const x=benchmark(audit());
 assert.equal(x.calibrationGate,'PASS');
 assert.deepEqual([x.calibration.truePositive,x.calibration.trueNegative,
  x.calibration.falsePositive,x.calibration.falseNegative,x.calibration.toolErrors],
  [3,9,0,0,0]);
 assert.equal(x.outOfSample.independentBlindBenchmarkAccepted,false);
 assert.equal(x.g4ReleaseGate,'NO_GO');
});
test('G4 detects one false positive on nominal without relabeling truth',()=>{
 const x=audit();
 x.physicalCaseIndex.find(c=>c.id==='FX-FIXED-PIVOT').verdict='BUSINESS_VIOLATION';
 const b=benchmark(x);
 assert.equal(b.calibrationGate,'FAIL');
 assert.equal(b.calibration.falsePositive,1);
 assert.ok(b.calibration.specificity<1);
});
test('G4 detects a missed known real discrepancy',()=>{
 const x=audit();
 x.physicalCaseIndex.find(c=>c.id==='SOURCING-FULL-SNAPSHOT-ARCHIVE').verdict='PASS_WITH_EVIDENCE';
 const b=benchmark(x);
 assert.equal(b.calibrationGate,'FAIL');
 assert.equal(b.calibration.falseNegative,1);
});
test('G4 refuses missing clone, duplicate identity or another domain',()=>{
 const a=audit();a.physicalCaseIndex[0].cloneDropped=false;
 assert.throws(()=>benchmark(a),/G4_BENCHMARK_TOOL_ERROR/);
 const b=audit();b.physicalCaseIndex[0].id=b.physicalCaseIndex[1].id;
 assert.throws(()=>benchmark(b),/G4_BENCHMARK_TOOL_ERROR/);
});
test('G4 rejects tool error instead of claiming a business pass',()=>{
 const x=audit();x.physicalCaseIndex[0].verdict='TOOL_ERROR';
 const b=benchmark(x);
 assert.equal(b.calibrationGate,'FAIL');
 assert.equal(b.calibration.toolErrors,1);
});
test('G4 refuses to call historical tests an independent blind evaluation',()=>{
 const evidence={contract:'komerce-blind-generated-bug-benchmark/v1',
  withheldFromGenerator:true,realOwnerOnIsolatedPg:true,
  novelMutationCount:3,testedSourceSha:sha,
  independentOracle:true,allClonesDropped:true,
  falsePositives:0,missedSupportedMutants:0};
 const b=benchmark(audit(),{blindEvidence:evidence});
 assert.equal(b.outOfSample.independentBlindBenchmarkAccepted,false);
 assert.equal(b.g4ReleaseGate,'NO_GO');
});
test('G5 no-go is explicit even if fixed known reference corpus is perfect',()=>{
 const a=audit(),b=benchmark(a);const x=readiness({audit:a,benchmark:b});
 assert.equal(x.decision,'NO_GO');
 assert.equal(x.mergeMainAuthorized,false);
 assert.ok(x.blockers.includes('G2_SEMANTIC_INVARIANT_MAPPING'));
 assert.ok(x.blockers.includes('G3_AUTONOMOUS_GENERATED_EXPERIMENT'));
 assert.ok(x.blockers.includes('G4_BLIND_OUT_OF_SAMPLE_BENCHMARK'));
 assert.ok(x.blockers.includes('G5_SAFE_MAIN_DIFF'));
});
test('G5 fail closed on report and benchmark from different commits',()=>{
 const a=audit(),b=benchmark(a);b.sha='f'.repeat(40);
 assert.throws(()=>readiness({audit:a,benchmark:b}),/G5_RELEASE_TOOL_ERROR/);
});
test('G5 never accepts the static-only impact plan as generated physical scenario',()=>{
 const a=audit(),b=benchmark(a);const x=readiness({audit:a,benchmark:b,
  impactPlan:{contract:'komerce-impacted-risk-plan/v36',
   physicalExecutions:0,newGeneratedExperiments:0,sourceSha:sha}});
 assert.ok(x.blockers.includes('G3_AUTONOMOUS_GENERATED_EXPERIMENT'));
});
