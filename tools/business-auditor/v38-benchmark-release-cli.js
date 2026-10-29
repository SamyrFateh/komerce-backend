#!/usr/bin/env node
'use strict';
/**
 * Read-only G4/G5 certification of evidence from a previously executed FULL
 * local-PG audit. Does not touch databases, APIs, GitHub, staging or main.
 */
const fs=require('node:fs'),path=require('node:path');
const {benchmark,markdown:benchmarkMd}=require('./v38-calibration-benchmark');
const {readiness,markdown:releaseMd}=require('./v38-release-readiness');
function parse(args){
 const x={audit:null,out:null,impact:null,install:null,mainDiff:null,requireGo:false};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--help')return {...x,help:true};
  if(args[i]==='--require-go'){x.requireGo=true;continue;}
  if(!['--audit','--out','--impact','--install','--main-diff'].includes(args[i])||!args[i+1])
   throw Error('G4_G5_CLI_TOOL_ERROR: --audit PATH --out DIRECTORY [--impact PLAN]');
  const key=args[i]==='--main-diff'?'mainDiff':args[i].slice(2),value=args[++i];
  x[key]=value;
 }
 if(!x.audit||!x.out)throw Error('G4_G5_CLI_TOOL_ERROR: --audit and --out required');
 return x;
}
function run(argv=process.argv.slice(2),deps={}){
 const opts=parse(argv);
 if(opts.help)return {help:true};
 const read=deps.read||((f)=>JSON.parse(fs.readFileSync(path.resolve(f),'utf8')));
 const audit=read(opts.audit),impactPlan=opts.impact?read(opts.impact):null,
 installEvidence=opts.install?read(opts.install):null,
 mainDiff=opts.mainDiff?read(opts.mainDiff):null;
 const b=benchmark(audit),g=readiness({audit,benchmark:b,impactPlan,installEvidence,mainDiff});
 const out=path.resolve(opts.out);
 fs.mkdirSync(out,{recursive:true});
 for(const [name,data] of [['g4-calibration.json',b],['g5-release-readiness.json',g]])
  fs.writeFileSync(path.join(out,name),JSON.stringify(data,null,2)+'\n');
 fs.writeFileSync(path.join(out,'g4-calibration.md'),benchmarkMd(b)+'\n');
 fs.writeFileSync(path.join(out,'g5-release-readiness.md'),releaseMd(g)+'\n');
 console.log('BUSINESS_AUDIT_G4_G5_RELEASE '+JSON.stringify({
  sha:audit.sha,calibration:b.calibrationGate,knownCases:b.calibration.cases,
  truePositive:b.calibration.truePositive,trueNegative:b.calibration.trueNegative,
  falsePositive:b.calibration.falsePositive,falseNegative:b.calibration.falseNegative,
  blindProof:b.outOfSample.independentBlindBenchmarkAccepted,
  g4:b.g4ReleaseGate,g5:g.decision,mainMergeAuthorized:g.mergeMainAuthorized,
  blockers:g.blockers,out}));
 return {benchmark:b,release:g,out};
}
function exitCodeFor({release},requireGo){
 return requireGo&&release?.decision!=='GO'?1:0;
}
if(require.main===module)try{
 const argv=process.argv.slice(2),opts=parse(argv),x=run(argv);
 if(x.help)console.log('Usage: node v38-benchmark-release-cli.js --audit FULL/unified-audit.json --out DIR [--require-go]');
 else if(exitCodeFor(x,opts.requireGo)){
  console.error('G5_RELEASE_NO_GO: certification blocked; see g5-release-readiness.json');
  process.exitCode=1;
 }
}catch(e){console.error('G4_G5_TOOL_ERROR '+e.message);process.exitCode=2}
module.exports={run,parse,exitCodeFor};
