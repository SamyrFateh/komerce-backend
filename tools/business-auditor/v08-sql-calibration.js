#!/usr/bin/env node
'use strict';
/**
 * V0.8 SQL-detector sensitivity proof against disposable LOCAL PostgreSQL.
 * Writes only CREATE TEMP/INSERT temp shadow rows inside rolled-back tx.
 * Never imports/executes a Komerce business writer.
 */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {CASES}=require('./v08-sql-fixtures');
const {RULES}=require('./rules');
const {scanData}=require('./engine');
const {assertLocalTestTarget}=require('./cli');
function tableName(sql){
 const m=String(sql).match(/^CREATE TEMP TABLE ([a-z_][a-z0-9_]*) \(/);
 if(!m)throw Error('Unsafe fixture DDL (TEMP required)');
 return m[1];
}
function validateFixture(c){
 if(!RULES.some(r=>r.id===c.id)||!/^KBA-00[1-7]$/.test(c.id))
  throw Error('Unknown calibrated SQL rule: '+c.id);
 if(!/^[a-z_][a-z0-9_]*$/.test(c.bad))throw Error('Unsafe fixture reference');
 const allowed=new Set(c.tables.map(tableName));
 if(allowed.size!==c.tables.length)throw Error('Duplicate fixture tables');
 if(!Array.isArray(c.nominal)||!c.nominal.length||
  !Array.isArray(c.adversarial)||!c.adversarial.length)throw Error('Paired fixtures required');
 for(const sql of [...c.nominal,...c.adversarial]){
  const m=String(sql).match(/^INSERT INTO ([a-z_][a-z0-9_]*)\b/i);
  if(!m||!allowed.has(m[1])||sql.includes(';'))throw Error('Fixture INSERT outside TEMP tables');
 }
 return allowed;
}
async function calibrateOne(client,c){
 const tables=validateFixture(c);
 await client.query('BEGIN');
 let began=true;
 try{
  await client.query("SET LOCAL search_path TO pg_temp, public");
  await client.query("SET LOCAL statement_timeout = '15000ms'");
  for(const ddl of c.tables)await client.query(ddl);
  for(const sql of c.nominal)await client.query(sql);
  const nominal=(await scanData(client,{ruleIds:[c.id],sampleLimit:5}))[0];
  assert.equal(nominal.status,'NO_SIGNAL_IN_SAMPLE_QUERY',c.id+' nominal must be clean');
  assert.deepEqual(nominal.samples,[]);
  for(const sql of c.adversarial)await client.query(sql);
  const bad=(await scanData(client,{ruleIds:[c.id],sampleLimit:5}))[0];
  assert.equal(bad.status,'DATA_INTEGRITY_SIGNAL',c.id+' adversarial not detected');
  assert.deepEqual(bad.samples,[c.bad],c.id+' must detect only injected counterexample');
  await client.query('ROLLBACK');began=false;
  for(const table of tables){
   const result=await client.query("SELECT to_regclass($1) AS found",['pg_temp.'+table]);
   assert.equal(result.rows[0]?.found,null,c.id+' failed transaction rollback');
  }
  return {id:c.id,nominal:'NO_SIGNAL_IN_TEMP_FIXTURE',
   adversarial:'INJECTED_COUNTEREXAMPLE_FOUND',
   detectedReference:c.bad,rollbackRestored:true,
   proof:'REAL_POSTGRESQL_TEMP_SHADOW_TABLES_NOT_CANONICAL_WRITER',
   actualBusinessPathProven:false,productionIncidentConfirmed:false};
 }finally{if(began)await client.query('ROLLBACK').catch(()=>{})}
}
async function run(env=process.env){
 assertLocalTestTarget(env);
 const {Pool}=require('pg');
 const pool=new Pool({connectionString:env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
 try{
  const client=await pool.connect();
  try{
   const results=[];
   for(const c of CASES)results.push(await calibrateOne(client,c));
   return {contract:'komerce-business-sql-calibration/v08',method:'DISPOSABLE_PG_TEMP_WITH_ROLLBACK',
    summary:{rulesCalibrated:results.length,nominalPassed:results.length,
     adversarialDetected:results.length,rollbackPassed:results.length,
     businessWriterExecutions:0,confirmedBusinessBugs:0},
    results,limits:['TEMP table fixtures calibrate SQL detector selectivity, not the true application or DB constraints',
     'Nominal/adversarial service execution is a separate V0.8 workstream',
     'No claim about staging/production, authorization or real money']};
  }finally{client.release()}
 }finally{await pool.end()}
}
if(require.main===module){
 run().then(report=>{
  const arg=process.argv.indexOf('--out');
  if(arg>=0){
   const output=process.argv[arg+1];if(!output)throw Error('--out expects a path');
   fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
   fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  }
  console.log('BUSINESS_AUDIT_V08_CALIBRATION '+JSON.stringify(report.summary));
 }).catch(e=>{console.error('V0.8 calibration blocked: '+e.message);process.exitCode=2});
}
module.exports={run,calibrateOne,validateFixture,tableName};
