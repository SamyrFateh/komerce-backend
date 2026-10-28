'use strict';
/**
 * Strictly local test-only database cloning. The original komerce_test is a
 * template, never written; each experiment writes to a distinct disposable
 * database and teardown drops it. Requires CREATE DATABASE privilege in the
 * isolated GitHub Actions PostgreSQL container.
 */
const crypto=require('node:crypto');
const {assertLocalTestTarget}=require('./cli');
function localUrls(env) {
 assertLocalTestTarget(env);
 const template=new URL(env.DATABASE_URL);
 const admin=new URL(template);
 admin.pathname='/postgres';
 return {template,admin};
}
async function withClone(env,callback) {
 const {Client}=require('pg');
 const {template,admin}=localUrls(env);
 const name='kba_'+crypto.randomBytes(9).toString('hex');
 if(!/^kba_[a-f0-9]{18}$/.test(name))throw Error('TOOL_ERROR: invalid clone identifier');
 const root=new Client({connectionString:admin.toString(),connectionTimeoutMillis:5000});
 let created=false,connected=false;
 await root.connect();connected=true;
 try {
  const {rows:[identity]}=await root.query('SELECT current_database() AS db');
  if(identity.db!=='postgres')throw Error('TOOL_ERROR: wrong administration database');
  // Identifier is generated locally and strictly validated; never interpolated
  // from user input or a repository-controlled fixture.
  await root.query('CREATE DATABASE "'+name+'" TEMPLATE komerce_test');
  created=true;
  const cloned=new URL(template);
  cloned.pathname='/'+name;
  const {rows:[confirmed]}=await root.query('SELECT datname FROM pg_database WHERE datname=$1',[name]);
  if(confirmed?.datname!==name)throw Error('TOOL_ERROR: clone missing after creation');
  const result=await callback(cloned.toString(),name);
  return {result,cloneCreated:true,cloneDroppedAfterExecution:true,method:'CREATE_DATABASE_TEMPLATE_AND_DROP'};
 }finally {
  try {
   if(created) {
    // Never terminate a server connection; classify pool leaks as tool errors.
    // node-pg may finish socket teardown slightly after pool.end().
    // Wait for normal graceful disconnect; never terminate another backend.
    let active=[];
    const deadline=Date.now()+5000;
    do {
     ({rows:active}=await root.query(
      'SELECT pid,state,application_name FROM pg_stat_activity WHERE datname=$1',[name]));
     if(!active.length)break;
     await new Promise(resolve=>setTimeout(resolve,100));
    }while(Date.now()<deadline);
    if(active.length)
     throw Error('TOOL_ERROR: cloned PG sessions remained open after grace period: '+
      JSON.stringify(active.map(x=>({pid:x.pid,state:x.state,application:x.application_name}))));
    await root.query('DROP DATABASE IF EXISTS "'+name+'"');
    const {rows:[check]}=await root.query('SELECT count(*)::int AS n FROM pg_database WHERE datname=$1',[name]);
    if(Number(check.n)!==0)throw Error('TOOL_ERROR: cloned database still exists');
   }
  }finally {if(connected)await root.end()}
 }
}
module.exports={localUrls,withClone};
