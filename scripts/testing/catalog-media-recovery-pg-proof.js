'use strict';
// Physical PostgreSQL 16 proof: strictly temporary tables, isolated GitHub
// Actions service, canonical Catalog writer, no Railway or real supplier API.
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const {recoverSourceMedia}=require('../../services/catalog-media-recovery');

const ACTOR='cccccccc-0000-0000-0000-000000000001';
const ids={
 p1:'aaaaaaaa-0000-0000-0000-000000000001',
 p2:'aaaaaaaa-0000-0000-0000-000000000002',
 p3:'aaaaaaaa-0000-0000-0000-000000000003',
};
const contract=url=>JSON.stringify({
 schema_version:'2',product_name:'Lampe',supplier_name:'CJdropshipping',
 currency:'AED',option_axes:[],
 media:[{supplier_media_id:'IMG-SOURCE-1',url,role:'PRODUCT'}],
});
async function main(){
 const pool=new Pool({host:process.env.PGHOST||'127.0.0.1',
   port:Number(process.env.PGPORT||5432),database:process.env.PGDATABASE||'postgres',
   user:process.env.PGUSER||'postgres',password:process.env.PGPASSWORD||'postgres',
   connectionTimeoutMillis:5000,query_timeout:15000});
 try {
  await pool.query(`
   CREATE TEMP TABLE local_marker(noop integer);
  `); // The proof does not use real application tables.
  // Each pool connection starts from the same ephemeral database with only
  // temporary fixture tables on one held connection. Use a single connection
  // with a compatible release method for the service's unit of work.
  const client=await pool.connect();
  try {
    await client.query(`
      CREATE TEMP TABLE products (
        id uuid PRIMARY KEY, product_ref text NOT NULL,
        lifecycle_status text NOT NULL, is_active boolean NOT NULL
      );
      CREATE TEMP TABLE sourcing_candidates (
        id uuid PRIMARY KEY, product_id uuid, candidate_ref text,
        normalized_source_contract jsonb, state text,
        updated_at timestamptz DEFAULT now()
      );
      CREATE TEMP TABLE catalog_media (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id uuid, source_media_id text, url text,
        role text, alt text, option_values jsonb, display_order integer,
        is_active boolean NOT NULL DEFAULT true,
        updated_at timestamptz DEFAULT now()
      );
      CREATE UNIQUE INDEX ux_test_catalog_source_media ON catalog_media
        (product_id,source_media_id) WHERE source_media_id IS NOT NULL;
      CREATE TEMP TABLE catalog_media_recovery_audit (
        product_id uuid, product_ref text, candidate_ref text,
        actor_user_id uuid, source_media_ids text[], source_media_hash text,
        active_before integer, active_after integer
      );
    `);
    for (const [index, id] of Object.values(ids).entries()) {
      await client.query(
        'INSERT INTO products (id,product_ref,lifecycle_status,is_active) VALUES ($1,$2,$3,false)',
        [id,'KPR-TEST-'+(index+1),'candidate']);
      await client.query(
        `INSERT INTO sourcing_candidates
        (id,product_id,candidate_ref,normalized_source_contract,state)
        VALUES (gen_random_uuid(),$1,$2,$3::jsonb,'imported_to_catalog')`,
        [id,'KSC-TEST-'+(index+1),
          contract(index===1?'http://bad.example.org/a.jpg':'https://supplier.example.org/a.jpg')]);
    }
    // The Pool wrapper guarantees the single temporary session; release()
    // belongs to the wrapper, not to the shared PG connection until the end.
    const database={getClient:async()=>({query:(...args)=>client.query(...args),release:()=>{}})};
    const nominal=await recoverSourceMedia('KPR-TEST-1',{id:ACTOR},{database});
    assert.equal(nominal.media_recovered,1);
    assert.equal(nominal.audit_recorded,true);
    assert.equal(nominal.catalog_approved,false);
    assert.equal(nominal.market_exposure_changed,false);
    const media=await client.query('SELECT source_media_id,url,is_active FROM catalog_media WHERE product_id=$1',[ids.p1]);
    assert.equal(media.rows.length,1);
    assert.deepEqual(media.rows[0],{
      source_media_id:'IMG-SOURCE-1',url:'https://supplier.example.org/a.jpg',is_active:true});
    const audit=await client.query('SELECT * FROM catalog_media_recovery_audit WHERE product_id=$1',[ids.p1]);
    assert.equal(audit.rows.length,1);
    assert.deepEqual(audit.rows[0].source_media_ids,['IMG-SOURCE-1']);
    assert.match(audit.rows[0].source_media_hash,/^[a-f0-9]{64}$/);
    await assert.rejects(recoverSourceMedia('KPR-TEST-1',{id:ACTOR},{database}),
      err=>err.code==='catalog_media_existing_review_required');
    await assert.rejects(recoverSourceMedia('KPR-TEST-2',{id:ACTOR},{database}),
      err=>err.code==='catalog_media_source_invalid');
    assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM catalog_media WHERE product_id=$1',[ids.p2])).rows[0].n,0);
    // Physical proof that audit failure rolls back the media INSERT.
    await client.query('ALTER TABLE catalog_media_recovery_audit ADD CONSTRAINT audit_must_fail CHECK (active_after > 1) NOT VALID');
    await assert.rejects(recoverSourceMedia('KPR-TEST-3',{id:ACTOR},{database}));
    assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM catalog_media WHERE product_id=$1',[ids.p3])).rows[0].n,0);
    assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM catalog_media_recovery_audit')).rows[0].n,1);
    console.log('PASS physical PostgreSQL media recovery: nominal audited, idempotency, invalid source, audit rollback, no publication');
  } finally {client.release();}
 } finally {await pool.end();}
}
main().then(()=>process.exit(0)).catch(e=>{console.error('FAIL physical PostgreSQL media recovery',e);process.exit(1);});
