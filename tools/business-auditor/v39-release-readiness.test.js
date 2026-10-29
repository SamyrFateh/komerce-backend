'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {check,markdown}=require('./v39-release-readiness');
const sha='a'.repeat(40),registry='b'.repeat(64);
function evidence(){
 return {
  unified:{contract:'komerce-unified-business-logic-auditor/v35',
   sha,coverage:['sourcing','pricing','catalogue','orders','finance','inventory','logistics','authorization']
    .map(domain=>({domain,status:'CALIBRATED_PARTIAL'})),
   summary:{physicalCasesTotal:12,partialPhysicalDomains:8},
   orchestrator:{recursivelyChainedV30toV33:false,
    legacyV29GatewayCalls:1,reviewedPhysicalAdapters:['inv','fx','catalog','orders']},
   allBusinessDomainsCertified:false,
   invariantCoverage:{registryHash:registry,metrics:{
    cards:36,declared:478,textOnly:244,declaredWithTest:234,
    independentlyCertifiedInvariants:0}}},
  targeted:{contract:'komerce-targeted-business-audit/v36',sha,
   featureRegistryHash:registry,summary:{physicallyExecutedCases:2},
   selection:{plannedClones:2,cloneBudget:2}},
  generated:{contract:'komerce-generated-order-matrix-gate/v37',sha,
   plan:{scenarioCount:24},
   cases:[{oracle:{violation:false}},{oracle:{violation:true}}],
   hiddenMutationDetectedWithoutScenarioCodeEdit:true},
  benchmark:{contract:'komerce-supported-class-blind-benchmark/v38',sha,
   registryHash:registry,confusion:{tp:4,fp:0,fn:0,tn:56,total:60},
   limits:{hiddenMutationClassCount:1,notAReleaseGO:true}}
 };
}
test('true evidence reports non-GO on incomplete linkage, narrow generated classes and no release review',()=>{
 const r=check(evidence());
 assert.equal(r.verdict,'NO_GO');
 assert.equal(r.releaseAllowed,false);
 assert.equal(r.summary.totalGates,6);
 assert.deepEqual(r.gates.slice(0,2).map(g=>g.status),['PASS','PASS']);
 assert.ok(r.blockers.includes('INDEPENDENT_INVARIANT_LINKAGE_INCOMPLETE'));
 assert.ok(r.blockers.includes('GENERATOR_FAMILIES_TOO_NARROW'));
 assert.ok(r.blockers.includes('BLIND_MUTATION_CLASS_DIVERSITY_MISSING'));
 assert.ok(r.blockers.includes('FLAKINESS_REPLICATIONS_NOT_MEASURED'));
 assert.ok(r.blockers.includes('EXPLICIT_EXTERNAL_HUMAN_RELEASE_GATE_REQUIRED'));
 assert.match(markdown(r),/NO_GO/);
});
test('mixed SHA or feature registry hashes hard-fail',()=>{
 const e=evidence();e.generated.sha='c'.repeat(40);
 assert.throws(()=>check(e),/V39_RELEASE_GATE_TOOL_ERROR/);
 e.generated.sha=sha;e.benchmark.registryHash='d'.repeat(64);
 assert.throws(()=>check(e),/V39_RELEASE_GATE_TOOL_ERROR/);
});
test('passing the currently narrow accuracy benchmark never claims V4 production release',()=>{
 const r=check(evidence(),true);
 assert.equal(r.summary.benchmarkSamples,60);
 assert.equal(r.verdict,'NO_GO');
 assert.equal(r.noAutomaticMergeOrRelease,true);
});
test('a broken historical calibration is a GO/NO-GO blocker',()=>{
 const e=evidence();e.unified.summary.physicalCasesTotal=11;
 const r=check(e);
 assert.ok(r.blockers.includes('BASELINE_12_CLONES_MISSING'));
});
