#!/usr/bin/env node
'use strict';
/**
 * Unified Komerce independent business auditor V2.8, three opt-in layers.
 * QUICK default: tracked repository-wide code scan only.
 * DATA: QUICK + read-only local PG queries, with enforced ROLLBACK.
 * PHYSICAL: QUICK + <=4 independent canonical cloned-PG scenarios.
 * FULL: QUICK + DATA + PHYSICAL.
 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),
 cp=require('node:child_process');
const ROOT=path.resolve(__dirname,'../..');
const {assertLocalTestTarget,runExistingStatic,runIndependent}=require('./cli');
const {physicalProof,frozenSelection}=require('./v28-proof-adapters');
const DOMAINS=Object.freeze([
 ['sourcing','Sourcing, raffinerie et taxonomie'],
 ['pricing','Prix, marge, douane et FX'],
 ['catalogue','Catalogue et exposition par marché'],
 ['orders','Commandes et transitions'],
 ['finance','Paiements, remboursements et portefeuille'],
 ['inventory','Réception, inventaire et Hub'],
 ['logistics','Colis, relais et remise'],
 ['authorization','Habilitations et isolation marché']
]);
function parse(argv){
 const o={mode:'quick',base:null,out:null,maxCases:4,domains:['finance','logistics'],strict:false};
 for(let i=0;i<argv.length;i++){
  const flag=argv[i];
  if(flag==='--help')return {...o,help:true};
  if(flag==='--strict'){o.strict=true;continue}
  if(!['--mode','--base','--out','--max-cases','--domains'].includes(flag)||
   !argv[i+1]||argv[i+1].startsWith('--'))
   throw Error('V28_TOOL_ERROR: invalid arguments');
  const v=argv[++i];
  if(flag==='--mode')o.mode=v;
  else if(flag==='--base')o.base=v;
  else if(flag==='--out')o.out=v;
  else if(flag==='--max-cases')o.maxCases=Number(v);
  else if(flag==='--domains')o.domains=v.split(',');
 }
 if(!['quick','data','physical','full'].includes(o.mode))throw Error('V28_TOOL_ERROR: invalid mode');
 if(o.base&&!/^[0-9A-Za-z._^~/-]{1,100}$/.test(o.base))throw Error('V28_TOOL_ERROR: invalid base');
 if(!Number.isInteger(o.maxCases)||o.maxCases<1||o.maxCases>4)
  throw Error('V28_TOOL_ERROR: max-cases must be 1..4');
 if(!Array.isArray(o.domains)||!o.domains.length||
  o.domains.some(d=>!['finance','logistics'].includes(d))||
  new Set(o.domains).size!==o.domains.length)
  throw Error('V28_TOOL_ERROR: only finance,logistics calibrated');
 return o;
}
function domainOf(file){
 const f=String(file||'').toLowerCase();
 if(/sourcing|discovery|refiner|raffiner|taxonomy|taxonom|supplier/.test(f))return 'sourcing';
 if(/pricing|atelier|price|customs|douane|fx-|margin/.test(f))return 'pricing';
 if(/catalog|product-market|exposure|market-product/.test(f))return 'catalogue';
 if(/inventory|receiv|purchasing|hub/.test(f))return 'inventory';
 if(/parcel|relay|relais|delivery|dispatch|logistic|auto-distribut/.test(f))return 'logistics';
 if(/paypal|stripe|refund|payment|wallet|finance|cash|payout/.test(f))return 'finance';
 if(/auth|membership|permission|role|access|market-operator/.test(f))return 'authorization';
 if(/orders|order-/.test(f))return 'orders';
 return 'unmapped';
}
function coverage(rows,physical,data){
 const counts={};
 for(const row of rows){const d=domainOf(row.file);counts[d]=(counts[d]||0)+1}
 return DOMAINS.map(([domain,label])=>{
  const cases=(physical?.cases||[]).filter(c=>c.domain===domain).map(c=>c.id);
  return {domain,label,staticSuspicions:counts[domain]||0,
   physicalCaseIds:cases,status:cases.length?'CALIBRATED_PARTIAL':'NOT_PHYSICALLY_COVERED',
   dataRulesExecuted:data?.length||0,fullBusinessDomainCertification:false};
 });
}
function presentation(r){
 const lines=[
  '# Komerce — Scanner logique métier unifié V2.8','',
  'SHA : '+r.sha,'Mode : '+r.mode,
  'Hash de sélection : '+(r.physical?.selection.hash||'NOT_RUN'),'', 
  '## Résumé fiable','',
  '- Fichiers analysés : '+r.static.scannedFiles+'/'+r.static.trackedFiles,
  '- Signaux statiques (suspicion, PAS bug confirmé) : '+r.static.suspicions,
  '- Nouveaux signaux : '+(r.static.newFindings==null?'NON ÉVALUÉ (base implicite)':r.static.newFindings),
  '- Règles SQL read-only : '+(r.data.status==='NOT_RUN'?'NOT_RUN':r.data.rules.length),
  '- Scénarios physiques exécutés : '+(r.physical?.cases.length||0),
  '- Verdict : '+r.verdict,'','## Couverture des domaines','',
  '| Domaine | Signaux code | Preuves physiques | Limite |',
  '|---|---:|---|---|',
  ...r.coverage.map(x=>'| '+x.label+' | '+x.staticSuspicions+' | '+
   (x.physicalCaseIds.join(', ')||'Aucune')+' | '+x.status+' |'),
  '','## Étalons métier et contre-exemples','',
  '| Scénario | Domaine | Verdict | Invariants |',
  '|---|---|---|---|',
  ...(r.physical?.cases||[]).map(x=>'| '+x.id+' | '+x.domain+' | '+x.result+
   ' | '+(x.signals.join(', ')||'aucun')+' |'),
  '','## Restrictions et preuves manquantes','',
  '- Scanner statique complet ne signifie pas couverture complète des invariants métier.',
  '- Seules finance et logistique disposent ici de témoins physiques étalonnés.',
  '- Concurrence arbitraire, routes HTTP authentifiées et incidents en production NON certifiés.',
  '- L’oracle est distinct du service; le succès d’un test qui détecte un bug ne corrige pas le service.',
  '- Bases locales jetables kba_* et aucun vrai appel PSP ou Railway.',
  '- Un scénario non exécuté est NON COUVERT, jamais implicitement PASS.',
  '','Trace complète dans unified-audit.json.'
 ];
 return lines.join('\n')+'\n';
}
function gitSha(){
 const c=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
 if(!/^[a-f0-9]{40}$/.test(c))throw Error('V28_TOOL_ERROR: missing commit SHA');
 return c;
}
async function run(options=parse(process.argv.slice(2)),env=process.env,deps={}){
 if(options.help)return {help:true};
 const useData=options.mode==='data'||options.mode==='full';
 const usePhysical=options.mode==='physical'||options.mode==='full';
 // Reject any remote database *before* loading app or creating any report.
 if(useData||usePhysical)assertLocalTestTarget(env);
 // Freeze the selection before cloning any database.
 if(usePhysical)(deps.freeze||frozenSelection)({
  maxCases:options.maxCases,domains:options.domains});
 const sha=deps.sha||gitSha();
 if(env.GITHUB_SHA&&env.GITHUB_SHA!==sha)
  throw Error('V28_TOOL_ERROR: SHA mismatch');
 const raw=await (deps.staticScan||runExistingStatic)({base:options.base||'HEAD'});
 if(raw.contract!=='komerce-audit-logic-v1'||raw.sha!==sha||
  !Array.isArray(raw.findings)||raw.scannedFiles<1||
  raw.scannedFiles!==raw.trackedFiles)
  throw Error('V28_TOOL_ERROR: repo-wide static evidence missing');
 let dataRules=null,physical=null;
 if(useData){
  const d=await (deps.dataScan||runIndependent)(
   ['--mode','data','--sample-limit','25'],env);
  dataRules=d.data?.results;
  if(d.data?.status!=='EXECUTED_REPEATABLE_READ_READ_ONLY_ROLLBACK'||
    !Array.isArray(dataRules)||dataRules.length<1)
   throw Error('V28_TOOL_ERROR: missing independent read-only data checks');
 }
 if(usePhysical){
  physical=await (deps.physicalScan||physicalProof)(env,{
   maxCases:options.maxCases,domains:options.domains});
  if(physical.contract!=='komerce-physical-calibration/v28'||
   !physical.allClonesDropped||!physical.cases.length||
   physical.cases.some(c=>!c.cloneDropped))
   throw Error('V28_TOOL_ERROR: missing physical proof or clone cleanup');
 }
 const domainCoverage=coverage(raw.findings,physical,dataRules);
 const knownPhysicalViolations=(physical?.cases||[]).filter(c=>c.result==='BUSINESS_VIOLATION').map(c=>c.id);
 const report={
  contract:'komerce-unified-business-logic-auditor/v28',sha,
  mode:options.mode,base:options.base||'HEAD_SELF_COMPARISON',
  permissions:{target:(useData||usePhysical)?'LOCAL_KOMERCE_TEST_ONLY':'NO_DATABASE',
   dataTransaction:useData?'REPEATABLE_READ_READ_ONLY_ROLLBACK':'NOT_RUN',
   physicalWrites:usePhysical?'DISPOSABLE_KBA_CLONES_ONLY':'NOT_RUN',
   livePspNetworkCalls:0,productionAccess:false},
  static:{contract:raw.contract,scannedFiles:raw.scannedFiles,
   trackedFiles:raw.trackedFiles,suspicions:raw.findings.length,
   newFindings:options.base?raw.newFindings:null,
   byRule:raw.byRule,findings:raw.findings,
   status:'STATIC_SUSPICIONS_ONLY'},
  data:dataRules?{status:'READ_ONLY_RULES_EXECUTED',rules:dataRules}:
   {status:'NOT_RUN',rules:[]},
  physical,coverage:domainCoverage,
  summary:{partialPhysicalDomains:domainCoverage.filter(x=>x.status==='CALIBRATED_PARTIAL').length,
   domainsNotPhysicallyCovered:domainCoverage.filter(x=>x.status==='NOT_PHYSICALLY_COVERED').map(x=>x.domain),
   physicalBusinessViolations:knownPhysicalViolations,
   physicalControlsClean:(physical?.cases||[]).filter(x=>x.result==='PASS_WITH_EVIDENCE').map(x=>x.id),
   unclassifiedStaticFindings:raw.findings.filter(x=>domainOf(x.file)==='unmapped').length},
  verdict:usePhysical?'PARTIAL_MULTI_DOMAIN_PROOF_WITH_KNOWN_COUNTEREXAMPLES':
   useData?'CODE_AND_READ_ONLY_DATA_SUSPICIONS_NOT_CERTIFICATION':
   'STATIC_SUSPICIONS_NOT_CERTIFICATION',
  allBusinessDomainsCertified:false,productionFixProven:false
 };
 const out=options.out?path.resolve(options.out):
  fs.mkdtempSync(path.join(os.tmpdir(),'komerce-audit-v28-'));
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'unified-audit.json'),JSON.stringify(report,null,2)+'\n');
 fs.writeFileSync(path.join(out,'unified-audit.md'),presentation(report));
 console.log('BUSINESS_AUDIT_V28_UNIFIED '+JSON.stringify({sha,mode:options.mode,
  staticFindings:raw.findings.length,dataRules:dataRules?.length||0,
  physicalCases:physical?.cases.length||0,knownViolations:knownPhysicalViolations,
  missingDomains:report.summary.domainsNotPhysicallyCovered,
  verdict:report.verdict,reportDirectory:out}));
 if(options.strict&&options.base&&raw.newFindings>0)process.exitCode=1;
 return {...report,reportDirectory:out};
}
if(require.main===module){
 run().then(r=>{if(r.help)console.log(
  'npm run audit:logic:unified -- [--mode quick|data|physical|full] [--base SHA] [--domains finance,logistics] [--max-cases 1..4] [--out DIR] [--strict]\n'+
  'Default QUICK scans all tracked JS/TS without DB. Data/physical/full require local komerce_test, NODE_ENV=test, KOMERCE_DISABLE_CRONS=true.'
 )}).catch(e=>{console.error('BUSINESS_AUDIT_V28_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
}
module.exports={parse,domainOf,coverage,presentation,run};
