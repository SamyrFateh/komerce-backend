#!/usr/bin/env node
'use strict';
/* G4 pilot: strictly read existing immutable proof artifacts from one commit.
 * No PostgreSQL, no PSP and no source code mutation/execution here.
 */
const fs=require('node:fs'),path=require('node:path');
const {build,digest}=require('./v38-benchmark');
function fail(s){throw Error('V38_BENCHMARK_CLI_TOOL_ERROR: '+s)}
function parse(argv){
 const args={baseline:null,generated:null,out:null};
 for(let i=0;i<argv.length;i++){
  const key=argv[i];
  if(key==='--help')return {...args,help:true};
  if(!['--baseline','--generated','--out'].includes(key)||!argv[i+1]||
   argv[i+1].startsWith('--'))fail('usage --baseline JSON --generated JSON --out DIR');
  args[key.slice(2)]=argv[++i];
 }
 if(!args.baseline||!args.generated||!args.out)fail('all three paths required');
 return args;
}
function run(args,env=process.env){
 const a=JSON.parse(fs.readFileSync(path.resolve(args.baseline),'utf8'));
 const b=JSON.parse(fs.readFileSync(path.resolve(args.generated),'utf8'));
 const r=build(a,b);
 if(env.GITHUB_SHA&&r.sha!==env.GITHUB_SHA)fail('benchmark mixed commit SHA');
 const dir=path.resolve(args.out);fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'benchmark.json'),JSON.stringify(r,null,2)+'\n');
 fs.writeFileSync(path.join(dir,'benchmark.md'),digest(r)+'\n');
 console.log('BUSINESS_AUDIT_V38_BENCHMARK '+JSON.stringify({
  sha:r.sha,samples:r.confusion.total,tp:r.confusion.tp,
  fp:r.confusion.fp,fn:r.confusion.fn,tn:r.confusion.tn,
  blindMutationClasses:r.limits.hiddenMutationClassCount,
  releaseGO:r.limits.notAReleaseGO===false,reportDirectory:dir
 }));
 return r;
}
if(require.main===module){
 try{
  const args=parse(process.argv.slice(2));
  if(args.help)console.log('npm run audit:logic:benchmark -- --baseline /tmp/v35/unified-audit.json --generated /tmp/v37/generated-order-audit.json --out /tmp/v38');
  else run(args);
 }catch(e){console.error('BUSINESS_AUDIT_V38_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2}
}
module.exports={parse,run};
