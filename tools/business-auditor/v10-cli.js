#!/usr/bin/env node
'use strict';
/**
 * Single V1.0 entrypoint: default statically scans tracked repository.
 * --mode ci additionally validates same-run PostgreSQL/owner proof bundles.
 */
const fs=require('node:fs'),path=require('node:path');
const {buildWriterInventory}=require('./writer-inventory');
const {buildQualification}=require('./v07-qualification');
const {triage,certify,reportMarkdown}=require('./v10-engine');
function options(args){
 const o={mode:'static',out:null,evidenceDir:null};
 for(let i=0;i<args.length;i++){
  const k=args[i];
  if(k==='--help')return {...o,help:true};
  if(!['--mode','--out','--evidence-dir'].includes(k)||!args[i+1]||args[i+1].startsWith('--'))
   throw Error('Usage: --mode static|ci [--out DIRECTORY] [--evidence-dir DIRECTORY]');
  const v=args[++i];
  if(k==='--mode')o.mode=v;
  if(k==='--out')o.out=v;
  if(k==='--evidence-dir')o.evidenceDir=v;
 }
 if(!['static','ci'].includes(o.mode))throw Error('Unsupported scan mode');
 if(o.mode==='ci'&&!o.evidenceDir)throw Error('CI mode requires evidence directory');
 if(o.mode==='static'&&o.evidenceDir)throw Error('Static mode cannot claim a CI proof');
 return o;
}
function execute(o,{root=path.resolve(__dirname,'../..'),env=process.env}={}){
 const output=path.resolve(o.out||o.evidenceDir||'/tmp/komerce-business-auditor-v10');
 fs.mkdirSync(output,{recursive:true});
 if(o.mode==='static'){
  const w=buildWriterInventory(root),q=buildQualification(w);
  const queue=triage(q);
  const result={contract:'komerce-business-bug-hunter-static/v1',mode:'STATIC_ONLY',
   summary:{candidateOccurrences:queue.totalOccurrences,triageCases:queue.totalCases,
    reviewCases:queue.reviewCases,controlledTestViolations:null,productionIncidentsConfirmed:0},
   triageQueue:queue,
   limits:['Static candidates are not demonstrated execution paths or bugs',
    'No database or service writer was executed','Use dedicated CI proof mode for tested business invariant verdicts']};
  fs.writeFileSync(path.join(output,'v10-static-review.json'),JSON.stringify(result,null,2)+'\n');
  return {result,output};
 }
 if(!env.GITHUB_SHA||!env.GITHUB_RUN_ID||env.NODE_ENV!=='test'||
  env.KOMERCE_DISABLE_CRONS!=='true')
  throw Error('CI mode requires exact GitHub run in test-only environment');
 const dir=path.resolve(o.evidenceDir);
 if(dir!==output)throw Error('CI evidence and output directory must match');
 const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
 const result=certify({
  v09:read('v09-evidence.json'),audit:read('business-audit.json'),
  jest:read('v10-owner-jest.json'),observation:read('v10-paypal-observation.json')
 },{sha:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID});
 fs.writeFileSync(path.join(output,'v10-bug-hunt.json'),JSON.stringify(result,null,2)+'\n');
 fs.writeFileSync(path.join(output,'v10-bug-hunt.md'),reportMarkdown(result));
 return {result,output};
}
if(require.main===module){
 try{
  const opt=options(process.argv.slice(2));
  if(opt.help){
   console.log('Usage: npm run audit:business:v1 -- [--mode static|ci] [--out DIR] [--evidence-dir DIR]');
  }else{
   const r=execute(opt);
   console.log('BUSINESS_AUDITOR_V10 '+JSON.stringify(r.result.summary));
   console.log('REPORT '+r.output);
  }
 }catch(e){console.error('V1.0 scanner blocked: '+e.message);process.exitCode=2}
}
module.exports={options,execute};
