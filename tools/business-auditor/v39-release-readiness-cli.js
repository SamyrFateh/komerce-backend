#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {check,markdown}=require('./v39-release-readiness');
function parse(argv){
 const args={unified:null,targeted:null,generated:null,benchmark:null,out:null};
 for(let i=0;i<argv.length;i++){
  if(argv[i]==='--help')return {...args,help:true};
  const field=argv[i].slice(2);
  if(!Object.hasOwn(args,field)||!argv[i+1]||argv[i+1].startsWith('--'))
   throw Error('V39_RELEASE_TOOL_ERROR: required --unified --targeted --generated --benchmark --out');
  args[field]=argv[++i];
 }
 if(Object.values(args).some(x=>!x))throw Error('V39_RELEASE_TOOL_ERROR: incomplete evidence paths');
 return args;
}
function run(a,env=process.env){
 const inputs={};
 for(const key of ['unified','targeted','generated','benchmark'])
  inputs[key]=JSON.parse(fs.readFileSync(path.resolve(a[key]),'utf8'));
 const r=check(inputs);
 if(env.GITHUB_SHA&&r.sha!==env.GITHUB_SHA)
  throw Error('V39_RELEASE_TOOL_ERROR: commit SHA not pinned');
 const d=path.resolve(a.out);fs.mkdirSync(d,{recursive:true});
 fs.writeFileSync(path.join(d,'release-readiness.json'),JSON.stringify(r,null,2)+'\n');
 fs.writeFileSync(path.join(d,'release-readiness.md'),markdown(r)+'\n');
 console.log('BUSINESS_AUDIT_V39_RELEASE_READINESS '+JSON.stringify({
  sha:r.sha,verdict:r.verdict,blockers:r.blockers,
  passed:r.summary.passedGates,failed:r.summary.failedGates,
  releaseAllowed:r.releaseAllowed,out:d}));
 return r;
}
if(require.main===module){
 try{const a=parse(process.argv.slice(2));
  if(a.help)console.log('npm run audit:logic:release-check -- --unified JSON --targeted JSON --generated JSON --benchmark JSON --out DIR');
  else run(a);
 }catch(e){console.error(e.stack);process.exitCode=2}
}
module.exports={parse,run};
