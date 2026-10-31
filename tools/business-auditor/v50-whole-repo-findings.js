#!/usr/bin/env node
'use strict';
/**
 * HONEST WHOLE-REPO AUDIT. No whitelisted pair, handpicked domain or mutant.
 * Fully enumerates all static findings, all repo-discovered writer pairs and
 * all unpaired schema tables; links only independently observed physical
 * outcomes. IMPORTANT: sources != reachable calls; heuristics != real bugs.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {normalize}=require('./v35-invariant-census');
const {domainOf}=require('./v28-unified-engine');
const {OWNER_REGISTRY}=require('./v48-autonomous-discovery');
const {DOMAINS}=require('./v34-experiment-registry');
const fail=s=>{throw Error('V50_WHOLE_REPO_ERROR: '+s)};
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function counts(items,pick){const out={};for(const x of items){const k=pick(x);out[k]=(out[k]||0)+1;}return out}
function analyze({audit,discovery,census}){
 if(audit?.contract!=='komerce-unified-business-logic-auditor/v35'||
  audit.mode!=='full'||!/^[a-f0-9]{40}$/.test(audit.sha||'')||
  audit.sourceDiscovery?.sha!==audit.sha||
  audit.sourceDiscovery.selectionHash!==audit.selectionSha||
  discovery?.contract!=='komerce-autonomous-code-diff-discovery/v48'||
  discovery.sha!==audit.sha||
  discovery.selection?.mode!=='ALL_REVIEWED_OWNERS'||
  discovery.summary?.ownerErrors!==0||
  discovery.summary?.reviewedOwnersExecuted!==5||
  census?.contract!=='komerce-feature-invariant-census/v35'||
  census.summary?.declaredInvariants!==audit.summary?.featureInvariantsDeclared)
  fail('canonical FULL scan, SHA or five independent source owners missing');
 const source=audit.sourceDiscovery,inv=source.inventory;
 const pairs=source.pairs?.reviewQueue,solo=source.pairs?.unpairedSchemaTables;
 if(!Array.isArray(pairs)||!Array.isArray(solo)||
  pairs.length!==source.pairs.equivalenceClasses||
  pairs.length!==source.summary.priorityUnexecutable||
  solo.length!==source.summary.singleWriterOrUnpairedTables||
  audit.static?.scannedFiles!==audit.static?.trackedFiles||
  !Array.isArray(audit.static?.findings)||
  audit.static?.suspicions!==audit.static.findings.length||
  !Array.isArray(audit.data?.rules)||audit.data.rules.length!==7||
  !Array.isArray(audit.physicalCaseIndex)||audit.physicalCaseIndex.length!==12||
  audit.physicalCaseIndex.some(x=>!x.cloneDropped)||
  census.all.length!==census.summary.declaredInvariants)
  fail('repository source populations truncated or material proof incomplete');
 const ownerPaths=Object.keys(OWNER_REGISTRY),apps=inv.coverage.applicationFiles;
 if(apps<ownerPaths.length||Object.keys(discovery.ownerSourceFingerprints||{}).length!==5||
  discovery.observations.some(x=>x.cloneDropped!==true||
   x.sourceMutantIdProvided!==false))
  fail('real instrumented owner provenance not independently grounded');
 const risks=pairs.map((x,i)=>({
  id:x.id,kind:'CROSS_WRITER_PAIR',
  sourceRank:i+1,domain:x.domain,table:x.table,rankScore:x.rankScore,
  actorSources:x.actorSources,ownerSource:x.ownerSource,
  matchingIndependentRules:(x.matchingIndependentRules||[]).map(y=>y.id),
  crossDomainReview:x.crossDomainReview===true,
  runtimeReachabilityProven:x.runtimeReachabilityProven===true,
  physicalClassification:'UNTESTED_AS_PAIR',
  businessViolationConfirmed:false,
  nextAction:'EXECUTE_INDEPENDENT_STATE_ORACLE_AND_REAL_WRITER_INTERLEAVING'
 }));
 const unpaired=solo.map(x=>({
  kind:'NO_PAIR_SCHEMA_TABLE',domain:x.domain,table:x.table,
  writerCount:x.writerCount,sqlOccurrences:x.sqlOccurrences,
  matchingIndependentRules:(x.matchingIndependentRules||[]).map(y=>y.id),
  status:'UNTESTED_AS_WRITE_PATH',
  businessViolationConfirmed:false}));
 const pairsByDomain=counts(risks,x=>x.domain);
 const appStatic=audit.static.findings.map(x=>({
  id:x.id||null,rule:x.rule||x.ruleId||null,file:x.file,
  line:x.line??null,domain:domainOf(x.file),
  classification:'SUSPECTED_STATIC_NOT_CONFIRMED'}));
 const rules=audit.data.rules.map(x=>({id:x.id,priority:x.priority,
  status:x.status,detectedAtLeast:x.detectedAtLeast,
  sampleTruncated:x.sampleTruncated,
  limitation:'LOCAL_SYNTHETIC_DB_NOT_PRODUCTION'}));
 const physical=audit.physicalCaseIndex.map(x=>({
  id:x.id,domain:x.domain,verdict:x.verdict,cloneDropped:x.cloneDropped,
  priorKnowledge:'REVIEWED_CALIBRATED_RECIPE_NOT_BROAD_AUTONOMOUS_COVERAGE'}));
 const signals=discovery.summary.observedSignals||[];
 const knownSignals=['SRC3_ARCHIVE_EVENT_OLD_STATE_LOST'];
 const genuinelyNew=signals.filter(x=>!knownSignals.includes(x));
 const domains=DOMAINS.map(domain=>{
  const candidatePairs=risks.filter(x=>x.domain===domain);
  const unpairedSchema=unpaired.filter(x=>x.domain===domain);
  const declared=census.all.filter(x=>x.domain===domain).length;
  const certified=audit.semanticInvariantLedger.byDomain?.find(x=>x.domain===domain)?.certified||0;
  const independentWitnesses=physical.filter(x=>x.domain===domain);
  return {domain,staticSuspicions:appStatic.filter(x=>x.domain===domain).length,
   writerPairs:candidatePairs.length,unpairedSchemaTables:unpairedSchema.length,
   featureCardStatements:declared,exactStatementsCertified:certified,
   calibratedPhysicalCases:independentWitnesses.length,
   genericPhysicalPairExperiments:0,
   stillUnprovenPairCount:candidatePairs.length,
   status:'PARTIAL_FIXED_ORACLE_FIXTURES_NOT_GENERAL_COVERAGE'};
 });
 const verifiedConstraints=audit.summary.featureInvariantsCertified;
 if(verifiedConstraints!==3||domains.reduce((n,x)=>n+x.exactStatementsCertified,0)!==3||
  signals.length===0)
  fail('G2 or actual physical violation provenance was lost');
 const summary={
  sourceSHA:audit.sha,repositoryTrackedJs:inv.coverage.trackedJsFiles,
  repositoryAppJs:apps,
  staticFilesScanned:audit.static.scannedFiles,
  staticSignals:audit.static.findings.length,
  sourceWriteFragments:inv.summary.candidateWrites,
  confirmedTableCandidates:inv.summary.physicalTableCandidates,
  unconfirmedTargets:inv.summary.notProvenTableCandidates,
  schemaTables:inv.coverage.canonicalSchemaTables,
  distinctWrittenTables:inv.summary.tablesFound,
  ownerReviewCandidates:inv.summary.ownershipReviewCandidates,
  crossDomainWriteCandidates:inv.summary.crossDomainReviewCandidates,
  writerPairs:risks.length,
  writerPairsNotExperimentallyTested:risks.length,
  unpairedSchemaTables:unpaired.length,
  physicalOwnerFiles:ownerPaths.length,
  applicationFilesWithoutOwnerHarness:apps-ownerPaths.length,
  executedDataRules:rules.length,
  dataIntegritySignals:rules.filter(x=>x.status==='DATA_INTEGRITY_SIGNAL').length,
  calibratedPhysicalCases:physical.length,
  realOwnerFamiliesReplayed:discovery.observations.length,
  exactInvariantsCertified:verifiedConstraints,
  declaredInvariants:census.all.length,
  exactInvariantsNotCertified:census.all.length-verifiedConstraints,
  knownSourceBusinessViolationSignals:signals.filter(x=>knownSignals.includes(x)),
  previouslyUnrecordedProductionBugsConfirmed:0,
  newSignalsAwaitingIndependentReproduction:genuinelyNew,
  programmaticGeneralBugDiscoveryOnAllRepository:'NOT_ESTABLISHED'};
 const report={
  contract:'komerce-entire-repository-empirical-gap-report/v50',
  sha:audit.sha,selection:'EXHAUSTIVE_STATIC_POPULATION_NOT_HANDPICKED',
  summary,domains,
  risks,unpairedSchemaTables:unpaired,
  staticSignals:appStatic,dataSignals:rules,physicalWitnesses:physical,
  ownerProbeObservations:discovery.observations,
  untestedReviewedCases:risks.length,
  top15EachDomain:Object.fromEntries(domains.map(d=>[
   d.domain,risks.filter(x=>x.domain===d.domain).slice(0,15)])),
  evidenceHashes:{
   sourceSelection:source.selectionHash,
   caseIndex:digest(physical),
   allWriterPairs:digest(risks),
   allStaticSignals:digest(appStatic),
   allSourceTables:digest(unpaired)
  },
  refusalToClaim:[
   'static writer pairs are not business bugs',
   '12 physical cases and 5 owner families are a tiny subset of app runtime',
   'no arbitrary writer pair was physically executed',
   'local CI fixture is not live production data',
   '3 of hundreds of invariant statements proven exactly',
   'unfamiliar risks need actual independent oracle and reproduction'
  ]
 };
 return report;
}
function markdown(r){
 const s=r.summary;
 return [
 '# Komerce — balayage empirique de tout le dépôt','',
 '- SHA: '+r.sha,
 '- **Périmètre**: toutes les sources suivies, sans sélection de mutants, hors code exclu explicitement.',
 '- JS/TS suivis: '+s.repositoryTrackedJs+' ; fichiers applicatifs: '+s.repositoryAppJs,
 '- Signals code (non confirmés): '+s.staticSignals,
 '- Fragments de writes: '+s.sourceWriteFragments,
 '- Paires de writers candidates: '+s.writerPairs+' ; **expériences spécifiques sur ces paires: 0**',
 '- Fichiers applicatifs possédant un harness propriétaire: '+s.physicalOwnerFiles+'/'+s.repositoryAppJs,
 '- Candidats d écriture cross-domaine: '+s.crossDomainWriteCandidates,
 '- Invariants exacts certifiés: '+s.exactInvariantsCertified+'/'+s.declaredInvariants,
 '- Parcours historiques physiques: '+s.calibratedPhysicalCases+' ; propriétaires rejoués: '+s.realOwnerFamiliesReplayed,
 '- Violations existantes reproduites: '+s.knownSourceBusinessViolationSignals.join(', '),
 '- **Bugs inconnus prouvés par ce balayage** : '+s.previouslyUnrecordedProductionBugsConfirmed,
 '','## Couverture réelle et risques non exercés','',
 '| Domaine | Code signalé | Paires suspects | Tables hors paires | Invariants déclarés | Exactement certifiés | Parcours physiques connus |',
 '|---|---:|---:|---:|---:|---:|---:|',
 ...r.domains.map(d=>'| '+d.domain+' | '+d.staticSuspicions+' | '+d.writerPairs+
  ' | '+d.unpairedSchemaTables+' | '+d.featureCardStatements+
  ' | '+d.exactStatementsCertified+' | '+d.calibratedPhysicalCases+' |'),
 '','## Les 15 premières paires de chaque domaine (TOUTES les paires dans JSON)','',
 ...r.domains.flatMap(d=>['### '+d.domain,
 ...r.top15EachDomain[d.domain].map(x=>'- #'+x.sourceRank+' '+x.table+
 ' | '+x.rankScore+' | '+(x.actorSources||[]).slice(0,3).join(' × ')+
 ' | '+(x.crossDomainReview?'cross-domain-review':'')+
 ' | **NON PROUVÉ**')]),
 '','## Ce que ce résultat ne sait pas faire','',
 ...r.refusalToClaim.map(x=>'- '+x),
 '','**Décision honnête**: choisir les cibles haut risque à partir de cette population complète;'
 +' une contradiction doit être reproduite sur un vrai service et vérifiée par oracle indépendant.'
 ].join('\n')+'\n';
}
function cli(args,env=process.env){
 const keys=['audit','discovery','out'];const x={};
 for(let i=0;i<args.length;i+=2){
  const k=args[i]?.slice(2);
  if(!keys.includes(k)||!args[i]?.startsWith('--')||!args[i+1])
   fail('usage --audit PATH --discovery PATH --out DIR');
  x[k]=args[i+1];
 }
 if(keys.some(k=>!x[k]))fail('incomplete evidence');
 const audit=JSON.parse(fs.readFileSync(path.resolve(x.audit),'utf8'));
 const discovery=JSON.parse(fs.readFileSync(path.resolve(x.discovery),'utf8'));
 if(audit.sha!==env.GITHUB_SHA)fail('evidence must equal checkout SHA');
 const r=analyze({audit,discovery,census:normalize()});
 const dir=path.resolve(x.out);fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'whole-repo-audit.json'),JSON.stringify(r,null,2)+'\n');
 fs.writeFileSync(path.join(dir,'whole-repo-audit.md'),markdown(r));
 console.log('AUDITOR_V50_REPO_WIDE '+JSON.stringify(r.summary));
 for(const d of r.domains){
  console.log('AUDITOR_V50_DOMAIN '+JSON.stringify(d));
  for(const x of r.top15EachDomain[d.domain].slice(0,3))
   console.log('AUDITOR_V50_HIGH_RISK '+JSON.stringify({
    domain:d.domain,table:x.table,score:x.rankScore,
    actors:x.actorSources.slice(0,4),sourceRank:x.sourceRank,
    verified:false}));
 }
 return r;
}
if(require.main===module)try{cli(process.argv.slice(2))}
catch(e){console.error(e.stack||e.message);process.exitCode=2}
module.exports={analyze,markdown,cli};
