#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {run}=require('./v17-quantity-matrix-runner'),{inspect}=require('./v17-quantity-matrix-predicate');
const root=path.resolve(__dirname,'../..');
const sources=['services/auto-parcel.js','tools/business-auditor/v16-cloned-database.js',
 'tools/business-auditor/v17-quantity-matrix-runner.js',
 'tools/business-auditor/v17-quantity-matrix-predicate.js'];
async function execute(out,env=process.env){
 if(!out||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')||!/^\d+$/.test(env.GITHUB_RUN_ID||''))
  throw Error('TOOL_ERROR: required SHA, run ID, output missing');
 const sha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 if(sha!==env.GITHUB_SHA)throw Error('TOOL_ERROR: checkout SHA mismatch');
 const raw=await run(env),verdict=inspect(raw);
 const hashes=Object.fromEntries(sources.map(p=>[p,crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(root,p))).digest('hex')]));
 const result={contract:'komerce-generated-capacity-proof/v17',
  sha,runId:env.GITHUB_RUN_ID,hashes,raw,verdict};
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'v17-quantity-matrix.json'),JSON.stringify(result,null,2)+'\n');
 console.log('BUSINESS_AUDIT_V17_QUANTITY_MATRIX '+JSON.stringify({
  sha,generated:verdict.evaluatedCases,semantics:verdict.semanticVerdict,
  signals:verdict.counts,cloneCleanup:raw.allClonesDropped,
  scope:'REAL_OWNER_SINGLE_TRANSACTION_CLONED_PG_SEMANTIC_AMBIGUITY'
 }));
 return result;
}
if(require.main===module)execute(process.argv[2]).catch(e=>{
 console.error('BUSINESS_AUDIT_V17_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2;
});
module.exports={execute};
