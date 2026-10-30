#!/usr/bin/env node
'use strict';
/**
 * Prospective OUT-OF-REGISTRY, non-sealed red-team harness.
 * Mutants and truth labels are owned by this separate evaluator, not imported
 * or passed to v48-autonomous-discovery.js. The detector is source-frozen.
 * This is NOT independent external review / not general unknown bug detection.
 */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),
 cp=require('node:child_process'),crypto=require('node:crypto');
const {assertLocalTestTarget}=require('./cli');
const ROOT=path.resolve(__dirname,'../..');
const SCANNER=path.join(__dirname,'v48-autonomous-discovery.js');
const sha256=s=>crypto.createHash('sha256').update(s).digest('hex');
const fail=s=>{throw Error('V49_CHALLENGE_ERROR: '+s)};
// Each mutation is intentionally ABSENT from v44/v45 registries. The
// execution order is randomized at the evaluator, after scanner SHA freeze.
const PROBES=Object.freeze([
 {id:'FX_NUMERATOR_DOUBLE',owner:'FX',path:'services/fx-authority.js',truth:'FAULT',
  from:'const num = a.n * uTo.n * uFrom.d;',
  to:'const num = a.n * uTo.n * uFrom.d * 2n;'},
 {id:'FX_DENOMINATOR_DOUBLE',owner:'FX',path:'services/fx-authority.js',truth:'FAULT',
  from:'const den = a.d * uTo.d * uFrom.n;',
  to:'const den = a.d * uTo.d * uFrom.n * 2n;'},
 {id:'FX_EQUIV_ASSOCIATIVITY',owner:'FX',path:'services/fx-authority.js',truth:'EQUIVALENT',
  from:'const num = a.n * uTo.n * uFrom.d;',
  to:'const num = (a.n * uTo.n) * uFrom.d;'},
 {id:'MARKET_FORBID_EXISTING_CUSTOMS',owner:'MARKET',
  path:'services/market-operation-guard.js',truth:'FAULT',
  from:'customs_shipment_create: Object.freeze([ACTIVE, SUSPENDED]),',
  to:'customs_shipment_create: Object.freeze([ACTIVE]),'},
 {id:'MARKET_ALLOW_SUSPENDED_DRAFT',owner:'MARKET',
  path:'services/market-operation-guard.js',truth:'FAULT',
  from:'local_price_draft: Object.freeze([ACTIVE, PROVISIONING]),',
  to:'local_price_draft: Object.freeze([ACTIVE, PROVISIONING, SUSPENDED]),'},
 {id:'MARKET_EQUIV_PROVISIONING_ORDER',owner:'MARKET',
  path:'services/market-operation-guard.js',truth:'EQUIVALENT',
  from:'local_price_draft: Object.freeze([ACTIVE, PROVISIONING]),',
  to:'local_price_draft: Object.freeze([PROVISIONING, ACTIVE]),'},
 {id:'ORDER_ALLOW_SKIP_SHIPPING',owner:'ORDER',
  path:'services/order-status-machine.js',truth:'FAULT',
  from:"confirmed:   ['ordered', 'cancelled'],",
  to:"confirmed:   ['ordered', 'cancelled', 'shipped'],"},
 {id:'ORDER_DENY_VALID_ORDERING',owner:'ORDER',
  path:'services/order-status-machine.js',truth:'FAULT',
  from:"confirmed:   ['ordered', 'cancelled'],",
  to:"confirmed:   ['cancelled'],"},
 {id:'ORDER_EQUIV_TRANSITION_PERMUTATION',owner:'ORDER',
  path:'services/order-status-machine.js',truth:'EQUIVALENT',
  from:"confirmed:   ['ordered', 'cancelled'],",
  to:"confirmed:   ['cancelled', 'ordered'],"}
]);
const OWNERS=Object.freeze(['FX','MARKET','ORDER']);
function shuffled(items,randomInt=crypto.randomInt){
 const xs=[...items];
 for(let i=xs.length-1;i>0;i--){
  const j=randomInt(i+1);[xs[i],xs[j]]=[xs[j],xs[i]];
 }
 return xs;
}
function mutate(source,probe){
 if(!PROBES.includes(probe)||typeof source!=='string'||
    source.split(probe.from).length!==2)
  fail('unreviewed or ambiguous source mutation');
 const next=source.replace(probe.from,probe.to);
 if(next===source||next.includes('V49_CHALLENGE_ERROR'))
  fail('mutation missing or invalid');
 new Function('require','module',next); // syntax-only, never evaluate service
 return next;
}
function assess(report,expectedOwner,pathName,expectedHash){
 if(report?.contract!=='komerce-autonomous-code-diff-discovery/v48'||
   report.selection?.mode!=='GIT_CHANGE_DRIVEN'||
   JSON.stringify(report.selection.changedPaths)!==JSON.stringify([pathName])||
   JSON.stringify(report.selection.selected)!==JSON.stringify([expectedOwner])||
   report.ownerSourceFingerprints?.[pathName]!==expectedHash||
   report.summary?.ownerErrors!==0||
   report.summary?.reviewedOwnersExecuted!==1||
   report.observations?.length!==1||
   report.observations[0].mode!==expectedOwner||
   report.observations[0].cloneDropped!==true||
   report.observations[0].ownerCodeExecuted!==true||
   report.observations[0].sourceMutantIdProvided!==false||
   report.certifiedAutonomousUnknownBugDiscovery!==false||
   !Array.isArray(report.observations[0].signals))
  fail('v48 physical evidence, source SHA or automatic diff selection invalid');
 return report.observations[0].signals;
}
function metrics(rows){
 if(!Array.isArray(rows)||rows.length!==PROBES.length||
   new Set(rows.map(x=>x.id)).size!==PROBES.length)
  fail('incomplete prospective campaign');
 let TP=0,TN=0,FP=0,FN=0,toolErrors=0;
 for(const row of rows){
  const spec=PROBES.find(s=>s.id===row.id);
  if(!spec||row.truth!==spec.truth||row.owner!==spec.owner)
   fail('truth/source identity mismatch');
  if(row.toolError){toolErrors++;continue;}
  if(!Array.isArray(row.signals))fail('missing oracle signals');
  const flagged=row.signals.length>0;
  if(spec.truth==='FAULT')flagged?TP++:FN++;
  else flagged?FP++:TN++;
 }
 return {total:rows.length,faults:6,equivalents:3,TP,TN,FP,FN,
  toolErrors,recall:TP/6,specificity:TN/3,
  allClassified:TP+TN+FP+FN+toolErrors===rows.length,
  verdict:TP===6&&TN===3&&FP===0&&FN===0&&toolErrors===0?
   'PASS_PROSPECTIVE_NON_SEALED':'FAIL_PROSPECTIVE_NON_SEALED'};
}
function git(...args){return cp.execFileSync('git',args,{
  cwd:ROOT,encoding:'utf8',timeout:30000}).trim()}
