#!/usr/bin/env node
'use strict';
/**
 * Independent orchestration. NO app server/DB module loaded.
 * Default: static-only. --mode data/all explicitly enables LOCAL TEST DB
 * via pg.Pool with a READ ONLY transaction; staging/Railway/prod refused.
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');
const {scanData,withReadOnlyTransaction,summarize,reportMarkdown}=require('./engine');
const ROOT=path.resolve(__dirname,'../..');
function parseArgs(argv){
 const o={mode:'code',sampleLimit:25,base:null,out:null};
 const allowed=new Set(['--mode','--out','--base','--sample-limit']);
 for(let i=0;i<argv.length;i++){
  const key=argv[i];
  if(key==='--help')return {...o,help:true};
  if(!allowed.has(key)||!argv[i+1]||argv[i+1].startsWith('--'))
   throw Error('Usage: --mode code|data|all [--out DIR] [--sample-limit 1..100] [--base COMMIT]');
  const v=argv[++i];
  if(key==='--mode')o.mode=v;
  else if(key==='--out')o.out=v;
  else if(key==='--base')o.base=v;
  else if(key==='--sample-limit')o.sampleLimit=Number(v);
 }
 if(!['code','data','all'].includes(o.mode))throw Error('Unsupported --mode');
 if(!Number.isInteger(o.sampleLimit)||o.sampleLimit<1||o.sampleLimit>100)
  throw Error('--sample-limit expects integer 1..100');
 if(o.base&&!/^[0-9A-Za-z._^~/-]{1,100}$/.test(o.base))throw Error('Invalid --base');
 return o;
}
function assertLocalTestTarget(env){
 if(env.NODE_ENV!=='test'||env.KOMERCE_DISABLE_CRONS!=='true')
  throw Error('Data audit requires NODE_ENV=test and KOMERCE_DISABLE_CRONS=true');
 if(!env.DATABASE_URL)throw Error('Explicit DATABASE_URL required for data audit');
 let url;try{url=new URL(env.DATABASE_URL)}catch{throw Error('Invalid DATABASE_URL')}
 const hostname=url.hostname.toLowerCase().replace(/^\[|\]$/g,'');
 const dbname=decodeURIComponent(url.pathname.slice(1));
 if(url.protocol!=='postgres:'&&url.protocol!=='postgresql:')
  throw Error('PostgreSQL URL required');
 if(!['127.0.0.1','localhost','::1'].includes(hostname)||dbname!=='komerce_test')
  throw Error('Only local komerce_test allowed: Railway/staging/production rejected');
 return true;
}
function gitHead(){
 const p=cp.spawnSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'});
 return p.status===0?p.stdout.trim():null;
}
function runExistingStatic({base}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'komerce-business-static-'));
 try{
  const args=[path.join(ROOT,'scripts/audit-logic.js'),'--static-only','--base',base||'HEAD','--out',dir];
  const p=cp.spawnSync(process.execPath,args,{cwd:ROOT,encoding:'utf8',
   timeout:180000,maxBuffer:30*1024*1024});
  if(p.status!==0||p.error)throw Error('Static scanner failed: '+
   (p.error?.message||p.stderr||p.stdout||'unknown').slice(-1200));
  const r=JSON.parse(fs.readFileSync(path.join(dir,'audit.json'),'utf8'));
  if(r.contract!=='komerce-audit-logic-v1'||!Array.isArray(r.findings))
   throw Error('Unexpected static scanner contract');
  return r;
 }finally{
  fs.rmSync(dir,{recursive:true,force:true});
 }
}
async function runIndependent(argv=process.argv.slice(2),env=process.env,deps={}){
 const options=parseArgs(argv);
 if(options.help)return {help:true};
 const wantsCode=options.mode!=='data',wantsData=options.mode!=='code';
 // Fail before touching the DB or writing a report if source is not allowed.
 if(wantsData)assertLocalTestTarget(env);
 const staticResult=wantsCode?
  await (deps.staticRunner||runExistingStatic)({base:options.base}):null;
 let dataResults=null;
 if(wantsData){
  const factory=deps.poolFactory||((url)=>{
   const {Pool}=require('pg');return new Pool({connectionString:url,max:1,connectionTimeoutMillis:5000});
  });
  const pool=await factory(env.DATABASE_URL);
  try{
   dataResults=await withReadOnlyTransaction(pool,client=>scanData(client,{
    sampleLimit:options.sampleLimit,
   }));
  }finally{if(pool?.end)await pool.end()}
 }
 const report={
  contract:'komerce-independent-business-auditor/v1',
  mode:options.mode,
  executedAt:new Date().toISOString(),
  git:{sha:deps.sha||gitHead(),baseline:options.base||'HEAD',
   comparison:options.base?'EXPLICIT_BASE':'SELF_BASELINE_NO_NOVELTY_CLAIM'},
  code:staticResult?{status:'STATIC_HEURISTICS_ONLY',
   scannedFiles:staticResult.scannedFiles,trackedFiles:staticResult.trackedFiles,
   findings:staticResult.findings,newFindings:options.base?staticResult.newFindings:null,
   comparisonBase:staticResult.base}:null,
  data:dataResults?{status:'EXECUTED_REPEATABLE_READ_READ_ONLY_ROLLBACK',
   sampleLimit:options.sampleLimit,results:dataResults}:null,
  permissions:{dataTarget:wantsData?'LOCAL_KOMERCE_TEST_ONLY':'NO_DATABASE_CONNECTION',
   writerCalls:false,mutationTestsExecuted:false},
 };
 report.summary=summarize({staticResult,dataResults,mode:options.mode});
 const out=options.out?path.resolve(options.out):fs.mkdtempSync(path.join(os.tmpdir(),'komerce-independent-audit-'));
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'business-audit.json'),JSON.stringify(report,null,2)+'\n');
 fs.writeFileSync(path.join(out,'business-audit.md'),reportMarkdown(report));
 return {...report,reportDirectory:out};
}
if(require.main===module){
 runIndependent().then(r=>{
  if(r.help){
   console.log('Usage: npm run audit:logic:full -- --mode code|data|all [--out DIR] [--sample-limit 1..100] [--base SHA]');
   console.log('Default code-only; data/all require a LOCAL test PostgreSQL komerce_test, NODE_ENV=test and KOMERCE_DISABLE_CRONS=true.');
  }else{
   console.log('Komerce business auditor — '+r.mode+' — '+r.summary.rulesWithEvidence+' SQL rule(s) with evidence');
   console.log('Static suspicions: '+(r.summary.staticSuspicions??'NOT_RUN')+
     ' | DB rules: '+(r.summary.dataRulesExecuted??'NOT_RUN'));
   console.log('Report: '+r.reportDirectory+'/business-audit.md');
  }
 }).catch(e=>{console.error('INDEPENDENT BUSINESS AUDIT BLOCKED: '+e.message);process.exitCode=2;});
}
module.exports={parseArgs,assertLocalTestTarget,runExistingStatic,runIndependent};
