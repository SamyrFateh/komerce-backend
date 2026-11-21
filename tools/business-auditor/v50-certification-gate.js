#!/usr/bin/env node
'use strict';
/**
 * V50 certification gate. Fail closed: successful V49 non-sealed tests are NOT
 * evidence of independent blind discovery or exhaustive business coverage.
 * Run: node tools/business-auditor/v50-certification-gate.js --v49 PATH --g2 PATH --g5 PATH
 * Evidence inputs must be immutable CI artifacts for the SAME source SHA.
 */
const fs=require('node:fs'),crypto=require('node:crypto');
const sha256=s=>crypto.createHash('sha256').update(s).digest('hex');
const SHA=/^[a-f0-9]{40}$/;
function gate({v49,g2,g5}) {
  const reasons=[];
  const bad=(name,condition)=>{if(!condition)reasons.push(name);};
  const sha=v49?.sha;
  bad('V49_SHA_INVALID',SHA.test(sha||''));
  bad('V49_BENCHMARK_NOT_PASS',v49?.summary?.verdict==='PASS_PROSPECTIVE_NON_SEALED' &&
    v49.summary.TP===6 && v49.summary.TN===3 &&
    v49.summary.FP===0 && v49.summary.FN===0 && v49.summary.toolErrors===0 &&
    v49.records?.length===9 &&
    v49.sourceMutantIdsPassedToDetector===0 &&
    v49.sourceOwnersRestored===true);
  bad('G2_EVIDENCE_MISSING_OR_OTHER_SHA',g2?.sha===sha && SHA.test(sha||''));
  bad('G2_COVERAGE_NOT_ATTESTED',g2?.coverage?.scope==='FULL_REPOSITORY' &&
    Number.isSafeInteger(g2.coverage.total) && g2.coverage.total>0 &&
    g2.coverage.executable===g2.coverage.total &&
    g2.coverage.unsupported===0 && g2.coverage.unreviewed===0 &&
    g2.coverage.independentOracleReviewed===true);
  bad('G4_EXTERNAL_BLIND_EVIDENCE_MISSING',g5?.blind?.sha===sha &&
    g5.blind.externalEvaluator===true &&
    g5.blind.scannerFrozenBeforeChallenge===true &&
    g5.blind.challengeSealedBeforeRun===true &&
    g5.blind.unknownFaultsDetected===true &&
    g5.blind.falsePositives===0 && g5.blind.falseNegatives===0 &&
    typeof g5.blind.evidenceUri==='string' && g5.blind.evidenceUri.length>0);
  bad('G5_HUMAN_SIGNOFF_MISSING',g5?.sha===sha &&
    g5.human?.approved===true &&
    typeof g5.human?.reviewer==='string' && g5.human.reviewer.trim().length>0 &&
    typeof g5.human?.evidenceUri==='string' && g5.human.evidenceUri.length>0);
  return {contract:'komerce-v50-certification-gate/v1',sha:SHA.test(sha||'')?sha:null,
    verdict:reasons.length?'NO_GO':'GO_CERTIFICATION_WITH_RECORDED_SCOPE',
    reasons,warning:'Reports are declarations; provenance and independence require human verification.'};
}
function cli(args) {
  if(args.length!==6||args[0]!=='--v49'||args[2]!=='--g2'||args[4]!=='--g5')
    throw Error('Usage: --v49 FILE --g2 FILE --g5 FILE');
  const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
  return gate({v49:read(args[1]),g2:read(args[3]),g5:read(args[5])});
}
if(require.main===module){
  try {const result=cli(process.argv.slice(2));console.log(JSON.stringify(result,null,2));
    if(result.reasons.length)process.exitCode=1;}
  catch(e){console.error('V50_NO_GO '+e.message);process.exitCode=1;}
}
module.exports={gate,cli};
