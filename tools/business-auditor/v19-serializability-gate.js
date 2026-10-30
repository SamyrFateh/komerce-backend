#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {explore}=require('./v19-serializability-runner');
const {inspect}=require('./v19-serializability-predicate');
const ROOT=path.resolve(__dirname,'../..');
const sourceFiles=['services/auto-parcel.js','tools/business-auditor/v16-healing-runner.js',
 'tools/business-auditor/v19-serializability-runner.js',
 'tools/business-auditor/v19-serializability-predicate.js'];
async function main(out,env=process.env){
 if(!out||!/^[0-9a-f]{40}$/.test(env.GITHUB_SHA||'')||
  !/^\d+$/.test(env.GITHUB_RUN_ID||''))
  throw Error('TOOL_ERROR: source SHA and CI run required');
 const sha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
 if(sha!==env.GITHUB_SHA)throw Error('TOOL_ERROR: checkout and workflow ref disagree');
 const scenarios=[];
 for(const fixture of ['NEAR_CAPACITY','CANCELLED_EXISTING_PARCEL']){
  const raw=await explore(env,{fixture});
  const verdict=inspect(raw);
  scenarios.push({fixture,raw,verdict});
 }
 const hashes=Object.fromEntries(sourceFiles.map(p=>[p,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,p))).digest('hex')]));
 const result={contract:'komerce-opus-full-serializability-proof/v19',
  sha,runId:env.GITHUB_RUN_ID,hashes,scenarios};
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'v19-serializability.json'),JSON.stringify(result,null,2)+'\n');
 console.log('BUSINESS_AUDIT_V19_SERIALIZABILITY '+JSON.stringify({
  sha,scenarios:scenarios.map(s=>({fixture:s.fixture,verdict:s.verdict.verdict,
   deterministic:s.verdict.deterministic,raceErrors:s.verdict.raceErrors,
   constrainedFailure:s.verdict.constrainedFailure,
   allClonesDropped:s.raw.allClonesDropped}))}));
 return result;
}
if(require.main===module)main(process.argv[2]).catch(e=>{
 console.error('BUSINESS_AUDIT_V19_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2;
});
module.exports={main};
