'use strict';
/**
 * One-shot SCHEMA-ONLY bootstrap for the quarantined Railway certification
 * project. This is deliberately not a general-purpose migration runner.
 * It refuses other Railway project/environment IDs, non-private database URLs,
 * databases containing ANY public user tables, and any dump with data writes.
 * No network calls to suppliers, payment providers or existing staging.
 */
const { Client } = require('pg');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ONLY_PROJECT='d675d8bd-7452-42f4-8ba5-cf8480959b96';
const ONLY_ENV='abfa50f5-6a56-4df0-88b2-27f7fc652608';
const ONLY_SERVICE='5b911a75-cd01-484a-ad58-fbd092183fdf';
function refuse(cond,reason){if(!cond)throw new Error('CERT_BOOTSTRAP_REFUSED: '+reason);}
async function main(){
 refuse(process.env.RAILWAY_PROJECT_ID===ONLY_PROJECT,'wrong_project');
 refuse(process.env.RAILWAY_ENVIRONMENT_ID===ONLY_ENV,'wrong_environment');
 refuse(process.env.RAILWAY_SERVICE_ID===ONLY_SERVICE,'wrong_service');
 refuse(process.env.KOMERCE_DISABLE_CRONS==='true','cron_must_be_disabled');
 refuse(process.env.KOMERCE_ENV==='staging','business_env_must_be_nonproduction');
 const raw=process.env.DATABASE_URL;
 refuse(typeof raw==='string' && raw.startsWith('postgres'),'missing_database_url');
 const url=new URL(raw);
 refuse(url.hostname.toLowerCase().endsWith('.railway.internal'),'database_must_be_private_railway');
 const dump=fs.readFileSync(path.join(__dirname,'../../docs/db/railway-live-schema.sql'),'utf8');
 const migration=fs.readFileSync(path.join(__dirname,'../../migrations/351_catalog_media_recovery_audit.sql'),'utf8');
 refuse(dump.includes('-- PostgreSQL database dump') && dump.includes('-- PostgreSQL database dump complete'),'not_schema_dump');
 refuse(!/^COPY\s|^INSERT\s+INTO\s|^UPDATE\s|^DELETE\s+FROM\s|^CREATE\s+DATABASE\s/gmi.test(dump),
   'dump_contains_data_or_database_commands');
 const client=new Client({connectionString:raw,connectionTimeoutMillis:15000,
   query_timeout:120000});
 await client.connect();
 try{
   const current=await client.query(`SELECT current_database() AS db,
     (SELECT count(*)::int FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n
       ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p')) AS table_count`);
   refuse(Number(current.rows[0].table_count)===0,'database_not_empty');
   await client.query('BEGIN');
   await client.query("SET LOCAL statement_timeout='120s'");
   try{
     await client.query(dump);
     // The schema snapshot predates the new business audit migration.
     await client.query(migration);
     const result=await client.query(`SELECT
       to_regclass('public.users') IS NOT NULL AS users,
       to_regclass('public.products') IS NOT NULL AS products,
       to_regclass('public.sourcing_candidates') IS NOT NULL AS sourcing,
       to_regclass('public.catalog_media') IS NOT NULL AS media,
       to_regclass('public.catalog_media_recovery_audit') IS NOT NULL AS recovery_audit,
       to_regclass('public.wallets') IS NOT NULL AS wallets`);
     refuse(Object.values(result.rows[0]).every(Boolean),'required_tables_missing');
     await client.query('COMMIT');
     console.log('CERT_SCHEMA_READY '+JSON.stringify({
       schemaOnly:true,isolated:true,project:ONLY_PROJECT,
       migration351:true,components:result.rows[0],
       schemaSHA256:crypto.createHash('sha256').update(dump).digest('hex').slice(0,14),
     }));
   }catch(error){
     await client.query('ROLLBACK').catch(()=>{});
     throw error;
   }
 }finally{await client.end();}
}
main().catch(err=>{console.error('CERT_SCHEMA_FAILED '+String(err?.message||err).slice(0,600));process.exitCode=1;});