function runScanner(out,env,exec=cp.execFileSync){
 exec(process.execPath,[SCANNER,'--out',out],{
  cwd:ROOT,env,timeout:95000,maxBuffer:2*1024*1024,
  stdio:['ignore','pipe','pipe']});
 return JSON.parse(fs.readFileSync(path.join(out,'autonomous-discovery.json'),'utf8'));
}
async function run({out}={},env=process.env,deps={}){
 assertLocalTestTarget(env);
 if(!out||typeof out!=='string')fail('provide --out DIRECTORY');
 const frozen=(deps.git||git)('rev-parse','HEAD');
 if(env.GITHUB_SHA&&env.GITHUB_SHA!==frozen)
  fail('frozen scanner must match checkout source SHA');
 const paths=[...new Set(PROBES.map(x=>x.path))];
 const before=Object.fromEntries(paths.map(p=>{
  if((deps.git||git)('status','--porcelain','--',p))
   fail('source owner must start clean, or uncommitted human work could be lost: '+p);
  const source=fs.readFileSync(path.join(ROOT,p),'utf8');
  return [p,{source,sha:sha256(source)}];
 }));
 const dir=path.resolve(out);fs.mkdirSync(dir,{recursive:true});
 const cases=shuffled(PROBES,deps.randomInt||crypto.randomInt);
 const rows=[];
 // No mutant ID, mutation text or truth is passed to the scanner process.
 for(const [i,c] of cases.entries()){
  const file=path.join(ROOT,c.path),original=before[c.path].source;
  let diagnostic=null,signals=null;
  const caseOut=fs.mkdtempSync(path.join(os.tmpdir(),'kba-v49-probe-'));
  try{
   fs.writeFileSync(file,mutate(original,c),'utf8');
   const expectedHash=sha256(fs.readFileSync(file,'utf8'));
   const report=(deps.scan||runScanner)(caseOut,env);
   signals=assess(report,c.owner,c.path,expectedHash);
  }catch(e){diagnostic=String(e.message||e).slice(0,480);}
  finally{
   fs.writeFileSync(file,original,'utf8');
   fs.rmSync(caseOut,{recursive:true,force:true});
   if(sha256(fs.readFileSync(file,'utf8'))!==before[c.path].sha||
      (deps.git||git)('status','--porcelain','--',c.path))
    fail('source owner was not restored after challenge: '+c.path);
  }
  rows.push({id:c.id,owner:c.owner,truth:c.truth,
   signals,toolError:diagnostic,order:i+1,
   detectorGivenMutantId:false,physicalOwnerRequired:true});
 }
 const result=metrics(rows);
 const report={contract:'komerce-prospective-out-of-registry-benchmark/v49',
  sha:frozen,randomizedOrder:true,sourceOwnersRestored:true,
  sourceFingerprintsBefore:Object.fromEntries(paths.map(p=>[p,before[p].sha])),
  sourceMutantIdsPassedToDetector:0,environment:'LOCAL_PG16_DISPOSABLE',
  authorship:'SAME_PROJECT_REVIEWER_NOT_EXTERNAL',
  independence:'SCANNER_SEPARATE_PROCESS_NO_MUTANT_INPUT',
  blindExternalBenchmarkCertified:false,fullAutonomousBugDiscoveryCertified:false,
  records:rows,summary:result,
  limitations:[
   'CHALLENGES_ARE_VISIBLE_TO_REPOSITORY_AUTHORS',
   'THREE_REVIEWED_OWNER_FAMILIES_ONLY',
   'EXISTING_ORACLES_AND_FIXED_OWNER_FIXTURES',
   'NOT_A_NEW_UNKNOWN_PRODUCTION_BUG_FINDING',
   'NO_EXTERNAL_INDEPENDENT_REVIEW'
  ]};
 fs.writeFileSync(path.join(dir,'prospective-challenge.json'),JSON.stringify(report,null,2)+'\n');
 console.log('AUDITOR_V49_PROSPECTIVE '+JSON.stringify({
  sha:frozen,summary:result,allSourcesRestored:true,externalBlind:false,out:dir}));
 if(result.verdict!=='PASS_PROSPECTIVE_NON_SEALED')
  fail('prospective test revealed missed defect, false positive or tool error; see report');
 return report;
}
function parse(args){
 if(args.length!==2||args[0]!=='--out'||!args[1])fail('usage --out DIRECTORY');
 return {out:args[1]};
}
if(require.main===module)run(parse(process.argv.slice(2))).catch(e=>{
 console.error(e.stack||e.message);process.exitCode=2});
module.exports={PROBES,OWNERS,shuffled,mutate,assess,metrics,run,parse};
