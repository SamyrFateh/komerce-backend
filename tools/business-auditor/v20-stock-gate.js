#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {explore}=require('./v20-stock-runner');
const {inspect}=require('./v20-stock-predicate');
const ROOT=path.resolve(__dirname,'../..');
const sources=['services/product-stock-service.js',
 'tools/business-auditor/v20-serial-kernel.js',
 'tools/business-auditor/v19-serializability-predicate.js',
 'tools/business-auditor/v20-stock-runner.js',
 'tools/business-auditor/v20-stock-predicate.js'];
async function main(out,env=process.env){
 if(!out||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')||
   !/^\d+$/.test(env.GITHUB_RUN_ID||''))
  throw Error('TOOL_ERROR: CI source and run required');
 const sha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
 if(sha!==env.GITHUB_SHA)throw Error('TOOL_ERROR: wrong source checkout');
 const scenarios=[];
 for(const n of [1,2]){
  const raw=await explore(env,n);
  scenarios.push({stock:n,raw,verdict:inspect(raw)});
 }
 const hashes=Object.fromEntries(sources.map(p=>[p,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,p))).digest('hex')]));
 const proof={contract:'komerce-physical-negative-stock-control/v20',
  sha,runId:env.GITHUB_RUN_ID,hashes,scenarios};
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'v20-stock-control.json'),JSON.stringify(proof,null,2)+'\n');
 console.log('BUSINESS_AUDIT_V20_STOCK '+JSON.stringify({
  sha,scenarios:scenarios.map(s=>({stock:s.stock,verdict:s.verdict.verdict,
    negativeControlPassed:s.verdict.negativeControlPassed,
    raceErrors:s.verdict.raceErrors,stockAfter:s.raw.cases[3].after.stock,
    clonesDropped:s.raw.allClonesDropped}))}));
 return proof;
}
if(require.main===module)main(process.argv[2]).catch(e=>{
 console.error('BUSINESS_AUDIT_V20_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2;
});
module.exports={main};
