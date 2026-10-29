'use strict';
/**
 * G4 retrospective calibration against a frozen, EXTERNAL-TO-REPORT truth
 * set. These twelve cases were hand-reviewed and exposed to the developer;
 * therefore perfect recall here is NOT a blind benchmark and NOT evidence
 * that novel business bugs can be found autonomously.
 */
const crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const truth=Object.freeze({
 'FIN-REFUND-BA':{label:'HEALTHY',class:'finance-refund-nominal'},
 'FIN-REFUND-AB':{label:'VIOLATION',class:'finance-refund-adversarial'},
 'LOG-PARCEL-NOMINAL':{label:'HEALTHY',class:'logistics-parcel-nominal'},
 'LOG-PARCEL-CANCELLED':{label:'VIOLATION',class:'logistics-parcel-adversarial'},
 'INV-RECEIVE-NOMINAL':{label:'HEALTHY',class:'inventory-receipt'},
 'INV-RECEIVE-FOREIGN_ORDER':{label:'HEALTHY',class:'inventory-reject-cross-order'},
 'FX-FIXED-PIVOT':{label:'HEALTHY',class:'fx-conversion'},
 'MARKET-LIFECYCLE-GUARD':{label:'HEALTHY',class:'market-guard'},
 'CATALOG-MARKET-EXPOSURE':{label:'HEALTHY',class:'catalogue-market'},
 'AUTH-MARKET-MEMBERSHIP':{label:'HEALTHY',class:'auth-scope'},
 'ORDER-CONFIRMED-TO-ORDERED':{label:'HEALTHY',class:'order-status'},
 'SOURCING-FULL-SNAPSHOT-ARCHIVE':{label:'VIOLATION',class:'sourcing-audit-provenance'}
});
const fail=s=>{throw Error('G4_BENCHMARK_TOOL_ERROR: '+s)};
const ratio=(num,den)=>den?Number((num/den).toFixed(6)):null;
function classify(x){
 if(x?.verdict==='PASS_WITH_EVIDENCE')return 'HEALTHY';
 if(x?.verdict==='BUSINESS_VIOLATION')return 'VIOLATION';
 return 'TOOL_ERROR';
}
function benchmark(report,options={}){
 if(!report||!['komerce-unified-business-logic-auditor/v34',
  'komerce-unified-business-logic-auditor/v35'].includes(report.contract)||
  !/^[a-f0-9]{40}$/.test(report.sha||'')||
  report.physicalCaseIndex?.length!==12||
  report.summary?.physicalCasesTotal!==12||
  report.orchestrator?.recursivelyChainedV30toV33!==false||
  report.allBusinessDomainsCertified!==false)
  fail('report lacks genuine V3.4/V3.5 physical calibration');
 const rows=report.physicalCaseIndex,found=new Set();
 let tp=0,tn=0,fp=0,fn=0,errors=0;
 const records=[];
 for(const entry of rows){
  if(!truth[entry.id]||found.has(entry.id)||entry.cloneDropped!==true||
   !entry.independentOracle)fail('missing/duplicate case or unverified physical owner '+entry.id);
  found.add(entry.id);
  const observed=classify(entry),expected=truth[entry.id].label;
  if(observed==='TOOL_ERROR')errors++;
  else if(expected==='VIOLATION'&&observed==='VIOLATION')tp++;
  else if(expected==='HEALTHY'&&observed==='HEALTHY')tn++;
  else if(expected==='HEALTHY')fp++;
  else fn++;
  records.push({id:entry.id,class:truth[entry.id].class,expected,observed,
   matched:expected===observed,cloneDropped:true});
 }
 if(found.size!==Object.keys(truth).length)fail('frozen truth set incomplete');
 const n=tp+tn+fp+fn+errors;
 const calibration={cases:n,healthy:tn+fp,violations:tp+fn,
  truePositive:tp,trueNegative:tn,falsePositive:fp,falseNegative:fn,
  toolErrors:errors,
  precision:ratio(tp,tp+fp),recall:ratio(tp,tp+fn),
  specificity:ratio(tn,tn+fp),
  accuracy:ratio(tp+tn,n)};
 const pass=errors===0&&fn===0&&fp===0&&n===12&&tp===3&&tn===9;
 const blind=options.blindEvidence||null;
 // Independent blind mutations must come from a separate withheld-source
 // fixture process, not from known counterfactual oracles/handbuilt tests.
 const trueBlind=blind?.contract==='komerce-blind-generated-bug-benchmark/v1'&&
  blind?.withheldFromGenerator===true&&blind?.realOwnerOnIsolatedPg===true&&
  Number.isInteger(blind?.novelMutationCount)&&blind.novelMutationCount>=1&&
  blind?.testedSourceSha===report.sha&&blind?.independentOracle===true&&
  blind?.allClonesDropped===true&&blind?.falsePositives===0&&
  blind?.missedSupportedMutants===0;
 const result={contract:'komerce-retrospective-calibration/v38',
  sha:report.sha,calibration,
  truthSet:{kind:'FROZEN_KNOWN_NONBLIND',hash:sha(truth),
   expectedCases:Object.keys(truth).length,
   explicitlyIncludesKnownAdversarialFixtures:true},
  records,calibrationGate:pass?'PASS':'FAIL',
  outOfSample:{status:trueBlind?'PROVIDED_UNVERIFIED_EXTERNAL_ATTESTATION':'NOT_EXECUTED',
   generatedNovelCases:0,independentBlindBenchmarkAccepted:false,
   evidenceMissing:['SEALED_WITHHELD_MUTATION_HARNESS','OUT_OF_SAMPLE_MEASUREMENTS']},
  g4ReleaseGate:'NO_GO',
  claims:{allBusinessDomainsCertified:false,novelBugDetectionProven:false,
   calibratedReferenceCasesOnly:true,
   fullBenchmarkCertified:false}};
 return result;
}
function markdown(x){
 return ['# G4 — benchmark des douze étalons connus','',
  '- SHA : '+x.sha,
  '- Calibrage témoin : '+x.calibrationGate,
  '- Vrais positifs connus : '+x.calibration.truePositive,
  '- Vrais négatifs connus : '+x.calibration.trueNegative,
  '- Faux positifs : '+x.calibration.falsePositive,
  '- Faux négatifs : '+x.calibration.falseNegative,
  '- Précision sur corpus connu : '+x.calibration.precision,
  '- Rappel sur corpus connu : '+x.calibration.recall,
  '- Échantillon aveugle généré hors entraînement : NON EXÉCUTÉ',
  '- G4 GO pour livraison V4.0 : **'+x.g4ReleaseGate+'**','',
  '| Cas | Vérité figée | Observé | Conforme |',
  '|---|---|---|---|',
  ...x.records.map(r=>'| '+r.id+' | '+r.expected+' | '+r.observed+' | '+r.matched+' |'),
  '','Cette précision ne mesure PAS la détection de nouveaux bugs inconnus ; les cas étaient déjà étalonnés.',
  'Les deux exceptions finance/logistique sont des expériences adversariales attendues, pas des incidents production.',''].join('\n');
}
module.exports={truth,benchmark,markdown};
