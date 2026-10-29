#!/usr/bin/env node
'use strict';
/** V3.1 accelerated combined stage: V3.0 + canonical FX and market guard. */
const fs=require('node:fs'),path=require('node:path');
const v28=require('./v28-unified-engine');
const v30=require('./v30-unified-inventory');
const {assertLocalTestTarget}=require('./cli');
const {run:gate,sourceAnchor}=require('./v31-fx-market-gate');
async function run(argv=process.argv.slice(2),env=process.env,deps={}){
 const opt=v28.parse(argv);
 if(opt.help)return {help:true};
 const physical=['physical','full'].includes(opt.mode);
 if(physical)assertLocalTestTarget(env);
 const anchor=physical?(deps.sourceAnchor||sourceAnchor)():null;
 const base=await (deps.v30Run||v30.run)(argv,env,deps.v30Deps||{});
 if(base.help)return base;
 const result=physical?await (deps.gate||gate)(env,{},{
  anchor:()=>anchor
 }):null;
 if(result&&(
  result.contract!=='komerce-fx-market-physical-gate/v31'||
  !result.allClonesDropped||result.source.hash!==anchor.hash||
  result.cases.map(x=>x.mode).join('|')!=='FX|MARKET'||
  result.cases.some(x=>x.oracle?.violation||!x.cloneDropped)||
  !result.cases[0].negativeControl.signals.includes('FX1_PIVOT_RESULT_OR_ROUNDING_MISMATCH')||
  !result.cases[1].negativeControl.signals.includes('MK2_MARKET_OPERATION_POLICY_VIOLATION')))
  throw Error('V31_TOOL_ERROR: new independent FX/market evidence invalid');
 const updated=base.coverage.map(x=>({...x}));
 if(result){
  const pricing=updated.find(x=>x.domain==='pricing');
  if(!pricing)throw Error('V31_TOOL_ERROR: missing pricing domain');
  pricing.physicalCaseIds=['FX-FIXED-PIVOT'];
  pricing.status='CALIBRATED_PARTIAL';
  pricing.fullBusinessDomainCertification=false;
 }
 const remaining=updated.filter(x=>x.status==='NOT_PHYSICALLY_COVERED').map(x=>x.domain);
 const merged={...base,
  contract:'komerce-unified-business-logic-auditor/v31',
  fxMarketProof:result,coverage:updated,
  summary:{...base.summary,partialPhysicalDomains:
   updated.filter(x=>x.status==='CALIBRATED_PARTIAL').length,
   physicalCasesTotal:(base.summary.physicalCasesTotal||0)+(result?.cases.length||0),
   domainsNotPhysicallyCovered:remaining,
   marketLifecycleControlVerified:result?.cases[1]?.oracle.violation===false,
   marketMembershipVerified:false},
  limits:{...base.limits,
   fixedParityEurKmfXafOnly:true,
   marketLifecycleNotMarketMembership:true,
   genericScenarioGenerationProven:false},
  allBusinessDomainsCertified:false,productionFixProven:false,
  reportDirectory:undefined
 };
 const dir=base.reportDirectory;
 fs.writeFileSync(path.join(dir,'unified-audit.json'),JSON.stringify(merged,null,2)+'\n');
 fs.appendFileSync(path.join(dir,'unified-audit.md'),[
  '','## V3.1 — prix FX et garde du cycle de vie marché','',
  '- Scénarios physiques cumulés : '+merged.summary.physicalCasesTotal,
  '- Domaines partiellement étalonnés : '+merged.summary.partialPhysicalDomains+' / 8',
  '- Source FX et garde : '+(result?.source.hash||'NOT_RUN'),
  '- FX (pivot EUR, parités fixes KMF/XAF) : '+(result?.cases[0]?.verdict||'NOT_RUN'),
  '- Marché (actif, suspendu, préparation, 15 opérations) : '+
   (result?.cases[1]?.verdict||'NOT_RUN'),
  '- Habilitations des utilisateurs et périmètre des membres de marché : NON COUVERTES.',
  '- FX USD, AED, DJF, CNY et disponibilité du cours public : NON COUVERTS.',
  '- Contrôles négatifs : taux/arrondi falsifié et activation interdite malgré suspension.',
  '','### Hors périmètre','',
  'Source-only ranking, not generic test generation; direct real owners on disposable PG.',
  'Pas de middleware HTTP authentifié ; aucune preuve de bug en production.',''
 ].join('\n'));
 console.log('BUSINESS_AUDIT_V31_UNIFIED '+JSON.stringify({
  sha:merged.sha,total:merged.summary.physicalCasesTotal,
  partialDomains:merged.summary.partialPhysicalDomains,
  uncovered:remaining,checks:result?.cases[1]?.oracle.checks||0,
  allClonesDropped:result?.allClonesDropped||null,
  reportDirectory:dir
 }));
 return {...merged,reportDirectory:dir};
}
if(require.main===module)run().then(x=>{
 if(x.help)console.log('npm run audit:logic:unified -- --mode quick|data|physical|full');
}).catch(e=>{console.error('BUSINESS_AUDIT_V31_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
module.exports={run};
