#!/usr/bin/env node
'use strict';
/**
 * G3 bounded generator for the inventory owner. Source impact selects a class
 * of canonical experiments; fixture variants are generated independently from
 * the evaluator's withheld source mutations and from the assertion oracle.
 * No service imports in this parent process.
 */
const cp=require('node:child_process'),fs=require('node:fs'),
 path=require('node:path'),crypto=require('node:crypto');
const {assertLocalTestTarget}=require('./cli');
const {withClone}=require('./v16-cloned-database');
const {sourceAnchor}=require('./v30-inventory-gate');
const {assess}=require('./v40-generated-inventory-oracle');
const ROOT=path.resolve(__dirname,'../..');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=s=>{throw Error('G3_GENERATED_TOOL_ERROR: '+s)};
const child=path.join(__dirname,'v30-inventory-physical-child.js');
const loader=path.join(__dirname,'v40-withheld-mutant-loader.js');
function plan({files,budget=6,anchor}){
 if(!Array.isArray(files)||!files.includes('services/inventory-service.js')||
   files.some(f=>typeof f!=='string'||f.startsWith('../')||f.includes('/../'))||
   !Number.isInteger(budget)||budget<2||budget>9||
   anchor?.contract!=='komerce-inventory-owner-source-anchor/v30'||
   !/^[a-f0-9]{64}$/.test(anchor.sourceHash||''))
  fail('explicit impacted canonical inventory owner, budget 2..9 and source anchor required');
 const candidates=[];
 for(const extraLines of [0,1,2])
  for(const relation of ['IMPLICIT','FOREIGN','OWN'])
   candidates.push({contract:'komerce-generated-inventory-case/v40',
    relation,extraLines});
 // Interleave before limiting, ensuring both nominal and adverse owner input
 // relations even for budget=2. No mutation knowledge is used to select cases.
 const selected=candidates.slice(0,budget);
 const checksum=digest({owner:anchor.service,hash:anchor.sourceHash,selected});
 return {contract:'komerce-generated-inventory-plan/v40',
  owner:anchor.service,anchorHash:anchor.sourceHash,
  selected,excluded:candidates.slice(budget),budget,
  selectionHash:checksum,mutationsVisibleToGenerator:false,
  fixtureDimensions:{extraLines:[0,1,2],relation:['IMPLICIT','FOREIGN','OWN']}};
}
function spawnOwner({spec,url,env,mutant=null}){
 const args=mutant?['--require',loader,child]:[child];
 args.push(spec.relation==='FOREIGN'?'FOREIGN_ORDER':'NOMINAL');
 const childEnv={...env,DATABASE_URL:url,NODE_ENV:'test',
  KOMERCE_DISABLE_CRONS:'true',
  KBA_V40_GENERATED_SPEC:Buffer.from(JSON.stringify(spec)).toString('base64'),
  KBA_V40_EVALUATOR_MUTANT:mutant||'',KBA_V40_MUTANT_APPLIED:'',
  KBA_V23_MUTANT:'',KBA_V24_MUTANT:'',KBA_V25_FAULT:'',
  KBA_V26_CRASH_ALLOWED:''};
 const stdout=cp.execFileSync(process.execPath,args,{
  cwd:ROOT,encoding:'utf8',timeout:35000,maxBuffer:1024*1024,
  stdio:['ignore','pipe','pipe'],env:childEnv});
 const label='BUSINESS_AUDIT_V30_INVENTORY ';
 const row=stdout.split('\n').find(x=>x.startsWith(label));
 if(!row)fail('owner worker produced no independent PostgreSQL observation');
 return JSON.parse(row.slice(label.length));
}
async function execute(spec,env,mutant=null,deps={}){
 const wrapper=await (deps.withClone||withClone)(env,url=>
  (deps.worker||spawnOwner)({spec,url,env,mutant}));
 if(wrapper?.cloneDroppedAfterExecution!==true||
    wrapper.cloneCreated!==true)fail('clone not proven created and dropped');
 const raw=wrapper.result;
 if(JSON.stringify(raw.generatedSpec)!==JSON.stringify(spec)||
    raw.mutationApplied!==Boolean(mutant))
  fail('generated fixture or withheld mutation provenance missing');
 const oracle=assess(raw);
 return {caseHash:digest(spec),spec,
  verdict:oracle.violation?'BUSINESS_VIOLATION':'PASS_WITH_EVIDENCE',
  oracle,sourceMutation:mutant||null,realOwnerCalled:true,
  canonicalPostgres:true,cloneDropped:true};
}
async function run({files=['services/inventory-service.js'],budget=6,
 evaluateWithheld=false,out=null}={},env=process.env,deps={}){
 assertLocalTestTarget(env);
 const anchor=await (deps.anchor||sourceAnchor)();
 const generated=plan({files,budget,anchor});
 const sha=env.GITHUB_SHA||cp.execFileSync('git',['rev-parse','HEAD'],{
  cwd:ROOT,encoding:'utf8'}).trim();
 if(!/^[a-f0-9]{40}$/.test(sha))fail('invalid source commit SHA');
 const baseline=[];
 for(const spec of generated.selected){
  const x=await execute(spec,env,null,deps);
  if(x.verdict!=='PASS_WITH_EVIDENCE')
   fail('healthy source violates independent oracle: '+JSON.stringify(x.oracle.signals));
  baseline.push(x);
 }
 const mutants=[];
 if(evaluateWithheld){
  const nominal=generated.selected.find(x=>x.relation==='IMPLICIT');
  const foreign=generated.selected.find(x=>x.relation==='FOREIGN');
  if(!nominal||!foreign)fail('required case families omitted');
  for(const [mutant,spec] of [['SKIP_COMPLETION',nominal],
    ['RELAX_FOREIGN_GUARD',foreign]]){
   const x=await execute(spec,env,mutant,deps);
   mutants.push(x);
  }
 }
 const detected=mutants.filter(x=>x.verdict==='BUSINESS_VIOLATION');
 const missed=mutants.filter(x=>x.verdict!=='BUSINESS_VIOLATION');
 const success=baseline.length===generated.selected.length&&
  (!evaluateWithheld||(mutants.length===2&&detected.length===2));
 const result={contract:'komerce-generated-experiment-proof/v1',
  sha,source:{service:anchor.service,hash:anchor.sourceHash},
  generatedPlan:generated,generatedCases:baseline.length,
  realOwnerOnClonedPg:true,independentOracle:true,
  withheldMutationDetected:evaluateWithheld&&detected.length===2,
  allClonesDropped:[...baseline,...mutants].every(x=>x.cloneDropped),
  benchmarkKind:'INTERNAL_WITHHELD_PILOT_NOT_INDEPENDENT_BLIND_G4',
  generatorDidNotChooseMutants:true,
  baseline,mutants,summary:{healthy:baseline.length,falsePositives:0,
   mutationCount:mutants.length,detected:detected.length,
   missed:missed.length,toolErrors:0,
   verdict:success?'PASS_BOUNDED_INVENTORY':'FAIL'}};
 if(out){
  const dir=path.resolve(out);fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'g3-generated-experiment.json'),
   JSON.stringify(result,null,2)+'\n');
 }
 console.log('BUSINESS_AUDIT_G3_GENERATED '+JSON.stringify({
  sha,generated:baseline.length,withheld:mutants.length,
  detected:detected.length,missed:missed.length,
  status:result.summary.verdict,out}));
 if(!success)fail('generated owner experiment failed to detect expected withheld mutations');
 return result;
}
function parse(argv){
 const o={files:['services/inventory-service.js'],budget:6,
  evaluateWithheld:false,out:null};
 for(let i=0;i<argv.length;i++){
  const k=argv[i];
  if(k==='--help')return {...o,help:true};
  if(k==='--evaluate-withheld'){o.evaluateWithheld=true;continue;}
  if(!['--files','--budget','--out'].includes(k)||!argv[i+1])
   fail('usage --files CSV --budget 2..9 --evaluate-withheld --out DIR');
  const v=argv[++i];
  if(k==='--files')o.files=v.split(',').map(x=>x.trim());
  if(k==='--budget')o.budget=Number(v);
  if(k==='--out')o.out=v;
 }
 return o;
}
if(require.main===module)run(parse(process.argv.slice(2))).catch(e=>{
 console.error('G3_GENERATED_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2;
});
module.exports={plan,spawnOwner,execute,run,parse};
