'use strict';
// Proof uses ONLY a disposable PostgreSQL 16 service created by CI.
// It must never connect to the live Railway or staging database.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Client}=require('pg');

function proofUrl(){
  if(process.env.CATALOG_UNPRICED_SCHEMA_PROOF_ISOLATED!=='1')
    throw new Error('Disposable schema proof requires explicit isolated opt-in');
  const raw=process.env.CATALOG_UNPRICED_SCHEMA_PROOF_URL;
  if(!raw)throw new Error('Disposable schema proof URL required');
  const url=new URL(raw);
  if(!['localhost','127.0.0.1','::1'].includes(url.hostname))
    throw new Error('Schema proof refuses remote databases');
  if(url.pathname!='/catalog_unpriced_proof')
    throw new Error('Schema proof requires its dedicated disposable database');
  return raw;
}

async function main(){
  const client=new Client({connectionString:proofUrl()});
  await client.connect();
  try{
    await client.query(`CREATE TABLE public.products (
      id text PRIMARY KEY,
      lifecycle_status text NOT NULL DEFAULT 'candidate',
      is_active boolean NOT NULL DEFAULT false,
      is_available boolean NOT NULL DEFAULT false,
      price_kmf numeric(14,2) NOT NULL,
      CONSTRAINT chk_products_price CHECK (price_kmf > 0)
    )`);
    const root=path.join(__dirname,'../..','migrations');
    const first=fs.readFileSync(path.join(root,'259_products_draft_price_deferred.sql'),'utf8');
    const later=fs.readFileSync(path.join(root,'352_catalog_unpriced_approval_market_price_authority.sql'),'utf8');
    await client.query(first);
    await client.query(`INSERT INTO products (id,lifecycle_status,is_active,is_available,price_kmf)
      VALUES ('sourced', 'candidate',false,false,NULL),('priced','candidate',false,false,5000)`);
    let staleConstraint=null;
    try{
      await client.query(`UPDATE products SET lifecycle_status='active',
        is_active=true,is_available=true WHERE id='sourced'`);
    }catch(error){staleConstraint=error;}
    assert.equal(staleConstraint?.code,'23514','migration 259 must reproduce the defect');
    assert.equal(staleConstraint?.constraint,'chk_products_unpriced_draft_only');
    await client.query(later);
    const constraints=await client.query(`SELECT conname FROM pg_constraint
      WHERE conrelid='public.products'::regclass AND conname LIKE 'chk_products_%'`);
    const names=constraints.rows.map(row=>row.conname);
    assert(!names.includes('chk_products_unpriced_draft_only'));
    assert(names.includes('chk_products_price'),'positive price invariant must survive');
    await client.query(`UPDATE products SET lifecycle_status='active',
      is_active=true,is_available=true WHERE id='sourced'`);
    const approved=await client.query(`SELECT lifecycle_status,is_active,
      is_available,price_kmf FROM products WHERE id='sourced'`);
    assert.deepEqual(approved.rows,[{
      lifecycle_status:'active',is_active:true,is_available:true,price_kmf:null,
    }]);
    let nonPositive=null;
    try{await client.query(`UPDATE products SET price_kmf=0 WHERE id='sourced'`);}
    catch(err){nonPositive=err;}
    assert.equal(nonPositive?.code,'23514','explicit zero must remain prohibited');
    assert.equal(nonPositive?.constraint,'chk_products_price');
    const unchanged=await client.query(`SELECT price_kmf FROM products WHERE id='priced'`);
    assert.equal(Number(unchanged.rows[0].price_kmf),5000);
    const buyer=fs.readFileSync(path.join(__dirname,'../../services/catalog-public-view.js'),'utf8');
    assert(buyer.includes('LOCAL_ACTIVE')&&buyer.includes('commercial_exposure'),
      'buyer visibility remains conditional on market price and exposure');
    const checkout=fs.readFileSync(path.join(__dirname,
      '../../services/market-local-price-resolution-service.js'),'utf8');
    assert(checkout.includes("d.status = 'LOCAL_ACTIVE'"),
      'checkout pricing remains gated by LOCAL_ACTIVE');
    process.stdout.write(JSON.stringify({
      verdict:'PASS',migration:'352',reproduced_old_23514:true,
      approved_without_global_price:true,explicit_zero_denied:true,
      buyer_market_local_price_guard_present:true,real_market_mutations:0,
    })+'\n');
  }finally{await client.end();}
}
main().catch(err=>{console.error(err);process.exitCode=1});
