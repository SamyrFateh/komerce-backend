'use strict';
/**
 * Physical PostgreSQL proof of the actual Raffinerie/Catalogue read services.
 * Requires a disposable localhost PostgreSQL container; NEVER use staging/prod.
 * Creates TEMP tables only, and asserts service reads under READ ONLY transaction.
 */
const assert = require('node:assert/strict');
const { Client } = require('pg');
const registry = require('../../services/catalog-registry');
const refinery = require('../../services/refinery-worklist');

async function main() {
  if (process.env.REFINERY_PG_CERT_ISOLATED !== '1') throw new Error('isolated_certification_gate_required');
  const url = process.env.REFINERY_PG_CERT_URL;
  if (!url) throw new Error('disposable_postgres_url_required');
  const parsed = new URL(url);
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
    throw new Error('refusing_non_local_postgres_for_certificate');
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // Session temporary data, never a migration or production dataset.
    await client.query(`
      CREATE TEMP TABLE products (
        id integer PRIMARY KEY, product_ref text NOT NULL, name text, description text,
        image_url text, category text, boutique_category_key text, boutique_subcategory_key text,
        lifecycle_status text, is_active boolean, needs_review boolean,
        content_source text, source_locale text,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
      );
      CREATE TEMP TABLE sourcing_candidates (
        id integer PRIMARY KEY, product_id integer, state text, candidate_ref text,
        supplier_name text, supplier_product_id text, supplier_category text,
        image_url text, normalized_source_contract jsonb,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
      );
      CREATE TEMP TABLE boutique_categories (key text PRIMARY KEY, label text, is_active boolean);
      CREATE TEMP TABLE boutique_subcategories (
        key text, category_key text, label text, is_active boolean
      );
      INSERT INTO boutique_categories VALUES ('tech', 'Tech', true);
      INSERT INTO boutique_subcategories VALUES ('phones','tech','Téléphones',true);
      INSERT INTO products
      (id,product_ref,name,description,boutique_category_key,boutique_subcategory_key,
       lifecycle_status,is_active,needs_review,content_source,source_locale)
      VALUES
       (1,'P-DRAFT-NOSOURCE','Fiche à qualifier',NULL,'tech','phones','candidate',false,true,NULL,'en'),
       (2,'P-CANDIDATE-READY','Fiche à valider','Description française','tech','phones','candidate',false,false,'manual','fr'),
       (3,'P-FINALIZED','Fiche approuvée','Description française','tech','phones','active',true,false,'manual','fr'),
       (4,'P-ACTIVE-FR-DEFECT','Fiche à revoir',NULL,'tech','phones','active',true,true,'connector_raw','en'),
       (5,'P-ACTIVE-NOHANDOFF','Ancien actif','Description française','tech','phones','active',true,false,'manual','fr'),
       (6,'P-REJECTED','Fiche rejetée',NULL,'tech','phones','rejected',false,true,'connector_raw','en'),
       (7,'P-ACTIVE-SOURCE-DEFECT','Source à revoir','Description française','tech','phones','active',true,false,'manual','fr'),
       (8,'P-DRAFT-LEGACY','Brouillon inconnu',NULL,'tech','phones','candidate',false,true,'legacy_unknown','en');
      INSERT INTO sourcing_candidates
      (id,product_id,state,candidate_ref,supplier_name,supplier_product_id,supplier_category,normalized_source_contract)
      VALUES
       (1,1,'imported_to_catalog','C1','CJ','S1','Tech','{}'::jsonb),
       (2,2,'imported_to_catalog','C2','CJ','S2','Tech','{}'::jsonb),
       (3,3,'imported_to_catalog','C3','CJ','S3','Tech','{}'::jsonb),
       (4,4,'imported_to_catalog','C4','CJ','S4','Tech','{}'::jsonb),
       (6,6,'imported_to_catalog','C6','CJ','S6','Tech','{}'::jsonb),
       (7,7,'imported_to_catalog','C7','CJ','S7','Tech',NULL),
       (8,8,'imported_to_catalog','C8','CJ','S8','Tech','{}'::jsonb);
    `);
    await client.query('BEGIN READ ONLY');
    try {
      const [work, approved, recheck, full] = await Promise.all([
        refinery.buildRefineryWorklist({refinery_limit:10},client),
        registry.listRegistry({finalized_only:true,limit:50},client),
        registry.listRegistry({refinery_recheck_only:true,limit:50},client),
        registry.listRegistry({limit:50},client),
      ]);
      const refs = rows => rows.map(x=>x.product_ref).sort();
      assert.equal(work.coverage.in_approval_queue,1);
      assert.equal(work.coverage.unprepared_candidates,2);
      assert.equal(work.coverage.active_products,4);
      assert.equal(work.coverage.handoff_already_active,3);
      assert.equal(work.coverage.rejected_products,1);
      assert.equal(work.coverage.active_recheck,2);
      assert.deepEqual(refs(work.unprepared),['P-DRAFT-LEGACY','P-DRAFT-NOSOURCE']);
      assert.deepEqual(refs(approved.products),['P-FINALIZED']);
      assert.deepEqual(refs(recheck.products),['P-ACTIVE-FR-DEFECT','P-ACTIVE-SOURCE-DEFECT']);
      assert.equal(full.page.total,7);
      assert.equal(approved.page.total,1);
      assert.equal(recheck.page.total,2);
      assert.equal(work.recheck.find(x=>x.product_ref==='P-ACTIVE-SOURCE-DEFECT').issues.includes('source_to_normalize'),true);
      assert.equal(work.recheck.find(x=>x.product_ref==='P-ACTIVE-FR-DEFECT').issues.includes('editorial_to_complete'),true);
      // Physical exclusion: an active product never handed off is not fabricated
      // as a catalog-approved product or a returned Raffinerie task.
      assert(!refs(approved.products).includes('P-ACTIVE-NOHANDOFF'));
      assert(!refs(work.recheck).includes('P-ACTIVE-NOHANDOFF'));
      process.stdout.write(JSON.stringify({
        verdict:'PASS', engine:'PostgreSQL (isolated TEMP tables)',
        finalized:approved.page.total, active_recheck:recheck.page.total,
        unprepared:work.coverage.unprepared_candidates,
        in_approval:work.coverage.in_approval_queue,
        historical_count:full.page.total,
        publication_or_mutation:'none'
      })+'\n');
    } finally {
      await client.query('ROLLBACK');
    }
  } finally {
    await client.end();
  }
}
main().catch(error => { console.error(error); process.exitCode=1; });
