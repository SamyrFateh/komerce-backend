#!/usr/bin/env node
'use strict';
/**
 * V4.5: three independently reviewed real service adapters, local PG16 clone
 * per source variant. Source mutations are inspectable, not unknown or blind.
 * The same independent oracles judge healthy and altered services.
 */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),
 crypto=require('node:crypto');
const {assertLocalTestTarget}=require('./cli');
const {withClone}=require('./v16-cloned-database');
const fxMarket=require('./v31-fx-market-oracle');
const order=require('./v33-orders-sourcing-oracle');
const {CASES,OWNERS,select,judge}=require('./v45-three-domain-mutations');
const ROOT=path.resolve(__dirname,'../..');
const loader=path.join(__dirname,'v45-three-domain-loader.js');
const commands={FX:{child:'v31-fx-market-child.js',label:'BUSINESS_AUDIT_V31_PHYSICAL '},
 MARKET:{child:'v31-fx-market-child.js',label:'BUSINESS_AUDIT_V31_PHYSICAL '},
 ORDER:{child:'v33-orders-sourcing-child.js',label:'BUSINESS_AUDIT_V33_PHYSICAL '}};
function fail(s){throw Error('V45_PHYSICAL_TOOL_ERROR: '+s)}
function start(url,mode,mutation,env){
 const cmd=commands[mode];if(!cmd)fail('unknown reviewed mode');
 const args=mutation?['--require',loader]:[];
 args.push(path.join(__dirname,cmd.child),mode);
 const runEnv={...env,DATABASE_URL:url,NODE_ENV:'test',
  KOMERCE_DISABLE_CRONS:'true',
  KBA_V45_MUTANT:mutation||'',KBA_V45_MUTANT_APPLIED:'',
  KBA_V40_EVALUATOR_MUTANT:'',KBA_V44_BENCH_MUTANT:'',
  KBA_V23_MUTANT:'',KBA_V24_MUTANT:'',KBA_V25_FAULT:''};
 const output=cp.execFileSync(process.execPath,args,{
  cwd:ROOT,encoding:'utf8',timeout:45000,maxBuffer:1024*1024,
  env:runEnv,stdio:['ignore','pipe','pipe']});
 const line=output.split('\n').find(x=>x.startsWith(cmd.label));
 if(!line)fail('real worker produced no observation '+mode);
 return JSON.parse(line.slice(cmd.label.length));
}
async function one(mode,mutation,env,deps={}){
 assertLocalTestTarget(env);
 const x=await (deps.withClone||withClone)(env,url=>
  (deps.worker||start)(url,mode,mutation,env));
 if(x.cloneCreated!==true||x.cloneDroppedAfterExecution!==true)
  fail('disposable clone teardown not proven '+mode);
 const raw=x.result;
 if(raw?.mode!==mode||raw.v45MutationApplied!==Boolean(mutation))
  fail('mutation not applied or worker provenance mismatch '+mode);
 const checked=mode==='ORDER'?order.inspect(raw):fxMarket.inspect(raw);
 return {mode,mutation:mutation||null,signals:checked.signals,
  realOwnerExecuted:mode==='ORDER'?raw.ownerInvoked===true:raw.ownerExecuted===true,
  canonicalPg:raw.canonicalPg===true,cloneDropped:true,
  mutationApplied:raw.v45MutationApplied===true};
}
async function run({files=Object.values(OWNERS),out=null}={},env=process.env,deps={}){
 assertLocalTestTarget(env);
 const modes=select(files),sha=env.GITHUB_SHA||cp.execFileSync('git',['rev-parse','HEAD'],{
  cwd:ROOT,encoding:'utf8'}).trim();
 if(!/^[0-9a-f]{40}$/.test(sha))fail('missing source SHA');
 const sourceSha256=Object.fromEntries(modes.map(m=>{
  const file=OWNERS[m],source=fs.readFileSync(path.join(ROOT,file),'utf8');
  return [file,crypto.createHash('sha256').update(source).digest('hex')];
 }));
 const baseline=[];
 for(const mode of modes){
  const x=await one(mode,null,env,deps);
  if(!x.realOwnerExecuted||!x.canonicalPg||x.mutationApplied||
     !x.cloneDropped||x.signals.length)
   fail('healthy baseline not proven '+mode+':'+x.signals);
  baseline.push(x);
 }
 const records=[];
 for(const c of CASES.filter(x=>modes.includes(x.mode))){
  const x=await one(c.mode,c.id,env,deps);
  records.push({id:c.id,domain:c.domain,truth:c.truth,
   ...x});
 }
 const graded=judge(records,modes);
 const report={contract:'komerce-adversarial-physical-multidomain/v45',
  sha,sourceSha256,classification:'OPEN_REPRODUCIBLE_NOT_SEALED_BLIND',
  reviewedOwnerPaths:modes.map(m=>OWNERS[m]),
  certifiedDomainScope:modes,
  baseline,records:graded.records,
  summary:{...graded.summary,healthy:baseline.length,
   totalExperiments:baseline.length+records.length,
   allClonesDropped:[...baseline,...records].every(x=>x.cloneDropped),
   arbitraryUnknownBugDiscoveryCertified:false},
  limitations:['SOURCE_MUTATIONS_PRESELECTED',
   'ONLY_THREE_REVIEWED_OWNER_FUNCTIONS','NO_CONCURRENCY_OR_PSP',
   'NO_INDEPENDENT_SEALED_BLIND_G4']};
 if(out){
  fs.mkdirSync(path.resolve(out),{recursive:true});
  fs.writeFileSync(path.join(path.resolve(out),'g4-multidomain-adversarial.json'),
   JSON.stringify(report,null,2)+'\n');
 }
 console.log('AUDITOR_G4_MULTIDOMAIN '+JSON.stringify({
  sha,domains:modes,summary:report.summary,out}));
 if(graded.summary.status!=='PASS_REVIEWED_THREE_DOMAIN_ADVERSARIAL')
  fail('new mutation slipped past oracle or healthy equivalence flagged');
 return report;
}
function parse(argv){
 const opts={files:Object.values(OWNERS),out:null};
 for(let i=0;i<argv.length;i++){
  if(argv[i]==='--help')return {...opts,help:true};
  const flag=argv[i],value=argv[++i];
  if(!value||!['--files','--out'].includes(flag))
   fail('usage --files CSV --out DIR');
  if(flag==='--files')opts.files=value.split(',').map(s=>s.trim());
  else opts.out=value;
 }
 return opts;
}
if(require.main===module){
 const opts=parse(process.argv.slice(2));
 if(opts.help)console.log('Usage: node v45-multidomain-physical.js --files CSV --out DIR');
 else run(opts).catch(e=>{console.error(e.stack||e.message);process.exitCode=2});
}
module.exports={start,one,run,parse};
