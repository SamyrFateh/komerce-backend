'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {gate}=require('./v50-certification-gate');
const sha='a'.repeat(40);
function evidence(){
 const v49={sha,summary:{verdict:'PASS_PROSPECTIVE_NON_SEALED',TP:6,TN:3,FP:0,FN:0,toolErrors:0},
 records:Array.from({length:9},(_,i)=>({id:i})),sourceMutantIdsPassedToDetector:0,sourceOwnersRestored:true};
 const g2={sha,coverage:{scope:'FULL_REPOSITORY',total:100,executable:100,unsupported:0,unreviewed:0,independentOracleReviewed:true}};
 const g5={sha,blind:{sha,externalEvaluator:true,scannerFrozenBeforeChallenge:true,challengeSealedBeforeRun:true,unknownFaultsDetected:true,falsePositives:0,falseNegatives:0,evidenceUri:'https://example.test/external-evidence'},human:{approved:true,reviewer:'independent-reviewer',evidenceUri:'https://example.test/signoff'}};
 return {v49,g2,g5};
}
test('V50 refuses V49-alone despite perfect nine-case score',()=>{
 const {v49}=evidence(),result=gate({v49});
 assert.equal(result.verdict,'NO_GO');
 assert.ok(result.reasons.includes('G2_COVERAGE_NOT_ATTESTED'));
 assert.ok(result.reasons.includes('G4_EXTERNAL_BLIND_EVIDENCE_MISSING'));
 assert.ok(result.reasons.includes('G5_HUMAN_SIGNOFF_MISSING'));
});
test('V50 refuses partial owner coverage and mismatched source SHA',()=>{
 const data=evidence();data.g2.coverage.unsupported=1;data.g5.sha='b'.repeat(40);
 const r=gate(data);
 assert.equal(r.verdict,'NO_GO');
 assert.ok(r.reasons.includes('G2_COVERAGE_NOT_ATTESTED'));
 assert.ok(r.reasons.includes('G5_HUMAN_SIGNOFF_MISSING'));
});
test('V50 refuses non-sealed benchmark posing as independent review',()=>{
 const data=evidence();data.g5.blind.externalEvaluator=false;
 assert.ok(gate(data).reasons.includes('G4_EXTERNAL_BLIND_EVIDENCE_MISSING'));
});
test('V50 accepts only fully attested, same SHA declarations',()=>{
 const r=gate(evidence());
 assert.equal(r.verdict,'GO_CERTIFICATION_WITH_RECORDED_SCOPE');
 assert.deepEqual(r.reasons,[]);
 assert.match(r.warning,/human verification/);
});
