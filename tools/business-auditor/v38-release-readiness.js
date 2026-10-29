'use strict';
/**
 * G5 fail-closed acceptance. Publication to main requires semantic invariant
 * coverage, an independent withheld-bug benchmark and a reviewed main diff.
 * A green historical CI suite alone is never a release certificate.
 */
const {accepts:acceptsG3}=require('./v40-g3-proof-admission');
const fail=s=>{throw Error('G5_RELEASE_TOOL_ERROR: '+s)};
function readiness({audit,benchmark,impactPlan=null,mainDiff=null}={}){
 if(!audit||audit.contract!=='komerce-unified-business-logic-auditor/v35'||
  !benchmark||benchmark.contract!=='komerce-retrospective-calibration/v38'||
  audit.sha!==benchmark.sha||!/^[a-f0-9]{40}$/.test(audit.sha||''))
  fail('V3.5 evidence and historical benchmark from same SHA required');
 const blockers=[],checks=[];
 function gate(id,pass,evidence){
  checks.push({id,status:pass?'PASS':'BLOCKED',evidence});
  if(!pass)blockers.push(id);
 }
 gate('G1_FLAT_OWNER_PROOFS',
  audit.summary.physicalCasesTotal===12&&audit.summary.partialPhysicalDomains===8&&
  audit.allBusinessDomainsCertified===false&&audit.physicalCaseIndex.every(x=>x.cloneDropped),
  '12 isolated canonical witnesses; 8 partial domains only');
 gate('G2_SEMANTIC_INVARIANT_MAPPING',
  audit.invariantCoverage?.featureCardInvariantsCertified>0&&
  audit.summary?.featureCardSemanticOracleMappingComplete===true&&
  audit.semanticInvariantLedger?.summary?.notCovered===0&&
  typeof audit.invariantCoverage?.summary?.coveragePercent==='number'&&
  audit.invariantCoverage.summary.coveragePercent>=0&&
  audit.invariantCoverage.summary.coveragePercent<=100,
  'Known declarations: '+audit.summary.featureInvariantsDeclared+
  '; semantically certified: '+audit.summary.featureInvariantsCertified+
  '; ratio: '+audit.summary.invariantCoveragePercent);
 gate('G3_AUTONOMOUS_GENERATED_EXPERIMENT',
  acceptsG3(impactPlan,audit.sha),
  impactPlan?.contract||'Only static impact selection, no generated physical fixtures');
 gate('G4_REPLAY_KNOWN_CALIBRATIONS',benchmark.calibrationGate==='PASS'&&
  benchmark.calibration.toolErrors===0&&benchmark.calibration.falsePositive===0,
  'Historical fixed corpus: '+benchmark.calibrationGate+' (not blind)');
 gate('G4_BLIND_OUT_OF_SAMPLE_BENCHMARK',
  benchmark.outOfSample?.independentBlindBenchmarkAccepted===true&&
  benchmark.g4ReleaseGate==='PASS',
  'Withheld independent mutations not yet executed');
 gate('G5_SAFE_MAIN_DIFF',
  Boolean(mainDiff?.contract==='komerce-reviewed-main-integration/v1'&&
   mainDiff?.baseBranch==='main'&&mainDiff?.fullDiffInspected===true&&
   mainDiff?.unrelatedRuntimeChanges===0&&mainDiff?.targetSha===audit.sha&&
   mainDiff?.conflicts===0),
  'Current R&D stack must not merge wholesale; main comparison requires review');
 gate('G5_OPERATOR_DOCUMENTATION_AND_INSTALL',
  Boolean(audit.releaseInstallVerified===true&&audit.releaseModesVerified===true&&
   audit.releaseSafetyVerified===true),
  'Full release smoke and operator instructions still unqualified');
 return {contract:'komerce-independent-business-auditor-release-readiness/v38',
  sha:audit.sha,proposedVersion:'4.0.0',
  decision:blockers.length===0?'GO':'NO_GO',
  mergeMainAuthorized: blockers.length===0,
  protectedProductionWrites:0,
  checks,blockers,
  claims:{currentCodeIsV40Release:false,
   g4HistoricalCasesAreNotBlind:true,
   mainMerged:false,
   productionBugFixProven:false}};
}
function markdown(x){
 return ['# G5 — dossier de décision de livraison','',
  '- SHA testé : '+x.sha,
  '- Version cible : '+x.proposedVersion,
  '- Verdict : **'+x.decision+'**',
  '- Merge sur main autorisé par les contrôles : **'+(x.mergeMainAuthorized?'OUI':'NON')+'**','',
  '| Porte | Statut | Preuve ou lacune |','|---|---|---|',
  ...x.checks.map(c=>'| '+c.id+' | '+c.status+' | '+c.evidence.replace(/\|/g,'/')+' |'),
  '', '## Actions restantes','',
  ...x.blockers.map(id=>'- [ ] '+id),
  '','Aucune promotion vers main ni release tag ne découle de ce rapport.',
  'L’utilisateur peut autoriser la fusion, mais la qualification technique demeure obligatoire.',''].join('\n');
}
module.exports={readiness,markdown};
