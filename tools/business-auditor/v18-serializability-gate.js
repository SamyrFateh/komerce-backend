#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {explore}=require('./v18-serializability-runner');
const {inspect}=require('./v18-serializability-predicate');
const ROOT=path.resolve(__dirname,'../..');
const files=['services/auto-parcel.js','tools/business-auditor/v16-healing-runner.js',
 'tools/business-auditor/v18-serializability-runner.js',
 'tools/business-auditor/v18-serializability-predicate.js'];
async function execute(out,env=process.env){
 if(!out||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')||!/^\d+$/.test(env.GITHUB_RUN_ID||''))
  throw Error('TOOL_ERROR: CI source and run identity missing');
 const sha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
 if(sha!==env.GITHUB_SHA)throw Error('TOOL_ERROR: source SHA mismatch');
 const raw=await explore(env),verdict=inspect(raw);
 const hashes=Object.fromEntries(files.map(p=>[p,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,p))).digest('hex')]));
 const report={contract:'komerce-serializability-proof/v18',sha,runId:env.GITHUB_RUN_ID,
  hashes,raw,verdict};
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'v18-serializability.json'),JSON.stringify(report,null,2)+'\n');
 console.log('BUSINESS_AUDIT_V18_SERIALIZABILITY '+JSON.stringify({
  sha,verdict:verdict.verdict,matchAB:verdict.matchAB,matchBA:verdict.matchBA,
  locked:verdict.lockWaitObserved,allClonesDropped:raw.allClonesDropped,
  selection:raw.selectionMode
 }));
 return report;
}
if(require.main===module)execute(process.argv[2]).catch(e=>{
 console.error('BUSINESS_AUDIT_V18_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2;
});
module.exports={execute};
