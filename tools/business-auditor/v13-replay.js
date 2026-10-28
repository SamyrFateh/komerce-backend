#!/usr/bin/env node
'use strict';
/**
 * Local, replayable sequence proof. Re-executes actual service methods on a
 * checked local komerce_test database (canonical schema must be bootstrapped).
 * Does not trust the previous report to calculate the current verdict.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {executeCanonicalSequence}=require('./v13-canonical-parcel-runner');
const {interpret}=require('./v13-canonical-parcel-predicate');
const ROOT=path.resolve(__dirname,'../..');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,p))).digest('hex');
const PROOF_FILES=['services/auto-parcel.js','services/parcel-operations.js',
 'tools/business-auditor/v13-canonical-parcel-runner.js',
 'tools/business-auditor/v13-canonical-parcel-predicate.js'];
function parse(argv){
 const result={out:null,against:null};
 for(let i=0;i<argv.length;i++){
  const k=argv[i],v=argv[++i];
  if(!['--out','--against'].includes(k)||!v||v.startsWith('--'))
   throw Error('Usage: --out local-json-directory [--against prior-v13-report.json]');
  if(k==='--out')result.out=v;else result.against=v;
 }
 if(!result.out)throw Error('Output directory required');
 return result;
}
function signature(v){
 return JSON.stringify({verdict:v.verdict,issues:v.issues.map(i=>i.id).sort(),
  facts:Object.fromEntries(Object.entries(v.facts).map(([k,f])=>[k,{
   status:f.status,activeMemberships:f.activeMemberships,
   cancelledMemberships:f.cancelledMemberships,
   emptyOpenParcels:f.emptyOpenParcels,openParcels:f.openParcels,
   representedParcelCount:f.representedParcelIds.length
  }])),stepsEvaluated:v.stepsEvaluated,evidenceLevel:v.evidenceLevel});
}
function compare(reference,verdict,currentHash,sha){
 if(reference?.contract!=='komerce-canonical-pg-sequence-proof/v13'||
   !reference.verdict||!reference.sourceHashes||!/^[a-f0-9]{40}$/.test(reference.sha||''))
  throw Error('TOOL_ERROR: invalid previous proof');
 const original=interpret(reference.raw);
 if(signature(original)!==signature(reference.verdict))
  throw Error('TOOL_ERROR: previous raw state disagrees with its claimed verdict');
 const sameSha=reference.sha===sha;
 const sameSources=reference.sourceHashes.distributor===currentHash['services/auto-parcel.js']&&
  reference.sourceHashes.parcelSSOT===currentHash['services/parcel-operations.js']&&
  reference.sourceHashes.runner===currentHash['tools/business-auditor/v13-canonical-parcel-runner.js']&&
  reference.sourceHashes.independentPredicate===currentHash['tools/business-auditor/v13-canonical-parcel-predicate.js'];
 const sameFacts=signature(reference.verdict)===signature(verdict);
 return {referenceSha:reference.sha,sameCommit:sameSha,sameSourceHashes:sameSources,
  sameObservations:sameFacts,classification:
   sameSha&&sameSources&&sameFacts?'REPLAY_IDENTICAL_ON_SAME_SHA':
   sameFacts?'SAME_OBSERVATION_DIFFERENT_SOURCE':'REPLAY_OBSERVATION_CHANGED',
  note:'A replay comparison alone cannot certify the business policy or its HTTP reachability'};
}
async function replay(args,env=process.env){
 const opts=typeof args==='object'&&!Array.isArray(args)?args:parse(args||[]);
 const sha=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
 if(!/^[a-f0-9]{40}$/.test(sha))throw Error('TOOL_ERROR: git HEAD invalid');
 const raw=await executeCanonicalSequence(env);
 const verdict=interpret(raw);
 const hashes=Object.fromEntries(PROOF_FILES.map(p=>[p,hash(p)]));
 const comparison=opts.against?compare(JSON.parse(fs.readFileSync(opts.against,'utf8')),
  verdict,hashes,sha):null;
 const report={contract:'komerce-canonical-local-replay/v13',sha,mode:'LOCAL_TEST_ONLY',
  hashes,raw,verdict,comparison};
 fs.mkdirSync(opts.out,{recursive:true});
 fs.writeFileSync(path.join(opts.out,'v13-local-replay.json'),JSON.stringify(report,null,2)+'\n');
 console.log('BUSINESS_AUDIT_V13_REPLAY '+JSON.stringify({
  sha,verdict:verdict.verdict,issues:verdict.issues.map(i=>i.id),
  rollbackVerified:raw.rollbackVerified,comparison
 }));
 if(comparison&&!comparison.sameObservations)process.exitCode=3;
 return report;
}
if(require.main===module)replay(process.argv.slice(2)).catch(e=>{
 console.error('BUSINESS_AUDIT_V13_REPLAY_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2;
});
module.exports={parse,signature,compare,replay};
