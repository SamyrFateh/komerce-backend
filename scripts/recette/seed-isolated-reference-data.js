'use strict';
/**
 * Idempotent, explicitly isolated railway recette bootstrap. No real account,
 * supplier, order, payment, shipment or customer record is copied.
 */
const bcrypt=require('bcryptjs');
const fs=require('node:fs');
const path=require('node:path');
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
  const {rows:[customsCount]}=await client.query('SELECT COUNT(*)::int AS n FROM customs_categories');
  if(customsCount.n===0){
    const sql=fs.readFileSync(path.join(__dirname,'../../migrations/036b_seed_customs_categories.sql'),'utf8');
    await client.query(sql);
  }
  // A single artificial supplier candidate to prove the full cost gate.
  // Never copied from a real connector, and never sellable/published.
  const candidateRef='KSC-RECETTE-ECO-01';
  const baseScan={
    sourcing_decision:'WATCH',
    commercial_review:{status:'PENDING_CLASSIFICATION',action:'REVIEW_BOUTIQUE_TAXONOMY'},
    customs_review:{status:'REQUIRED',category_key:null,calculation_allowed:false,publication_allowed:false},
    economic_test_health_status:'unknown',
  };
  const fixtureInsert=await client.query(
    `INSERT INTO sourcing_candidates (
       candidate_ref,supplier_name,supplier_product_id,product_name,supplier_category,
       purchase_price,currency,purchase_price_kmf,estimated_weight_kg,
       estimated_volume_m3,confidence,state,data_sources,scan_result,notes
     ) VALUES ($1,'FAKE-RECETTE','FAKE-RECETTE-001',
       'Coque de téléphone fictive — recette','Mobile phone accessories',
       1800,'KMF',1800,0.150,0.00100,'medium','scanned',
       '{"category":"default","purchase_price":"manual","weight":"manual","volume":"manual"}'::jsonb,
       $2::jsonb,'Donnée synthétique de recette. Aucune vente ni fournisseur réel.')
     ON CONFLICT (candidate_ref) DO UPDATE SET
       komerce_category=NULL, data_sources=EXCLUDED.data_sources,
       scan_result=EXCLUDED.scan_result, state='scanned',
       purchase_price_kmf=1800, estimated_weight_kg=0.150,
       estimated_volume_m3=0.00100
     WHERE sourcing_candidates.product_id IS NULL`,
    [candidateRef,JSON.stringify(baseScan)]
  );
  if(fixtureInsert.rowCount!==1)throw Error('SYNTHETIC_CANDIDATE_ALREADY_HANDED_OFF');
  const email='recette-admin@example.invalid';
  let users=await client.query('SELECT id,role FROM users WHERE email=$1',[email]);
  let user;
  const hash=await bcrypt.hash(password,12);
  if(users.rows.length){
    user=users.rows[0];
    if(user.role!=='admin')throw Error('RECETTE_ADMIN_ROLE_CONFLICT');
    await client.query('UPDATE users SET password_hash=$1 WHERE id=$2 AND email=$3 AND role=$4',
      [hash,user.id,email,'admin']);
  }else{
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
