'use strict';
/**
 * G4 pilot: a FROZEN external truth table scores the physical evidence.
 * Never derive expected labels from the scanner's own oracle/verdict.
 * This benchmarks KNOWN covered cases, not unknown future bug classes.
 */
const crypto=require('node:crypto');
const hash=o=>crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const TRUTH=Object.freeze({
 'FIN-REFUND-BA':'CLEAN',
 'LOG-PARCEL-NOMINAL':'CLEAN',
 'FIN-REFUND-AB':'BUG',
 'LOG-PARCEL-CANCELLED':'BUG',
 'INV-RECEIVE-NOMINAL':'CLEAN',
 'INV-RECEIVE-FOREIGN_ORDER':'CLEAN',
 'FX-FIXED-PIVOT':'CLEAN',
 'MARKET-LIFECYCLE-GUARD':'CLEAN',
 'CATALOG-MARKET-EXPOSURE':'CLEAN',
 'AUTH-MARKET-MEMBERSHIP':'CLEAN',
 'ORDER-CONFIRMED-TO-ORDERED':'CLEAN',
 'SOURCING-FULL-SNAPSHOT-ARCHIVE':'BUG'
});
const BLIND_CLASS=Object.freeze({
 name:'ORDER_PATCH_ROLE_BYPASS_IN_MEMORY',
 role:'agent_relais',target:'ordered',
 affectedStartStatus:'confirmed',
 sourceMutationNotKnownToGenerator:true
});
function fail(s){throw Error('V38_BENCHMARK_TOOL_ERROR: '+s)}
function matrix(rows){
 const cm={tp:0,fp:0,tn:0,fn:0};
 for(const r of rows){
  if(r.actual==='BUG'&&r.detected)cm.tp++;
  else if(r.actual==='BUG'&&!r.detected)cm.fn++;
  else if(r.actual==='CLEAN'&&r.detected)cm.fp++;
  else if(r.actual==='CLEAN'&&!r.detected)cm.tn++;
  else fail('invalid outcome');
 }
 const pos=cm.tp+cm.fn,neg=cm.fp+cm.tn;
 return {...cm,total:rows.length,positives:pos,negatives:neg,
  precision:cm.tp+cm.fp?cm.tp/(cm.tp+cm.fp):null,
  recall:pos?cm.tp/pos:null,
  falsePositiveRate:neg?cm.fp/neg:null,
  falseNegativeRate:pos?cm.fn/pos:null,
  explicitlyCoveredSamplesOnly:true,
  arbitraryFutureBugRecallNotMeasurable:true};
}
function build(baseline,generated){
 if(baseline?.contract!=='komerce-unified-business-logic-auditor/v35'||
  generated?.contract!=='komerce-generated-order-matrix-gate/v37'||
  !/^[a-f0-9]{40}$/.test(baseline.sha||'')||
  baseline.sha!==generated.sha||
  !Array.isArray(baseline.physicalCaseIndex)||
  baseline.physicalCaseIndex.length!==Object.keys(TRUTH).length||
  !generated.allClonesDropped||
  generated.plan?.scenarioCount!==24||
  generated.plan.sourceMutantKnownToGenerator!==false||
  generated.cases?.length!==2||
  generated.cases[0].mode!=='NOMINAL'||generated.cases[1].mode!=='BLIND_MUTANT')
  fail('source, isolated clone evidence or case model missing');
 const checks=[];
 for(const e of baseline.physicalCaseIndex){
  const expected=TRUTH[e.id];
  if(!expected||e.cloneDropped!==true||
   !['BUSINESS_VIOLATION','PASS_WITH_EVIDENCE'].includes(e.verdict))
   fail('unknown/unproven physical calibration '+e.id);
  checks.push({id:e.id,cohort:'EXISTING_CALIBRATED_WITNESS',
   actual:expected,detected:e.verdict==='BUSINESS_VIOLATION',
   frozenTruthSource:'v38-independent-fixture-truth'});
 }
 if(new Set(checks.map(x=>x.id)).size!==Object.keys(TRUTH).length)
  fail('missing frozen known case(s)');
 const [normal,mutated]=generated.cases;
 if(normal.oracle?.scenarios!==24||mutated.oracle?.scenarios!==24||
  normal.oracle.violation!==false||mutated.oracle.violation!==true||
  normal.oracle.policyHash!==mutated.oracle.policyHash||
  normal.oracle.results?.length!==24||mutated.oracle.results?.length!==24)
  fail('generated oracle/provenance inconsistent');
 const original=new Map(normal.oracle.results.map(x=>[x.scenarioId,x]));
 const mutant=new Map(mutated.oracle.results.map(x=>[x.scenarioId,x]));
 if(original.size!==24||mutant.size!==24||[...original.keys()].some(x=>!mutant.has(x)))
  fail('generated baseline/mutant cases not identical');
 for(const [mode,items] of [['NOMINAL',normal.oracle.results],['BLIND_MUTANT',mutated.oracle.results]]){
  for(const r of items){
   if(typeof r.role!=='string'||typeof r.target!=='string'||
    !Array.isArray(r.signals))fail('missing per-case prediction');
   const actual=mode==='BLIND_MUTANT'&&r.role===BLIND_CLASS.role&&
    r.target===BLIND_CLASS.target?'BUG':'CLEAN';
   checks.push({id:mode+':'+r.scenarioId,cohort:'GENERATED_ORDER_ROLE_MATRIX',
    actual,detected:r.signals.length>0,
    frozenTruthSource:'v38-independent-blind-injection-scope',
    role:r.role,target:r.target});
  }
 }
 if(new Set(checks.map(x=>x.id)).size!==checks.length)
  fail('duplicate benchmark identity');
 const combined=matrix(checks);
 const byCohort=['EXISTING_CALIBRATED_WITNESS','GENERATED_ORDER_ROLE_MATRIX']
  .map(cohort=>({cohort,...matrix(checks.filter(x=>x.cohort===cohort))}));
 return {contract:'komerce-supported-class-blind-benchmark/v38',
  sha:baseline.sha,
  registryHash:baseline.invariantCoverage?.registryHash||null,
  frozenTruthHash:hash({TRUTH,BLIND_CLASS}),
  source:'FROZEN_TEST_TRUTH_NOT_OWNER_ORACLE_OUTPUT',
  confusion:combined,byCohort,checks,
  limits:{
   benchmarkSupportedClassesOnly:true,
   hiddenMutationClassCount:1,
   repeatedIndependentFaultFamilies:0,
   notAStatisticalEstimateOfProductionBugRecall:true,
   notAReleaseGO:true,
   noNewOwnerMutationInThisBenchmark:true},
  fullDomainBusinessCertification:false,
  productionIncidentConfirmed:false};
}
function digest(b){
 const m=b.confusion;
 return [
  '# G4 — Benchmark initial à vérité de référence figée','',
  '- SHA de code : '+b.sha,
  '- Empreinte vérité indépendante : '+b.frozenTruthHash,
  '- Témoins classés : '+m.total+' ('+m.positives+' anomalies, '+m.negatives+' contrôles sains)',
  '- TP / FN / FP / TN : '+[m.tp,m.fn,m.fp,m.tn].join(' / '),
  '- Precision sur ces classes : '+(m.precision===null?'NOT_MEASURABLE':(m.precision*100).toFixed(1)+' %'),
  '- Rappel sur ces classes : '+(m.recall===null?'NOT_MEASURABLE':(m.recall*100).toFixed(1)+' %'),
  '- Faux positifs sur ces classes : '+m.fp,
  '- Mutations cachées distinctes : 1 (role-bypass, ordre métier)','',
  '## Limites',
  '- Un succès parfait sur ce petit jeu gelé NE PROUVE PAS une précision ou un rappel universel.',
  '- Les 12 cas historiques ne sont pas des exemples tirés aléatoirement de la production.',
  '- Le seul mutant aveugle est injecté en mémoire dans le processus de test.',
  '- G4 ne sera terminé qu’après diversité de mutations, répétitions et mesure des coûts/instabilités.',
  '- Aucun verdict ne provient d un test réellement exécuté en production.',''
 ].join('\n');
}
module.exports={TRUTH,BLIND_CLASS,matrix,build,digest};
