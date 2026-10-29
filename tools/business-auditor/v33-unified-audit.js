#!/usr/bin/env node
'use strict';
/* V3.3 adds two bounded owners to the V3.2 unified business auditor.
 * Physical domain presence is never equivalent to business certification.
 */
const fs=require('node:fs'),path=require('node:path');
const v28=require('./v28-unified-engine');
const v32=require('./v32-unified-catalog-auth');
const {assertLocalTestTarget}=require('./cli');
const {anchor,run:gate}=require('./v33-orders-sourcing-gate');
async function run(argv=process.argv.slice(2),env=process.env,deps={}){
 const opts=v28.parse(argv);
 if(opts.help)return {help:true};
 const physical=['physical','full'].includes(opts.mode);
 if(physical)assertLocalTestTarget(env);
 const pre=physical?(deps.anchor||anchor)():null;
 const base=await (deps.previous||v32.run)(argv,env,deps.previousDeps||{});
 if(base.help)return base;
 const proof=physical?await (deps.gate||gate)(env,{}, {anchor:()=>pre}):null;
 if(proof&&(
  proof.contract!=='komerce-order-sourcing-physical-gate/v33'||
  !proof.allClonesDropped||proof.source.hash!==pre.hash||
  proof.cases.map(x=>x.mode).join('|')!=='ORDER|SOURCING'||
  proof.cases[0].verdict!=='PASS_WITH_EVIDENCE'||
  proof.cases[1].verdict!=='BUSINESS_VIOLATION'||
  !proof.cases[1].oracle.signals.includes('SRC3_ARCHIVE_EVENT_OLD_STATE_LOST')||
  !proof.cases[1].negativeControl.correctedContractWouldPass||
  proof.cases.some(x=>!x.cloneDropped)))
  throw Error('V33_TOOL_ERROR: order/sourcing physical proof missing');
 const coverage=base.coverage.map(x=>({...x}));
 if(proof)for(const [domain,label] of [
  ['orders','ORDER-CONFIRMED-TO-ORDERED'],
  ['sourcing','SOURCING-FULL-SNAPSHOT-ARCHIVE']]){
  const row=coverage.find(x=>x.domain===domain);
  if(!row)throw Error('V33_TOOL_ERROR: missing domain');
  row.status='CALIBRATED_PARTIAL';
  row.physicalCaseIds=[label];
  row.fullBusinessDomainCertification=false;
 }
 const missing=coverage.filter(x=>x.status==='NOT_PHYSICALLY_COVERED').map(x=>x.domain);
 const report={...base,contract:'komerce-unified-business-logic-auditor/v33',
  ordersSourcingProof:proof,coverage,
  summary:{...base.summary,
   partialPhysicalDomains:coverage.filter(x=>x.status==='CALIBRATED_PARTIAL').length,
   physicalCasesTotal:(base.summary.physicalCasesTotal||0)+(proof?.cases.length||0),
   domainsNotPhysicallyCovered:missing,
   sourcingOldStateBugReproduced:proof?.cases[1]?.oracle.violation||false,
   sourcingOldStateBugFixed:false,
   fullBusinessCoverage:false},
  limits:{...base.limits,firstPassEightDomainsNotExhaustive:true,
   orderTransitionSamplesOnly:true,sourceArchiveSamplesOnly:true},
  allBusinessDomainsCertified:false,productionFixProven:false,
  reportDirectory:undefined};
 const out=base.reportDirectory;
 fs.writeFileSync(path.join(out,'unified-audit.json'),JSON.stringify(report,null,2)+'\n');
 fs.appendFileSync(path.join(out,'unified-audit.md'),[
  '','## V3.3 — Commandes + Sourcing','',
  'Physically sampled domains: '+report.summary.partialPhysicalDomains+'/8. Certified end-to-end domains: 0.',
  'Physical scenarios: '+report.summary.physicalCasesTotal,
  'Order nominal: '+(proof?.cases[0].verdict||'NOT_RUN'),
  'Sourcing archival audit: '+(proof?.cases[1].verdict||'NOT_RUN'),
  'New disposable-PG sourcing witness: '+(proof?.discoveredBugCandidate.id||'NOT_RUN'),
  'No production patch or staging write. No complete Sourcing/Raffinerie certification.',''
 ].join('\n'));
 console.log('BUSINESS_AUDIT_V33_UNIFIED '+JSON.stringify({
  sha:report.sha,total:report.summary.physicalCasesTotal,
  calibrated:report.summary.partialPhysicalDomains,
  oldStateBug:proof?.discoveredBugCandidate.id||null,
  reportDirectory:out}));
 return {...report,reportDirectory:out};
}
if(require.main===module)run().then(x=>{
 if(x.help)console.log('npm run audit:logic:unified -- --mode quick|data|physical|full');
}).catch(e=>{console.error('BUSINESS_AUDIT_V33_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
module.exports={run};
