#!/usr/bin/env node
'use strict';
/* V3.2 keeps V3.1's complete evidence and adds physical catalogue+auth gates.
 * Unchanged legacy gates run independently under their archived script aliases.
 */
const fs=require('node:fs'),path=require('node:path');
const v28=require('./v28-unified-engine');
const v31=require('./v31-unified-batch');
const {assertLocalTestTarget}=require('./cli');
const {sourceAnchor,run:gate}=require('./v32-catalog-auth-gate');
async function run(argv=process.argv.slice(2),env=process.env,deps={}){
 const options=v28.parse(argv);
 if(options.help)return {help:true};
 const physical=['physical','full'].includes(options.mode);
 if(physical)assertLocalTestTarget(env);
 const anchor=physical?(deps.sourceAnchor||sourceAnchor)():null;
 const prior=await (deps.previous||v31.run)(argv,env,deps.previousDeps||{});
 if(prior.help)return prior;
 const newProof=physical?await (deps.gate||gate)(env,{}, {anchor:()=>anchor}):null;
 if(newProof&&(newProof.contract!=='komerce-catalog-auth-physical-gate/v32'||
  !newProof.allClonesDropped||newProof.source.hash!==anchor.hash||
  newProof.cases.map(c=>c.mode).join('|')!=='CATALOG|AUTH'||
  newProof.cases.some(c=>c.oracle?.violation||!c.cloneDropped||
    c.authenticatedHttpRouteTested!==false)||
  !newProof.cases[0].negativeControl.signals.includes('CAT2_EXPOSURE_LEAKED_TO_ANOTHER_MARKET')||
  !newProof.cases[1].negativeControl.signals.includes('AUTH2_MARKET_OR_MEMBERSHIP_ISOLATION_BROKEN')))
  throw Error('V32_TOOL_ERROR: catalogue/market membership proof missing');
 const coverage=prior.coverage.map(c=>({...c}));
 if(newProof)for(const [domain,id] of [
  ['catalogue','CATALOG-MARKET-EXPOSURE'],
  ['authorization','AUTH-MARKET-MEMBERSHIP']]){
  const c=coverage.find(x=>x.domain===domain);
  if(!c)throw Error('V32_TOOL_ERROR: coverage domain missing '+domain);
  c.status='CALIBRATED_PARTIAL';
  c.physicalCaseIds=[id];
  c.fullBusinessDomainCertification=false;
 }
 const uncovered=coverage.filter(x=>x.status==='NOT_PHYSICALLY_COVERED').map(x=>x.domain);
 const report={...prior,contract:'komerce-unified-business-logic-auditor/v32',
  catalogAuthorizationProof:newProof,coverage,
  summary:{...prior.summary,partialPhysicalDomains:
   coverage.filter(x=>x.status==='CALIBRATED_PARTIAL').length,
   physicalCasesTotal:(prior.summary.physicalCasesTotal||0)+(newProof?.cases.length||0),
   domainsNotPhysicallyCovered:uncovered,
   marketMembershipVerified:newProof?.cases[1]?.oracle.violation===false,
   authenticatedMarketRouteVerified:false,
   fullCatalogPublicationReadinessCertified:false},
  limits:{...prior.limits,
   catalogExposureNotWholePublication:true,
   scopeMembershipWithoutHttpAuthentication:true,
   automaticArbitraryFixtureGeneration:false},
  allBusinessDomainsCertified:false,productionFixProven:false,reportDirectory:undefined};
 const dest=prior.reportDirectory;
 fs.writeFileSync(path.join(dest,'unified-audit.json'),JSON.stringify(report,null,2)+'\n');
 fs.appendFileSync(path.join(dest,'unified-audit.md'),[
  '','## V3.2 — exposition catalogue et habilitations de marché','',
  '- Scénarios physiques cumulés : '+report.summary.physicalCasesTotal,
  '- Domaines partiellement étalonnés : '+report.summary.partialPhysicalDomains+'/8',
  '- Source catalog/market : '+(newProof?.source.hash||'NOT_RUN'),
  '- Exposition ENABED/DISABLED isolée par marché : '+(newProof?.cases[0]?.verdict||'NOT_RUN'),
  '- Membership/capability et révocation : '+(newProof?.cases[1]?.verdict||'NOT_RUN'),
  '- Sans exposition explicite : désactivé, jamais publié automatiquement.',
  '- Sans membership : rejet 403 ; autre marché : rejet 403 ; révocation : rejet.',
  '- Faux correctifs exclus : fuite sur autre marché et écriture sans habilitation.',
  '- NE COUVRE PAS : readiness complète de première publication, routes HTTP authentifiées, tous les rôles.',
  '- Aucune inférence de sécurité totale à partir de 6/8 domaines partiellement étalonnés.',''
 ].join('\n'));
 console.log('BUSINESS_AUDIT_V32_UNIFIED '+JSON.stringify({
  sha:report.sha,physicalCases:report.summary.physicalCasesTotal,
  partiallyCalibratedDomains:report.summary.partialPhysicalDomains,
  missingDomains:uncovered,
  forged:newProof?.cases.map(x=>x.negativeControl.signals)||[],
  reportDirectory:dest}));
 return {...report,reportDirectory:dest};
}
if(require.main===module)run().then(x=>{
 if(x.help)console.log('npm run audit:logic:unified -- [--mode quick|data|physical|full]');
}).catch(e=>{console.error('BUSINESS_AUDIT_V32_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
module.exports={run};
