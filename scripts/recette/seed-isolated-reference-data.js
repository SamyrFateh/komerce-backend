'use strict';
/**
 * Idempotent, explicitly isolated railway recette bootstrap. No real account,
 * supplier, order, payment, shipment or customer record is copied.
 */
const bcrypt=require('bcryptjs');
const db=require('../../db');
const {seedReferenceData}=require('../seed-reference-data');
const TABLES=['dashboard_global_access_grants','catalog_global_access_grants',
 'sourcing_global_access_grants','pricing_global_access_grants'];
async function main(){
 if(process.env.KOMERCE_RECETTE_ISOLATED!=='true' ||
    process.env.KOMERCE_ENV!=='staging' ||
    !String(process.env.DATABASE_URL||'').includes('.railway.internal:')){
   throw Error('ISOLATED_RECETTE_DB_ONLY');
 }
 const password=process.env.ADMIN_PASSWORD;
 if(!password || password.length<32)throw Error('RECETTE_ADMIN_SECRET_REQUIRED');
 const client=await db.getClient();
 try{
  await client.query('BEGIN');
  const checks=await client.query(
    "SELECT to_regclass('public.catalog_media_recovery_audit') IS NOT NULL AS audit, " +
    "to_regclass('public.wallets') IS NOT NULL AS wallet"
  );
  if(!checks.rows[0].audit||!checks.rows[0].wallet)throw Error('RECETTE_SCHEMA_NOT_READY');
  const ref=await seedReferenceData(client);
  const email='recette-admin@example.invalid';
  let users=await client.query('SELECT id,role FROM users WHERE email=$1',[email]);
  let user;
  if(users.rows.length){
    user=users.rows[0];
    if(user.role!=='admin')throw Error('RECETTE_ADMIN_ROLE_CONFLICT');
  }else{
    const hash=await bcrypt.hash(password,12);
    const rows=await client.query(
      `INSERT INTO users (full_name,email,phone,password_hash,role,country,currency_pref)
       VALUES ('Opérateur recette fictif',$1,'+2690000099',$2,'admin','KM','KMF')
       RETURNING id,role`,[email,hash]);
    user=rows.rows[0];
  }
  for(const table of TABLES){
    if(!/^[a-z_]+$/.test(table))throw Error('invalid grant table');
    const present=await client.query('SELECT to_regclass($1) IS NOT NULL AS yes',
      ['public.'+table]);
    if(!present.rows[0].yes)throw Error('GRANT_TABLE_MISSING_'+table);
    await client.query('INSERT INTO '+table+
      '(user_id) VALUES ($1) ON CONFLICT DO NOTHING',[user.id]);
  }
  await client.query('COMMIT');
  console.log('RECETTE_REFERENCE_SEED_PASS: synthetic admin, four explicit grants, market/FX references; no real data');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
 finally{client.release();await db.pool?.end?.().catch(()=>{});}
}
main().then(()=>process.exit(0)).catch(err=>{
 console.error('RECETTE_REFERENCE_SEED_FAILED:',err.code||err.message);
 process.exit(1);
});
