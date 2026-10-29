'use strict';
/**
 * G5 pre-release gate, fail-closed and deliberately never self-approving.
 * It reconciles independently recorded G1..G4 evidence from ONE commit.
 */
const crypto=require('node:crypto');
const hash=o=>crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const CRITERIA=Object.freeze({
 minimumFeatureCards:36,
 minimumDeclaredInvariants:300,
 minimumIndividuallyProvenInvariantsPerDomain:1,
 minimumIndependentGeneratorDomains:3,
 minimumHiddenMutationClasses:3,
 minimumSeedReplications:3,
 maxFalsePositivesOnFrozenHealthyWitnesses:0,
 requiredPhysicalDomainWitnesses:8,
 requireHumanReleaseApproval:true
});
const DOMAINS=Object.freeze(['sourcing','pricing','catalogue','orders',
 'finance','inventory','logistics','authorization']);
function fail(s){throw Error('V39_RELEASE_GATE_TOOL_ERROR: '+s)}
function check({unified,targeted,generated,benchmark,approved=false}){
 const refs=[unified,targeted,generated,benchmark];
 if(refs.some(x=>!/^[a-f0-9]{40}$/.test(x?.sha||''))||
  new Set(refs.map(x=>x.sha)).size!==1||
  unified.contract!=='komerce-unified-business-logic-auditor/v35'||
  targeted.contract!=='komerce-targeted-business-audit/v36'||
  generated.contract!=='komerce-generated-order-matrix-gate/v37'||
  benchmark.contract!=='komerce-supported-class-blind-benchmark/v38'||
  unified.invariantCoverage?.registryHash!==targeted.featureRegistryHash||
  benchmark.registryHash!==unified.invariantCoverage.registryHash)
  fail('missing, incompatible or mixed-source gate artifacts');
 const reasons=[],gates=[];
 function record(id,checks){
  const failed=checks.filter(x=>!x.ok).map(x=>x.code);
  gates.push({id,status:failed.length?'NO_GO':'PASS',reasons:failed});
  for(const code of failed)if(!reasons.includes(code))reasons.push(code);
 }
 const m=unified.invariantCoverage.metrics;
 record('G0_BASELINE',[
  {ok:unified.summary?.physicalCasesTotal===12,code:'BASELINE_12_CLONES_MISSING'},
  {ok:unified.coverage?.length===8&&
   unified.coverage.every(x=>x.status==='CALIBRATED_PARTIAL'),
   code:'EIGHT_PARTIAL_DOMAINS_NOT_REPRODUCED'}
 ]);
 record('G1_FLAT_ENGINE',[
  {ok:unified.orchestrator?.recursivelyChainedV30toV33===false&&
   unified.orchestrator?.legacyV29GatewayCalls===1&&
   unified.orchestrator?.reviewedPhysicalAdapters?.length===4,
   code:'FLAT_G1_ORCHESTRATOR_NOT_PROVEN'},
  {ok:unified.allBusinessDomainsCertified===false,
   code:'FALSE_FULL_DOMAIN_CERTIFICATION'}
 ]);
 record('G2_INVARIANT_COVERAGE',[
  {ok:m.cards>=CRITERIA.minimumFeatureCards&&
   m.declared>=CRITERIA.minimumDeclaredInvariants&&
   m.textOnly+m.declaredWithTest===m.declared,
   code:'INVARIANT_REGISTRY_INCOMPLETE'},
  {ok:DOMAINS.every(d=>unified.coverage.find(x=>x.domain===d)),code:'MISSING_DOMAIN'},
  {ok:m.independentlyCertifiedInvariants>=
    CRITERIA.minimumIndividuallyProvenInvariantsPerDomain*DOMAINS.length,
   code:'INDEPENDENT_INVARIANT_LINKAGE_INCOMPLETE'}
 ]);
 record('G3_AUTONOMOUS_GENERATION',[
  {ok:targeted.summary?.physicallyExecutedCases>0&&
   targeted.selection.plannedClones<=targeted.selection.cloneBudget,
   code:'TARGETED_EXECUTION_NOT_PROVEN'},
  {ok:generated.cases?.length===2&&generated.cases[0].oracle.violation===false&&
    generated.cases[1].oracle.violation===true&&
    generated.hiddenMutationDetectedWithoutScenarioCodeEdit===true,
   code:'BLIND_MUTATION_UNDETECTED'},
  // Only one generated rule grammar exists: do NOT imply 8-domain autonomy.
  {ok:Number(generated.independentGeneratorDomains||1)>=
    CRITERIA.minimumIndependentGeneratorDomains,
   code:'GENERATOR_FAMILIES_TOO_NARROW'}
 ]);
 record('G4_BENCHMARK_VALIDITY',[
  {ok:benchmark.confusion?.fp<=CRITERIA.maxFalsePositivesOnFrozenHealthyWitnesses&&
   benchmark.confusion?.fn===0,code:'REFERENCE_BENCHMARK_REGRESSION'},
  {ok:benchmark.limits?.hiddenMutationClassCount>=
   CRITERIA.minimumHiddenMutationClasses,
   code:'BLIND_MUTATION_CLASS_DIVERSITY_MISSING'},
  {ok:Number(benchmark.repeatedIndependentSeeds||0)>=
   CRITERIA.minimumSeedReplications,
   code:'FLAKINESS_REPLICATIONS_NOT_MEASURED'},
  {ok:benchmark.limits?.notAReleaseGO===false,
   code:'BENCHMARK_NOT_DECLARED_RELEASE_READY'}
 ]);
 record('G5_HUMAN_RELEASE_APPROVAL',[
  // CLI alone has no authority to approve/merge a product release.
  {ok:approved===true&&false,code:'EXPLICIT_EXTERNAL_HUMAN_RELEASE_GATE_REQUIRED'}
 ]);
 const result={contract:'komerce-v4-release-readiness/v39',
  sha:unified.sha,criteriaHash:hash(CRITERIA),criteria:CRITERIA,gates,
  verdict:reasons.length?'NO_GO':'GO',
  releaseAllowed:false,approvalPath:'HUMAN_REVIEW_AND_EXPLICIT_USER_AUTHORIZATION',
  blockers:reasons,summary:{passedGates:gates.filter(x=>x.status==='PASS').length,
   failedGates:gates.filter(x=>x.status==='NO_GO').length,
   totalGates:gates.length,
   domainsWithSomePhysicalEvidence:unified.summary.partialPhysicalDomains,
   individuallyCertifiedInvariants:m.independentlyCertifiedInvariants,
   generatedScenariosPerSeed:generated.plan.scenarioCount,
   benchmarkSamples:benchmark.confusion.total,
   measuredHiddenMutationClasses:benchmark.limits.hiddenMutationClassCount,
   productionTouched:false,mainMerged:false},
  noAutomaticMergeOrRelease:true};
 if(result.verdict==='GO')fail('self-approved release is not supported in G5 preflight');
 return result;
}
function markdown(r){
 return ['# Komerce V4.0 — préparation à la release','',
  'Décision : **'+r.verdict+'**',
  'Commit SHA : '+r.sha,
  'Critères : '+r.criteriaHash,'',
  '| Porte | Verdict | Blocages |','|---|---|---|',
  ...r.gates.map(g=>'| '+g.id+' | '+g.status+' | '+(g.reasons.join(', ')||'aucun')+' |'),
  '','## Bloqueurs empêchant toute annonce de livraison',
  ...r.blockers.map(x=>'- '+x),
  '','Cette décision repose exclusivement sur preuves enregistrées au même SHA.',
  'Elle ne fusionne aucune PR, ne touche pas production et n’accorde jamais seule l’autorisation de release.',''
 ].join('\n');
}
module.exports={CRITERIA,check,markdown};
