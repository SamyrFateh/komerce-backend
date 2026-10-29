'use strict';
// PostgreSQL 16 ephemeral database only. Verifies the ACTUAL migration SQL.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {Client}=require('pg');
async function main(){
 const client=new Client({host:process.env.PGHOST||'127.0.0.1',
  port:Number(process.env.PGPORT||5432),database:process.env.PGDATABASE||'postgres',
  user:process.env.PGUSER||'postgres',password:process.env.PGPASSWORD||'postgres',
  connectionTimeoutMillis:5000,query_timeout:15000});
 await client.connect();
 try {
  await client.query('BEGIN');
  await client.query(`
    CREATE TABLE public.products (id uuid PRIMARY KEY);
    CREATE TABLE public.users (id uuid PRIMARY KEY);
  `);
  const file=path.resolve(__dirname,'../../migrations/351_catalog_media_recovery_audit.sql');
  await client.query(fs.readFileSync(file,'utf8'));
  const product='aaaaaaaa-0000-0000-0000-000000000010';
  const actor='bbbbbbbb-0000-0000-0000-000000000010';
  await client.query('INSERT INTO public.products (id) VALUES ($1)',[product]);
  await client.query('INSERT INTO public.users (id) VALUES ($1)',[actor]);
  const input=[product,'KPR-TEST-10','KSC-TEST-10',actor,['IMG-1'],'a'.repeat(64),0,1];
  const sql=`INSERT INTO public.catalog_media_recovery_audit
    (product_id,product_ref,candidate_ref,actor_user_id,source_media_ids,source_media_hash,active_before,active_after)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`;
  await client.query(sql,input);
  const audit=await client.query('SELECT * FROM public.catalog_media_recovery_audit');
  assert.equal(audit.rows.length,1);
  assert.equal(audit.rows[0].actor_user_id,actor);
  assert.deepEqual(audit.rows[0].source_media_ids,['IMG-1']);
  // Constraint failures happen inside savepoints to keep the test session valid.
  for(const bad of [[...input.slice(0,6),1,1],[...input.slice(0,6),0,0]]) {
    await client.query('SAVEPOINT negative_case');
    await assert.rejects(client.query(sql,bad));
    await client.query('ROLLBACK TO SAVEPOINT negative_case');
    await client.query('RELEASE SAVEPOINT negative_case');
  }
  await client.query('ROLLBACK');
  console.log('PASS physical PostgreSQL migration 351: actual DDL, actor FK, audit snapshot, invalid counts rejected');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
 finally{await client.end();}
}
main().then(()=>process.exit(0)).catch(e=>{console.error('FAIL migration 351',e);process.exit(1);});
