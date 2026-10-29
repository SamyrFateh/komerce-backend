#!/usr/bin/env node
'use strict';
/**
 * G5 operator installation smoke. Runs real quick/targeted CLIs and verifies
 * local-only DB guard, full clone teardown and blocking --require-go behavior.
 * Never connects to non-local resources or calls an external payment provider.
 */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),
 cp=require('node:child_process'),crypto=require('node:crypto');
const {assertLocalTestTarget}=require('./cli');
const ROOT=path.resolve(__dirname,'../..');
const fail=s=>{throw Error('G5_INSTALL_TOOL_ERROR: '+s)};
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
function accepts(proof,sha){
 const c=proof?.checks;
 return proof?.contract==='komerce-g5-installation-smoke/v1'&&
  proof.sha===sha&&/^[a-f0-9]{40}$/.test(sha||'')&&
  c?.packageScriptsPresent===true&&c?.docsPresent===true&&
  c?.quickNoDatabase===true&&c?.targetedNoExecution===true&&
  c?.fullClonesDropped===true&&c?.blockedRemoteTargets===3&&
  c?.strictG5Exit===1&&
  proof.evidence?.quickContract==='komerce-unified-business-logic-auditor/v35'&&
  proof.evidence?.targetedContract==='komerce-impacted-risk-plan/v36'&&
  proof.evidence?.fullPhysicalCases===12&&
  /^[a-f0-9]{64}$/.test(proof.evidence?.docsHash||'');
}
function run({auditPath,impactPath,out}={},env=process.env){
 assertLocalTestTarget(env);
 if(!auditPath||!impactPath||!out)fail('usage --audit FULL --impact G3 --out DIR');
 const a=JSON.parse(fs.readFileSync(path.resolve(auditPath),'utf8'));
 const g3=JSON.parse(fs.readFileSync(path.resolve(impactPath),'utf8'));
 if(a.contract!=='komerce-unified-business-logic-auditor/v35'||
   a.sha!==env.GITHUB_SHA||g3.sha!==a.sha||
   a.summary.physicalCasesTotal!==12||
   !a.physicalCaseIndex.every(c=>c.cloneDropped))
  fail('full physical provenance or source SHA missing');
 const pkg=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
 const expected={'audit:logic:unified':'v35-unified-invariant-census.js',
  'audit:logic:targeted:plan':'v36-impact-plan.js',
  'audit:logic:generated:inventory':'v40-generated-inventory.js',
  'audit:logic:release:check':'v38-benchmark-release-cli.js'};
 const scripts=Object.entries(expected).every(([k,v])=>pkg.scripts?.[k]?.endsWith(v));
 const docs=['tools/business-auditor/README.md',
  'tools/business-auditor/MAIN_INTEGRATION_NOTES.md',
  'tools/business-auditor/V4_G4_G5_RELEASE_CHECKLIST.md',
  'tools/business-auditor/V40_G2_G5_EVIDENCE.md'];
 const files=docs.map(p=>fs.readFileSync(path.join(ROOT,p),'utf8'));
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kba-g5-install-'));
 let quick,impact,strict;
 try{
  cp.execFileSync(process.execPath,[
   'tools/business-auditor/v35-unified-invariant-census.js',
   '--mode','quick','--out',path.join(tmp,'quick')],{
   cwd:ROOT,env,encoding:'utf8',timeout:90000,maxBuffer:1024*1024});
  quick=JSON.parse(fs.readFileSync(path.join(tmp,'quick','unified-audit.json'),'utf8'));
  cp.execFileSync(process.execPath,[
   'tools/business-auditor/v36-impact-plan.js',
   '--files','services/inventory-service.js','--budget','2',
   '--out',path.join(tmp,'targeted')],{
   cwd:ROOT,env,encoding:'utf8',timeout:90000,maxBuffer:1024*1024});
  impact=JSON.parse(fs.readFileSync(path.join(tmp,'targeted','impact-plan.json'),'utf8'));
  const strictOut=path.join(tmp,'strict');
  strict=cp.spawnSync(process.execPath,[
   'tools/business-auditor/v38-benchmark-release-cli.js',
   '--audit',path.resolve(auditPath),'--impact',path.resolve(impactPath),
   '--out',strictOut,'--require-go'],{
   cwd:ROOT,env,encoding:'utf8',timeout:25000,maxBuffer:1024*1024});
  if(strict.error)throw strict.error;
  const verdict=JSON.parse(fs.readFileSync(path.join(strictOut,'g5-release-readiness.json'),'utf8'));
  if(verdict.decision!=='NO_GO'||strict.status!==1)
   fail('strict release checker did not block uncertified V4');
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
 const hostInputs=[
  {...env,DATABASE_URL:'postgres://tester@railway.example/komerce_test'},
  {...env,DATABASE_URL:'postgres://tester@localhost/komerce_prod'},
  {...env,NODE_ENV:'production'}
 ];
 let blocked=0;
 for(const sample of hostInputs){
  try{assertLocalTestTarget(sample)}catch{blocked++}
 }
 const checks={packageScriptsPresent:scripts,docsPresent:files.every(x=>x.length>100),
  quickNoDatabase:quick.contract==='komerce-unified-business-logic-auditor/v35'&&
   quick.sha===a.sha&&quick.mode==='quick'&&quick.summary.physicalCasesTotal===0,
  targetedNoExecution:impact.contract==='komerce-impacted-risk-plan/v36'&&
   impact.sourceSha===a.sha&&impact.physicalExecutions===0&&
   impact.newGeneratedExperiments===0,
  fullClonesDropped:true,blockedRemoteTargets:blocked,strictG5Exit:strict.status};
 const report={contract:'komerce-g5-installation-smoke/v1',sha:a.sha,checks,
  evidence:{quickContract:quick.contract,targetedContract:impact.contract,
   fullPhysicalCases:a.summary.physicalCasesTotal,docsHash:digest(files.join('\n'))},
  limitations:'Smoke test and local DB protection only, not blind G4 or full semantic G2'};
 if(!accepts(report,a.sha))fail('operator installation smoke incomplete');
 const target=path.resolve(out);fs.mkdirSync(target,{recursive:true});
 fs.writeFileSync(path.join(target,'g5-install-smoke.json'),JSON.stringify(report,null,2)+'\n');
 console.log('AUDITOR_G5_INSTALL_SMOKE '+JSON.stringify({sha:a.sha,checks:report.checks}));
 return report;
}
if(require.main===module){
 const args=process.argv.slice(2),opts={};
 for(let i=0;i<args.length;i+=2){
  if(!['--audit','--impact','--out'].includes(args[i])||!args[i+1]){
   console.error('G5_INSTALL_TOOL_ERROR --audit FILE --impact FILE --out DIR');process.exit(2);
  }
  opts[args[i]==='--audit'?'auditPath':args[i]==='--impact'?'impactPath':'out']=args[i+1];
 }
 try{run(opts)}catch(e){console.error('G5_INSTALL_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2}
}
module.exports={accepts,run};
