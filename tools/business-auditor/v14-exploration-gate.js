#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {explore}=require('./v14-sequence-explorer');
const {inspect}=require('./v14-sequence-predicates');
const root=path.resolve(__dirname,'../..');
const paths=['services/auto-parcel.js','services/parcel-operations.js',
 'tools/business-auditor/v14-sequence-planner.js',
 'tools/business-auditor/v14-sequence-explorer.js',
 'tools/business-auditor/v14-sequence-predicates.js'];
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
async function main(out,env=process.env){
 if(!out||!/^\d+$/.test(String(env.GITHUB_RUN_ID))||!/^[0-9a-f]{40}$/.test(env.GITHUB_SHA||''))
  throw Error('TOOL_ERROR: CI run and SHA required');
 const checkout=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 if(checkout!==env.GITHUB_SHA)throw Error('TOOL_ERROR: wrong checked-out source');
 const raw=await explore(env,{maxDepth:4});
 const verdict=inspect(raw);
 const report={contract:'komerce-business-bounded-explorer-proof/v14',
  sha:checkout,runId:String(env.GITHUB_RUN_ID),
  sourceHashes:Object.fromEntries(paths.map(p=>[p,hash(p)])),
  raw,verdict,productionIncidentConfirmed:false};
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'v14-exploration.json'),JSON.stringify(report,null,2)+'\n');
 console.log('BUSINESS_AUDIT_V14_EXPLORER '+JSON.stringify({
  sha:report.sha,cases:verdict.plannedCases,steps:verdict.evaluatedSteps,
  signals:verdict.totalSignals,knownFamilySignals:verdict.knownFamilySignals,
  candidateNewFamilies:verdict.candidateNewFamilySignals,
  ruleSummary:verdict.signalCounts,exceptions:verdict.exceptions.length,
  rollback:raw.rollbackVerified,scope:verdict.scope
 }));
 return report;
}
if(require.main===module)main(process.argv[2]).catch(e=>{
 console.error('BUSINESS_AUDIT_V14_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2;
});
module.exports={main};
