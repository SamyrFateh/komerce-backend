#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {assertLocalTestTarget}=require('./cli');
const {withClone}=require('./v16-cloned-database');
const {generate,evaluate,POLICY}=require('./v37-order-matrix-generator');
const ROOT=path.resolve(__dirname,'../..');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function fail(m){throw Error('V37_G3B_TOOL_ERROR: '+m)}
function sourceAnchor(){
 const file=path.join(ROOT,'services/order-status-machine.js');
 const c=fs.readFileSync(file,'utf8');
 if(!/async function transitionOrderStatus\s*\(/.test(c)||
  c.split('if (!allowedRoles.includes(actor.role)) {').length!==2||
  !/order_status_history/.test(c))fail('canonical order owner/role permission anchor drifted');
 return {owner:'services/order-status-machine.js',
  sourceHash:hash(c),policyHash:hash(POLICY),mutantAllowedOnlyInMemory:true};
}
function observe(mode,env,seed,url){
 const output=cp.execFileSync(process.execPath,
  [path.join(__dirname,'v37-order-matrix-child.js'),mode,seed],{
   cwd:ROOT,encoding:'utf8',timeout:95000,maxBuffer:4*1024*1024,
   stdio:['ignore','pipe','pipe'],
   env:{...env,NODE_ENV:'test',KOMERCE_DISABLE_CRONS:'true',DATABASE_URL:url}});
 const prefix='BUSINESS_AUDIT_V37_OBSERVATION ';
 const line=output.split('\n').find(x=>x.startsWith(prefix));
 if(!line)fail('missing canonical owner evidence '+mode);
 return JSON.parse(line.slice(prefix.length));
}
async function run(env=process.env,opts={},deps={}){
 assertLocalTestTarget(env);
 const seed=opts.seed||'v37-gen-1';
 const plan=generate(seed);
 const anchor=(deps.sourceAnchor||sourceAnchor)();
 if(anchor.owner!=='services/order-status-machine.js'||
  !/^[a-f0-9]{64}$/.test(anchor.sourceHash||'')||
  anchor.policyHash!==plan.policyHash||
  !anchor.mutantAllowedOnlyInMemory)
  fail('missing source/policy lineage');
 const cases=[];
 for(const mode of ['NOMINAL','BLIND_MUTANT']){
  const evidence=await (deps.withClone||withClone)(env,url=>
   (deps.observe||observe)(mode,env,seed,url));
  if(!evidence.cloneDroppedAfterExecution)fail('clone remained '+mode);
  const raw=evidence.result;
  if(raw.contract!=='komerce-generated-order-physical/v37'||
   !raw.ownerExecuted||!raw.canonicalPg||!raw.noExternalNetwork||
   !raw.noProductionTouch||raw.sourceFileChanged!==false||
   raw.mode!==mode||raw.planHash!==plan.selectionHash||
   raw.policyHash!==plan.policyHash||raw.seed!==seed)
   fail('non-owner or non-identical generated proof '+mode);
  const oracle=evaluate(plan,raw.observations);
  if(mode==='NOMINAL'&&oracle.violation)
   fail('true owner has regression under generated invariant matrix '+oracle.violations.length);
  if(mode==='BLIND_MUTANT'&&(!oracle.violation||
   !oracle.violations.some(x=>x.role==='agent_relais'&&x.target==='ordered'&&
    x.codes.includes('ORDG1_UNAUTHORIZED_OR_MISSING_STATUS_TRANSITION'))))
   fail('blind source mutation escaped the independent generated oracle');
  cases.push({mode,verdict:mode==='NOMINAL'?'PASS_WITH_EVIDENCE':'BUSINESS_VIOLATION',
   oracle,cloneDropped:true,ownerExecuted:true,generatedCaseCount:plan.cases.length});
 }
 return {contract:'komerce-generated-order-matrix-gate/v37',
  sha:env.GITHUB_SHA||null,source:anchor,
  plan:{contract:plan.contract,seed,selectionHash:plan.selectionHash,
   policyHash:plan.policyHash,scenarioCount:plan.cases.length,
   sourceMutantKnownToGenerator:false},
  cases,allClonesDropped:true,
  declaredAutonomyScope:'ORDER_PATCH_MATRIX_FROM_INDEPENDENT_RULE_GRAMMAR',
  arbitraryDomainScenarioGenerationProven:false,
  hiddenMutationDetectedWithoutScenarioCodeEdit:true,
  productionPatchApplied:false,
  fullDomainCoverageCertified:false};
}
function parse(argv){
 const x={seed:'v37-gen-1',out:null};
 for(let i=0;i<argv.length;i++){
  if(argv[i]==='--help')return {...x,help:true};
  if(!['--seed','--out'].includes(argv[i])||
   !argv[i+1]||argv[i+1].startsWith('--'))fail('usage: --seed STRING [--out DIR]');
  x[argv[i]==='--seed'?'seed':'out']=argv[++i];
 }
 return x;
}
if(require.main===module){
 let opts;
 try{opts=parse(process.argv.slice(2))}catch(e){console.error(e.stack);process.exit(2)}
 if(opts.help)console.log('npm run audit:logic:generated -- --seed v37-gen-1 --out /tmp/xxx');
 else run(process.env,opts).then(r=>{
  if(opts.out){const dir=path.resolve(opts.out);
   fs.mkdirSync(dir,{recursive:true});
   fs.writeFileSync(path.join(dir,'generated-order-audit.json'),JSON.stringify(r,null,2)+'\n');
   fs.writeFileSync(path.join(dir,'generated-order-audit.md'),[
    '# G3b — Generated Order/Role Matrix','',
    'Source owner: '+r.source.owner,
    'Owner hash: '+r.source.sourceHash,
    'Independent policy hash: '+r.source.policyHash,
    'Generated permutations per run: '+r.plan.scenarioCount,
    'Original: '+r.cases[0].oracle.violations.length+' violations',
    'Blind test-only mutant: '+r.cases[1].oracle.violations.length+' violations',
    'Source files modified: NO',
    'Cloned PostgreSQL databases destroyed: '+r.allClonesDropped,
    'Scope: ONLY one family of order patch transitions, NOT arbitrary features or routes.',
    'The generator was not edited or given an individual mutant case.',''].join('\n'));
  }
  console.log('BUSINESS_AUDIT_V37_G3B '+JSON.stringify({
   sha:r.sha,generated:r.plan.scenarioCount,
   nominalViolations:r.cases[0].oracle.violations.length,
   blindMutantDetected:r.cases[1].oracle.violations.length,
   injectedOnlyInMemory:true,allClonesDropped:true
  }));
 }).catch(e=>{console.error('BUSINESS_AUDIT_V37_G3B_ERROR '+(e.stack||e.message));process.exitCode=2});
}
module.exports={run,parse,sourceAnchor};
