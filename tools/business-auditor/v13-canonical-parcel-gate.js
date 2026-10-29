#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {executeCanonicalSequence}=require('./v13-canonical-parcel-runner');
const {interpret}=require('./v13-canonical-parcel-predicate');
const root=path.resolve(__dirname,'../..');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
async function run(out,env=process.env){
 if(!out||!/^\d+$/.test(String(env.GITHUB_RUN_ID))||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||''))
  throw Error('TOOL_ERROR: GitHub CI identity required');
 const sha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 if(sha!==env.GITHUB_SHA)throw Error('TOOL_ERROR: checkout/CI SHA mismatch');
 const raw=await executeCanonicalSequence(env);
 const verdict=interpret(raw);
 const report={contract:'komerce-canonical-pg-sequence-proof/v13',sha,runId:String(env.GITHUB_RUN_ID),
  sourceHashes:{
   distributor:hash('services/auto-parcel.js'),parcelSSOT:hash('services/parcel-operations.js'),
   runner:hash('tools/business-auditor/v13-canonical-parcel-runner.js'),
   independentPredicate:hash('tools/business-auditor/v13-canonical-parcel-predicate.js')
  },raw,verdict};
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'v13-canonical-parcel-proof.json'),JSON.stringify(report,null,2)+'\n');
 console.log('BUSINESS_AUDIT_V13_CANONICAL '+JSON.stringify({
  sha,runId:report.runId,verdict:verdict.verdict,
  issues:verdict.issues.map(i=>i.id),state:verdict.facts.after_redistribute,
  rolledBack:raw.rollbackVerified,scope:verdict.evidenceLevel
 }));
 return report;
}
if(require.main===module)run(process.argv[2]).catch(e=>{
 console.error('BUSINESS_AUDIT_V13_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2;
});
module.exports={run};
