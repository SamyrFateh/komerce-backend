#!/usr/bin/env node
'use strict';
/**
 * Reproducible adversarial test of G3 inventory detection on local PG clones.
 * The mutation cases are not the G3 evaluator's fixed 2 mutants.
 * Not independent sealed blind G4; never authorizes release by itself.
 */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {assertLocalTestTarget}=require('./cli');
const {execute}=require('./v40-generated-inventory');
const {cases,judge}=require('./v44-adversarial-mutations');
const ROOT=path.resolve(__dirname,'../..');
const fail=m=>{throw Error('V44_ADVERSARIAL_TOOL_ERROR: '+m)};
async function run({out=null}={},env=process.env,deps={}){
 assertLocalTestTarget(env);
 const sha=env.GITHUB_SHA||cp.execFileSync('git',['rev-parse','HEAD'],{
  cwd:ROOT,encoding:'utf8'}).trim();
 if(!/^[a-f0-9]{40}$/.test(sha))fail('source sha invalid');
 const specs=[0,2].map(extraLines=>({
  contract:'komerce-generated-inventory-case/v40',relation:'IMPLICIT',extraLines}));
 const executeOne=deps.execute||execute;
 const baseline=[];
 for(const spec of specs)baseline.push(await executeOne(spec,env,null));
 if(baseline.some(x=>x.verdict!=='PASS_WITH_EVIDENCE'||
    !x.cloneDropped||!x.canonicalPostgres))
  fail('healthy source failed independent oracle');
 const results=[];
 for(const c of cases){
  const executions=[];
  for(const spec of specs)executions.push(await executeOne(spec,env,'V44:'+c.id));
  results.push({id:c.id,executions});
 }
 const proof=judge(results);
 const output={contract:'komerce-inventory-adversarial-regression/v44',
  sha,classification:'OPEN_REPRODUCIBLE_NOT_SEALED_INDEPENDENT_BLIND',
  supportedScope:'inventory receiveItem nominal no-compatible-parcel',
  unsupportedClasses:['concurrency','multi-domain','arbitrary-new-input-discovery'],
  cases:proof.records,summary:{...proof.summary,healthy:baseline.length,
   baselineFalsePositives:0,totalExecutions:baseline.length+cases.length*specs.length,
   allClonesDropped:true}};
 if(out){
  fs.mkdirSync(path.resolve(out),{recursive:true});
  fs.writeFileSync(path.join(path.resolve(out),'g4-adversarial-inventory.json'),
   JSON.stringify(output,null,2)+'\n');
 }
 console.log('AUDITOR_G4_ADVERSARIAL '+JSON.stringify({
  sha,summary:output.summary,classification:output.classification,out}));
 if(proof.summary.status!=='PASS_ADVERSARIAL_INVENTORY')
  fail('observed regressions or equivalent false positives');
 return output;
}
function parse(argv){
 const o={out:null};
 for(let i=0;i<argv.length;i++){
  if(argv[i]==='--help')return {...o,help:true};
  if(argv[i]!=='--out'||!argv[i+1])fail('usage: --out DIR');
  o.out=argv[++i];
 }
 return o;
}
if(require.main===module)run(parse(process.argv.slice(2))).catch(e=>{
 console.error(e.stack||e.message);process.exitCode=2;
});
module.exports={run,parse};
