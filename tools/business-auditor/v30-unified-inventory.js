#!/usr/bin/env node
'use strict';
/**
 * V3.0 one-command evolution. V2.9 discovery + V3.0 independent Inventory
 * proof; all existing finance/logistics experiments remain unchanged.
 * QUICK has no DB; data is read-only; physical/full get exactly 2 additional
 * disposable PG clones for the two inventory ownership fixtures.
 */
const fs=require('node:fs'),path=require('node:path');
const v28=require('./v28-unified-engine');
const v29=require('./v29-unified-discovery');
const {assertLocalTestTarget}=require('./cli');
const {sourceAnchor,run:inventoryGate}=require('./v30-inventory-gate');
function appendix(r){
 const x=r.inventoryProof;
 return ['', '## V3.0 — étalon physique Inventaire / Hub','',
  '- Sélection inventaire : '+(x?.selectionHash||'NOT_RUN'),
  '- Propriétaire : '+(x?.source?.service||'NOT_RUN'),
  '- Preuve réception et rejet : '+(x?.cases.length||0)+' / 2',
  '- Comptabilisation total des scénarios sur clones : '+r.summary.physicalCasesTotal,
  '- Couverture physique partielle : '+r.coverage.filter(c=>c.status==='CALIBRATED_PARTIAL').length+' / 8 domaines',
  '','| Cas | Verdict métier | Signaux |','|---|---|---|',
  ...(x?.cases||[]).map(c=>'| '+c.mode+' | '+c.verdict+' | '+(c.oracle.signals.join(', ')||'aucun')+' |'),
  '','Le 409 réel ne vaut conformité que si la base prouve aussi zéro réception étrangère et aucun compteur modifié.',
  'La fausse preuve 409 + écriture étrangère doit être refusée par l’oracle indépendant.',
  'Cette étape ne prouve pas les routes authentifiées, les rejeux concurrents ni la production.',''].join('\n');
}
async function run(argv=process.argv.slice(2),env=process.env,deps={}){
 const options=v28.parse(argv);
 if(options.help)return {help:true};
 const physical=options.mode==='physical'||options.mode==='full';
 if(physical)assertLocalTestTarget(env);
 // Read the Inventory writer signature before any DB access.
 const anchor=physical?await (deps.sourceAnchor||sourceAnchor)():null;
 const base=await (deps.v29Run||v29.run)(argv,env,deps.v29Deps||{});
 if(base.help)return base;
 const result=physical?await (deps.inventoryGate||inventoryGate)(env,{maxCases:2},
  {sourceAnchor:()=>anchor}):null;
 if(result&&(
  result.contract!=='komerce-inventory-receipt-cross-order-gate/v30'||
  !result.allClonesDropped||result.cases.map(c=>c.mode).join('|')!=='NOMINAL|FOREIGN_ORDER'||
  result.cases.some(c=>c.oracle?.violation||c.verdict!=='PASS_WITH_EVIDENCE')||
  !result.cases[1].negativeControl?.signals.includes('INV1_CANONICAL_ORDER_IDENTITY_BROKEN')||
  result.source.sourceHash!==anchor.sourceHash))
  throw Error('V30_TOOL_ERROR: actual inventory ownership proof incomplete');
 const existing=base.coverage.map(c=>({...c}));
 const inventory=existing.find(c=>c.domain==='inventory');
 if(!inventory)throw Error('V30_TOOL_ERROR: inventory domain absent from coverage');
 if(result){
  inventory.status='CALIBRATED_PARTIAL';
  inventory.physicalCaseIds=result.cases.map(c=>'INV-RECEIVE-'+c.mode);
  inventory.fullBusinessDomainCertification=false;
 }
 const report={
  ...base,contract:'komerce-unified-business-logic-auditor/v30',
  inventoryProof:result,coverage:existing,
  summary:{...base.summary,
   domainsNotPhysicallyCovered:existing.filter(c=>c.status==='NOT_PHYSICALLY_COVERED').map(c=>c.domain),
   partialPhysicalDomains:existing.filter(c=>c.status==='CALIBRATED_PARTIAL').length,
   physicalCasesTotal:(base.physical?.cases.length||0)+(result?.cases.length||0),
   inventoryOwnershipRegressionVerified:result?.canonicalOwnershipFixConfirmedInClone||false},
  limits:{...base.limits,inventoryDirectOwnerOnly:true,
   genericScenarioGenerationProven:false,unreviewedCandidatesNeverExecuted:true},
  allBusinessDomainsCertified:false,productionFixProven:false,
  reportDirectory:undefined
 };
 const dest=base.reportDirectory;
 fs.writeFileSync(path.join(dest,'unified-audit.json'),JSON.stringify(report,null,2)+'\n');
 fs.appendFileSync(path.join(dest,'unified-audit.md'),appendix(report));
 console.log('BUSINESS_AUDIT_V30_UNIFIED '+JSON.stringify({
  sha:report.sha,inventoryModes:result?.selected||[],
  cases:report.summary.physicalCasesTotal,
  domainsPhysicallyCalibrated:report.summary.partialPhysicalDomains,
  uncovered:report.summary.domainsNotPhysicallyCovered,
  sourceHash:result?.source.sourceHash||null,
  allClonesDropped:result?.allClonesDropped||null,
  reportDirectory:dest}));
 return {...report,reportDirectory:dest};
}
if(require.main===module){
 run().then(x=>{if(x.help)console.log(
  'npm run audit:logic:unified -- [--mode quick|data|physical|full] [--out DIR] [--max-cases 1..4]\n'+
  'Full: 1..4 finance/logistics + 2 Inventory canonical PG clones, never a production DB.'
 )}).catch(e=>{console.error('BUSINESS_AUDIT_V30_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
}
module.exports={run,appendix};
