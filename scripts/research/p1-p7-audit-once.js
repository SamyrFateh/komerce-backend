#!/usr/bin/env node
'use strict';
/**
 * ECO one-order P1-P7 audit. Real PostgreSQL owner readers ONLY.
 * Never infer a target from an environment default. No Railway connection.
 * Every SQL read takes place inside BEGIN READ ONLY / ROLLBACK.
 */
function parseArgs(argv) {
 const allowed=new Set(['--market','--product','--order-ref','--order-item']);
 const out={};
 for(let i=0;i<argv.length;i+=2) {
  if(!allowed.has(argv[i])||!argv[i+1]||argv[i+1].startsWith('--')||
     Object.prototype.hasOwnProperty.call(out,argv[i]))
   throw Error('Usage: --market KM --product UUID --order-ref REF --order-item UUID');
  out[argv[i]]=argv[i+1];
 }
 if([...allowed].some(k=>!out[k]))throw Error('All exact market, product, reference and item required');
 return {marketCode:out['--market'],productId:out['--product'],
  orderReference:out['--order-ref'],orderItemId:out['--order-item']};
}
function assertLocalTestTarget(env) {
 if(env.NODE_ENV!=='test'||env.KOMERCE_DISABLE_CRONS!=='true') {
  throw Error('R&D audit requires NODE_ENV=test and KOMERCE_DISABLE_CRONS=true');
 }
 if(!env.DATABASE_URL)throw Error('DATABASE_URL must be explicit');
 let u;try{u=new URL(env.DATABASE_URL)}catch{throw Error('Invalid DATABASE_URL')}
 const host=u.hostname.toLowerCase().replace(/^\[|\]$/g,'');
 const dbname=decodeURIComponent(u.pathname.replace(/^\//,''));
 if(!['localhost','127.0.0.1','::1'].includes(host)||dbname!=='komerce_test') {
  throw Error('Only local komerce_test is authorized; Railway/staging/prod refused');
 }
}
async function execute(argv=process.argv.slice(2),env=process.env,deps={}) {
 assertLocalTestTarget(env);
 const exact=parseArgs(argv);
 const db=deps.db||require('../../db');
 const collect=deps.collect||require('./p1-p7-canonical-collector').collectP1P7Canonical;
 let client;
 try {
  client=await db.connect();
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout = '15000ms'");
  const report=await collect(client,exact);
  return {...report,transaction_mode:'REPEATABLE_READ_READ_ONLY_ROLLBACK',
   command:'audit:logic:p1p7',localTestOnly:true};
 } finally {
  if(client) {
   await client.query('ROLLBACK').catch(()=>{});
   client.release();
  }
  if(!deps.db && db.pool?.end)await db.pool.end();
 }
}
if(require.main===module){
 execute().then(report=>{
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(report.owner_read_errors?.length)process.exitCode=2;
 }).catch(err=>{console.error('P1-P7 ECO blocked: '+err.message);process.exitCode=2});
}
module.exports={parseArgs,assertLocalTestTarget,execute};
