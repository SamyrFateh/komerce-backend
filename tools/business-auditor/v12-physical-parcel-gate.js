#!/usr/bin/env node
'use strict';
/**
 * CI-owned V1.2 entrypoint. It executes the real owner and real PG writes,
 * evaluates an independent predicate and writes both raw & assessed evidence.
 * Ignores JSON emitted by legacy Jest probes.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const cp=require('node:child_process');
const {runPhysical}=require('./v12-physical-parcel-runner');
const {interpret}=require('./v12-physical-parcel-predicate');
const ROOT=path.resolve(__dirname,'../..');
function hash(filename){return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,filename))).digest('hex')}
async function execute(out,env=process.env){
 if(!out||!env.GITHUB_SHA||!env.GITHUB_RUN_ID||
    !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA)||!/^\d+$/.test(env.GITHUB_RUN_ID))
  throw Error('TOOL_ERROR: GitHub CI identity and output required');
 const checkout=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
 if(checkout!==env.GITHUB_SHA)throw Error('TOOL_ERROR: checkout differs from CI SHA');
 const raw=await runPhysical(env);
 const verdict=interpret(raw);
 const record={contract:'komerce-physical-business-proof/v12',
  runId:env.GITHUB_RUN_ID,sha:env.GITHUB_SHA,
  fileHashes:{
   businessWriter:hash('services/auto-parcel.js'),
   oracle:hash('tools/business-auditor/v12-physical-parcel-predicate.js'),
   harness:hash('tools/business-auditor/v12-physical-parcel-runner.js')
  },raw,verdict};
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'v12-raw-physical-parcel.json'),JSON.stringify(record,null,2)+'\n');
 console.log('BUSINESS_AUDIT_V12_PHYSICAL '+JSON.stringify({
  sha:record.sha,runId:record.runId,verdict:verdict.verdict,
  nominal:verdict.nominal,adverse:verdict.adverse,scope:verdict.evidenceScope
 }));
 return record;
}
if(require.main===module)execute(process.argv[2]).catch(e=>{
 console.error('BUSINESS_AUDIT_V12_TOOL_ERROR '+e.message);process.exitCode=2;
});
module.exports={execute,hash};
