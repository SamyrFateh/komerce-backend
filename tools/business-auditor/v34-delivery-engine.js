#!/usr/bin/env node
'use strict';
/**
 * V3.4 delivery foundation: exactly one source/static/data/legacy physical
 * pass via V2.9 and a flat, explicit registry of four reviewed proof gates.
 * No V30->V31->V32->V33 nested orchestration; each gate executes at most once.
 */
const fs=require('node:fs'),path=require('node:path');
const v28=require('./v28-unified-engine');
const v29=require('./v29-unified-discovery');
const {assertLocalTestTarget}=require('./cli');
const {DOMAINS,ADAPTERS,getRunner,assertProof,physicalDescriptors}=require('./v34-experiment-registry');
function invalid(s){throw Error('V34_DELIVERY_TOOL_ERROR: '+s)}
function assemble(base,proofs,physical,registry=ADAPTERS){
 const descriptors=physicalDescriptors(base,proofs);
 const casesTotal=descriptors.length;
 const coverage=base.coverage.map(c=>({...c,
  physicalCaseIds:[...c.physicalCaseIds],fullBusinessDomainCertification:false}));
 if(physical){
  for(const a of registry){
   const p=proofs[a.reportKey];
   for(const d of a.domains){
    const row=coverage.find(c=>c.domain===d);
    if(!row)invalid('missing source/static business domain '+d);
    const ids=descriptors.filter(x=>x.domain===d&&x.origin==='reviewed_adapter').map(x=>x.id);
    row.physicalCaseIds=[...new Set([...row.physicalCaseIds,...ids])];
    row.status='CALIBRATED_PARTIAL';
   }
  }
 }
 const summary={...base.summary,
  physicalCasesTotal:casesTotal,
  partialPhysicalDomains:coverage.filter(c=>c.status==='CALIBRATED_PARTIAL').length,
  domainsNotPhysicallyCovered:coverage.filter(c=>c.status==='NOT_PHYSICALLY_COVERED').map(c=>c.domain),
  knownBusinessViolations:descriptors.filter(x=>x.verdict==='BUSINESS_VIOLATION').map(x=>x.id),
  sourcingOldStateBugReproduced:Boolean(proofs.ordersSourcingProof?.cases[1]?.oracle.violation),
  sourcingOldStateBugFixed:false,
  fullBusinessCoverage:false,
  actualInvariantCoverageRatio:null,
  runtimeAuthenticatedRoutesProven:false,
  arbitraryScenariosGenerated:false
 };
 if(physical&&(casesTotal!==(base.physical?.cases.length||0)+registry.reduce((n,a)=>n+a.modes.length,0)||
  coverage.length!==DOMAINS.length||new Set(coverage.map(c=>c.domain)).size!==DOMAINS.length||
  summary.partialPhysicalDomains!==DOMAINS.length))
  invalid('partial coverage/proof totals inconsistent');
 return {...base,contract:'komerce-unified-business-logic-auditor/v34',
  ...proofs,coverage,summary,
  physicalCaseIndex:descriptors,
  orchestrator:{contract:'komerce-flat-adapter-orchestrator/v34',
   sourceDiscoveryCalls:1,staticBaselineRuns:1,legacyV29GatewayCalls:1,
   reviewedPhysicalAdapters:physical?registry.map(a=>a.id):[],
   recursivelyChainedV30toV33:false,
   allowedTarget:physical?'LOCAL_KOMERCE_TEST_ONLY':'NO_NEW_PHYSICAL_CLONES'},
  knownBugPolicy:{sourcingArchiveIssue:3127,
   status:physical?'BUSINESS_VIOLATION_REPRODUCED_ON_CLONE':'NOT_EXECUTED',
   pendingFixMustRequalifyWithUnchangedOracle:true,
   productionIncidentConfirmed:false},
  limits:{...base.limits,
   allBusinessDomainsCalibratedOnlyPartially:true,
   businessInvariantDenominatorNotYetMeasured:true,
   noAutomaticallyGeneratedArbitraryFixtures:true,
   knownBugStillPendingIndependentFixVerification:true},
  allBusinessDomainsCertified:false,productionFixProven:false,
  reportDirectory:undefined};
}
function digest(r,registry=ADAPTERS){
 return [
  '# Komerce — Independent Business Logic Auditor V3.4, delivery foundation','',
  '- Source SHA : '+r.sha,
  '- Mode : '+r.mode,
  '- JS/TS réellement scannés : '+r.static.scannedFiles+'/'+r.static.trackedFiles,
  '- Paires statiques candidates : '+r.sourceDiscovery.summary.totalWriterPairs+
   ' (ne sont PAS des bugs confirmés)',
  '- Classes de risque : '+r.sourceDiscovery.summary.equivalenceClasses,
  '- Contrôles SQL en lecture seule : '+(r.data.status==='NOT_RUN'?'NOT_RUN':r.data.rules.length),
  '- Scénarios physiques exécutés : '+r.summary.physicalCasesTotal,
  '- Domaines partiellement étalonnés : '+r.summary.partialPhysicalDomains+'/8',
  '- Domaines entièrement certifiés : 0/8',
  '- Dénominateur des invariants contrôlés : NON MESURÉ (jalon G2)','',
  '## Épreuves physiques individuelles','',
  '| Scénario | Domaine | Verdict | Preuve sur clone |','|---|---|---|---|',
  ...r.physicalCaseIndex.map(c=>'| '+c.id+' | '+c.domain+' | '+c.verdict+
   ' | '+(c.cloneDropped?'Clone détruit':'NON CERTIFIÉ')+' |'),
  '','## Registre d’adaptateurs','',
  ...registry.map(a=>'- '+a.id+' : '+a.domains.join(', ')+
    ' ; cas '+a.modes.join(' + ')),
  '','## Risques et conditions de sortie','',
  '- SOURCE #3127 : ancien état perdu dans l’audit sourcing ; anomalie démontrée sur clone, NON corrigée.',
  '- Les 8 domaines disposent de témoins, pas d’une certification de tous leurs invariants.',
  '- Aucun bug ne peut être conclu d’une simple paire de writers ou d’un score statique.',
  '- Pas de route HTTP authentifiée, de PSP réel, de concurrence généralisée ou de preuve production.',
  '- Aucun scénario arbitraire non revu n’est exécuté. La génération générique appartient au jalon G3.',
  '- La correction de #3127 doit conserver l’oracle indépendant et changer le résultat métier.',
  '- Les statuts NOT_RUN/NOT_COVERED sont des preuves manquantes, jamais des PASS.',''
 ].join('\n');
}
async function run(argv=process.argv.slice(2),env=process.env,deps={}){
 const options=v28.parse(argv);
 if(options.help)return {help:true};
 const physical=options.mode==='physical'||options.mode==='full';
 if(physical||options.mode==='data')assertLocalTestTarget(env);
 // Source anchors are frozen before any PostgreSQL access.
 const prepared=physical?ADAPTERS.map(a=>{
  const runner=deps.runners?.[a.id]||getRunner(a);
  return {adapter:a,runner,anchor:runner.anchor()};
 }):[];
 const baseline=await (deps.baseRun||v29.run)(argv,env,deps.baseDeps||{});
 if(baseline.help)return baseline;
 if(baseline.contract!=='komerce-unified-business-logic-auditor/v29'||
  !/^[a-f0-9]{40}$/.test(baseline.sha||'')||
  baseline.static?.scannedFiles!==baseline.static?.trackedFiles||
  baseline.coverage?.length!==DOMAINS.length)
  invalid('baseline is not a complete verified source scan');
 const proofs={};
 for(const {adapter,runner,anchor} of prepared){
  // Each gate gets the frozen matching anchor, never a handpicked owner id.
  const p=await runner.run(env,adapter.id==='inventory'?{maxCases:2}:{},
   {[adapter.preflightInjectionKey]:()=>anchor});
  assertProof(adapter,p,anchor);
  if(p.sha&&p.sha!==baseline.sha)invalid('mixed source SHA for '+adapter.id);
  proofs[adapter.reportKey]=p;
 }
 const report=assemble(baseline,proofs,physical);
 const dir=baseline.reportDirectory;
 if(!dir||!fs.existsSync(dir))invalid('baseline report path is absent');
 fs.writeFileSync(path.join(dir,'unified-audit.json'),JSON.stringify(report,null,2)+'\n');
 fs.writeFileSync(path.join(dir,'unified-audit.md'),digest(report)+'\n');
 console.log('BUSINESS_AUDIT_V34_UNIFIED '+JSON.stringify({
  sha:report.sha,sourcePasses:report.orchestrator.sourceDiscoveryCalls,
  staticPasses:report.orchestrator.staticBaselineRuns,
  physicalCases:report.summary.physicalCasesTotal,
  partialDomains:report.summary.partialPhysicalDomains,
  knownViolations:report.summary.knownBusinessViolations,
  allDomainsCertified:false,
  reportDirectory:dir}));
 return {...report,reportDirectory:dir};
}
if(require.main===module)run().then(r=>{
 if(r.help)console.log('npm run audit:logic:unified -- [--mode quick|data|physical|full] [--out DIR] [--max-cases 1..4]');
}).catch(e=>{console.error('BUSINESS_AUDIT_V34_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
module.exports={run,assemble,digest};
