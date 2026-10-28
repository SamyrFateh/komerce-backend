#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {run}=require('./v15-concurrency-runner');
const {inspect}=require('./v15-concurrency-predicate');
const root=path.resolve(__dirname,'../..');
const files=['services/auto-parcel.js','tools/business-auditor/v15-concurrency-runner.js',
 'tools/business-auditor/v15-concurrency-predicate.js'];
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
async function main(out,env=process.env){
 if(!out||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')||!/^\\d+$/.test(env.GITHUB_RUN_ID||''))
  throw Error('TOOL_ERROR: CI SHA, run and output directory required');
 const sha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 if(sha!==env.GITHUB_SHA)throw Error('TOOL_ERROR: checked out source differs from CI');
 const raw=await run(env),verdict=inspect(raw);
 const report={contract:'komerce-physical-concurrency-proof/v15',
  sha,runId:String(env.GITHUB_RUN_ID),
  hashes:Object.fromEntries(files.map(f=>[f,hash(f)])),
  raw,verdict};
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'v15-concurrency.json'),JSON.stringify(report,null,2)+'\n');
 console.log('BUSINESS_AUDIT_V15_CONCURRENT '+JSON.stringify({
  sha,run:report.runId,verdict:verdict.verdict,
  limit:verdict.capacity,sequentialMax:verdict.sequential.maximum,
  concurrentMax:verdict.concurrent.maximum,
  cleanup:raw.allFixturesDeleted,novelCandidate:verdict.novelFamilyCandidate,
  scope:verdict.reproductionScope
 }));
 return report;
}
if(require.main===module)main(process.argv[2]).catch(e=>{
 console.error('BUSINESS_AUDIT_V15_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2;
});
module.exports={main};
