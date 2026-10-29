#!/usr/bin/env node
'use strict';
/* G3a targeted: source scan + invariant impact + bounded verified owner gates.
 * Not a generic arbitrary-bug generator (G3b follows).
 */
const fs=require('node:fs'),path=require('node:path');
const v35=require('./v35-delivery-engine');
const {choose}=require('./v36-targeted-selector');
const {ADAPTERS,getRunner,assertProof}=require('./v34-experiment-registry');
const {assertLocalTestTarget}=require('./cli');
function fail(s){throw Error('V36_TARGETED_TOOL_ERROR: '+s)}
function parse(argv){
 const o={files:[],maxClones:2,dryRun:false,out:null};
 for(let i=0;i<argv.length;i++){
  const key=argv[i];
  if(key==='--help')return {...o,help:true};
  if(key==='--dry-run'){o.dryRun=true;continue}
  if(!['--changed','--budget','--out'].includes(key)||!argv[i+1]||
   argv[i+1].startsWith('--'))fail('expected --changed FILE[,FILE] [--budget 0..12] [--dry-run] [--out DIR]');
  const v=argv[++i];
  if(key==='--changed')o.files.push(...v.split(','));
  if(key==='--budget')o.maxClones=Number(v);
  if(key==='--out')o.out=v;
 }
 if(!o.files.length||!Number.isInteger(o.maxClones)||o.maxClones<0||
  o.maxClones>12)fail('missing changed source or invalid clone budget');
 return o;
}
async function run(argv=process.argv.slice(2),env=process.env,deps={}){
 const o=parse(argv);
 if(o.help)return {help:true};
 // quick source inventory always read-only and never obtains a pg pool.
 const argvQuick=['--mode','quick',...(o.out?['--out',o.out]:[])];
 const baseline=await (deps.sourceRun||v35.run)(argvQuick,env,deps.sourceDeps||{});
 if(baseline.contract!=='komerce-unified-business-logic-auditor/v35'||
  !baseline.reportDirectory||baseline.physical!==null)
  fail('non-quick source inventory cannot be used for targeted selection');
 const catalog=JSON.parse(fs.readFileSync(path.join(baseline.reportDirectory,'invariant-coverage.json'),'utf8'));
 const selection=(deps.choose||choose)({
  files:o.files,catalog,maxClones:o.maxClones,
  exists:deps.exists});
 if(selection.contract!=='komerce-targeted-experiment-plan/v36'||
  !/^[a-f0-9]{64}$/.test(selection.selectionHash)||selection.plannedClones>o.maxClones)
  fail('targeted source selection invalid');
 const proof=[],physicalCases=[];
 const safe=selection.selectedAdapters.every(x=>x.matchedOwners.every(p=>{
  const f=selection.changedSources.find(s=>s.file===p);
  return Boolean(f?.exists);
 }));
 if(!safe&&!o.dryRun)fail('selected canonical source is absent: no physical execution');
 if(!o.dryRun&&selection.selectedAdapters.length){
  assertLocalTestTarget(env);
  for(const candidate of selection.selectedAdapters){
   const a=ADAPTERS.find(x=>x.id===candidate.id);
   if(!a)fail('unreviewed adapter selected');
   const runner=deps.runners?.[a.id]||getRunner(a);
   const anchor=runner.anchor();
   const p=await runner.run(env,a.id==='inventory'?{maxCases:2}:{},
    {[a.preflightInjectionKey]:()=>anchor});
   assertProof(a,p,anchor);
   if(p.sha&&p.sha!==baseline.sha)fail('owner executed against a different source SHA');
   proof.push({adapter:a.id,result:p,sourceHash:p.source[a.sourceHashKey]});
   for(let i=0;i<p.cases.length;i++)
    physicalCases.push({id:a.caseIds[i],
     verdict:p.cases[i].verdict,signals:p.cases[i].oracle.signals,
     cloneDropped:p.cases[i].cloneDropped,domain:a.domains.length===1?
       a.domains[0]:a.modes[i]==='CATALOG'?'catalogue':
       a.modes[i]==='AUTH'?'authorization':
       a.modes[i]==='ORDER'?'orders':'sourcing'});
  }
 }
 const report={contract:'komerce-targeted-business-audit/v36',
  sha:baseline.sha,featureRegistryHash:catalog.registryHash,
  selection,mode:o.dryRun?'DRY_RUN_NO_PG':'TARGETED_OWNER_PROOFS',
  proof,physicalCases,
  summary:{changedSources:selection.files.length,
   impactedInvariants:selection.impactedInvariants.length,
   candidateAdapters:selection.candidateAdapters.length,
   executedAdapters:proof.length,
   physicallyExecutedCases:physicalCases.length,
   expectedClones:proof.length?selection.plannedClones:0,
   sourceWithoutReviewedAdapter:selection.unmatchedChanges,
   deferred:selection.deferredAdapters.map(x=>x.id),
   detectedKnownBusinessViolations:physicalCases.filter(x=>x.verdict==='BUSINESS_VIOLATION').map(x=>x.id),
   newBugAutonomousDiscoveryProven:false,
   arbitraryFixtureGenerationProven:false,
   allChangedCodeCertified:false},
  allBusinessDomainsCertified:false,productionFixProven:false};
 const dir=baseline.reportDirectory;
 fs.writeFileSync(path.join(dir,'targeted-plan.json'),JSON.stringify(selection,null,2)+'\n');
 fs.writeFileSync(path.join(dir,'targeted-audit.json'),JSON.stringify(report,null,2)+'\n');
 fs.writeFileSync(path.join(dir,'targeted-audit.md'),[
  '# Targeted business-logic audit V3.6',
  'SHA : '+report.sha,
  'Feature registry : '+catalog.registryHash,
  'Sources changed : '+selection.files.join(', '),
  'Impacted declared invariants : '+selection.impactedInvariants.length,
  'Reviewed owner adapters : '+selection.candidateAdapters.length,
  'Executed adapters : '+proof.length,
  'Executed physical cases : '+physicalCases.length,
  'Uncovered changed sources : '+(selection.unmatchedChanges.join(', ')||'none'),
  'Deferred by budget : '+(selection.deferredAdapters.map(x=>x.id).join(', ')||'none'),
  'No arbitrary fixture generation or hidden mutant detection yet (G3b).',
  'No user-authenticated HTTP routes or production fixes certified.',''
 ].join('\n'));
 console.log('BUSINESS_AUDIT_V36_TARGETED '+JSON.stringify({
  sha:report.sha,changed:selection.files.length,
  impacted:selection.impactedInvariants.length,
  executedAdapters:proof.length,physicalCases:physicalCases.length,
  deferred:report.summary.deferred,unmatched:selection.unmatchedChanges,
  reportDirectory:dir}));
 return {...report,reportDirectory:dir};
}
if(require.main===module)run().then(x=>{
 if(x.help)console.log('npm run audit:logic:targeted -- --changed services/order-status-machine.js [--budget 2] [--dry-run] [--out DIR]');
}).catch(e=>{console.error('BUSINESS_AUDIT_V36_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
module.exports={parse,run};
