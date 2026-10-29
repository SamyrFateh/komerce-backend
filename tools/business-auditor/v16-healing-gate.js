#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {run}=require('./v16-healing-runner'),{interpret}=require('./v16-healing-predicate');
const root=path.resolve(__dirname,'../..');
const paths=['services/auto-parcel.js','tools/business-auditor/v16-cloned-database.js',
 'tools/business-auditor/v16-healing-runner.js','tools/business-auditor/v16-healing-predicate.js'];
async function main(out,env=process.env) {
 if(!out||!/^[0-9a-f]{40}$/.test(env.GITHUB_SHA||'')||
  !/^\d+$/.test(env.GITHUB_RUN_ID||''))
  throw Error('TOOL_ERROR: CI SHA and numeric run ID required');
 const sha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 if(sha!==env.GITHUB_SHA)throw Error('TOOL_ERROR: checked-out SHA differs from Actions');
 const raw=await run(env);
 const verdict=interpret(raw);
 const hashes=Object.fromEntries(paths.map(p=>[p,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]));
 const record={contract:'komerce-opus-healing-proof/v16',sha,runId:env.GITHUB_RUN_ID,
  hashes,raw,verdict};
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'v16-healing.json'),JSON.stringify(record,null,2)+'\n');
 console.log('BUSINESS_AUDIT_V16_HEALING '+JSON.stringify({
  sha,runId:record.runId,verdict:verdict.verdict,
  results:verdict.observed.map(x=>({mode:x.mode,maximum:x.maximum,
   result:x.verdict,arrived:x.synchronizedReads,lockWait:x.lockWaitObserved})),
  allClonesDropped:raw.allClonesDropped
 }));
 return record;
}
if(require.main===module)main(process.argv[2]).catch(e=>{
 console.error('BUSINESS_AUDIT_V16_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2;
});
module.exports={main};
