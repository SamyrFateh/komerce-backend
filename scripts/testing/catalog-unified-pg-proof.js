'use strict';

/**
 * Physical SQL oracle for the unified Catalogue, on PostgreSQL 16 ephemeral
 * GitHub Actions service. Temp tables only; rollback unconditionally.
 * No Railway, payment, supplier API or real data connection.
 */
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { listUnified } = require('../../services/catalog-unified-registry');

async function main() {
  const client = new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'postgres',
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE products (
        id integer PRIMARY KEY, product_ref text NOT NULL,
        name text, description text, name_source text, description_source text,
        image_url text, source_locale text, content_source text,
        boutique_category_key text, boutique_subcategory_key text,
        lifecycle_status text, is_active boolean, needs_review boolean,
        updated_at timestamptz DEFAULT NOW()
      );
      CREATE TEMP TABLE sourcing_candidates (
        id integer PRIMARY KEY, product_id integer, candidate_ref text,
        product_name text, description text, supplier_name text,
        supplier_product_id text, supplier_category text,
        image_url text, product_url text, normalized_source_contract jsonb,
        state text, scan_result jsonb, confidence text,
        updated_at timestamptz DEFAULT NOW()
      );
      CREATE TEMP TABLE boutique_categories (
        key text PRIMARY KEY, label text, is_active boolean
      );
      CREATE TEMP TABLE boutique_subcategories (
        key text, category_key text, label text, is_active boolean
      );
      CREATE TEMP TABLE catalog_field_overrides (
        product_id integer, field_name text, reason text,
        set_by integer, field_value text
      );
      CREATE TEMP TABLE catalog_publication_decision_audit (
        id integer PRIMARY KEY, product_id integer, action text,
        created_at timestamptz
      );
      CREATE TEMP TABLE catalog_media (product_id integer, is_active boolean);
      INSERT INTO boutique_categories VALUES ('maison','Maison',true);
      INSERT INTO boutique_subcategories VALUES ('luminaire','maison','Luminaire',true);
      INSERT INTO products (id,product_ref,name,description,source_locale,content_source,
        boutique_category_key,boutique_subcategory_key,lifecycle_status,is_active,needs_review)
      VALUES
      (1,'KPR-001','Lampe','Fiche française','fr','manual','maison','luminaire','active',true,false),
      (2,'KPR-002','Suspension',NULL,'en','connector_raw',NULL,NULL,'candidate',false,true),
      (3,'KPR-003','Produit historique','Description française','fr','manual',
         'maison','luminaire','active',true,false);
      INSERT INTO sourcing_candidates (
        id,product_id,candidate_ref,product_name,description,supplier_name,
        supplier_product_id,supplier_category,normalized_source_contract,state,scan_result,confidence)
      VALUES
      (1,1,'SC-001','Lampe source','Description source','CJdropshipping','CJ-001',
        'Lights','{}','imported_to_catalog','{"sourcing_decision":"TEST"}','high'),
      (2,1,'SC-ALT','Ancienne observation','Description','CJdropshipping','CJ-OLD',
        'Lights','{}','scanned','{"sourcing_decision":"WATCH"}','medium'),
      (3,NULL,'SC-RAW','Brouillon source',NULL,'AliExpress','A-RAW',
        'Home',NULL,'raw_imported',NULL,'low'),
      (4,NULL,'SC-SCAN','Candidat scanné',NULL,'AliExpress','A-SCAN',
        'Home','{}','scanned','{"sourcing_decision":"TEST"}','medium'),
      (5,NULL,'SC-ORPHAN','Remise cassée',NULL,'CJdropshipping','CJ-BROKEN',
        'Home','{}','imported_to_catalog','{"sourcing_decision":"PRIORITY"}','high'),
      (6,2,'SC-DRAFT','Suspension source','Texte source','CJdropshipping','CJ-DRAFT',
        'Home','{"schema_version":"2","media":[{"supplier_media_id":"CJ-MEDIA-1","url":"https://example.org/a.jpg","role":"PRODUCT"}]}','imported_to_catalog',NULL,'low');
      INSERT INTO catalog_media (product_id,is_active) VALUES (1,true),(3,false);
      INSERT INTO catalog_publication_decision_audit
        (id,product_id,action,created_at)
      VALUES (1,1,'CATALOG_PRODUCT_APPROVED',NOW());
    `);
    await client.query(`
      INSERT INTO products (id,product_ref,name,lifecycle_status,is_active)
      VALUES (4,'KPR-ACTIVE-CANDIDATE','Anomalie candidate active','candidate',true),
             (5,'KPR-INACTIVE-ACTIVE','Anomalie active inactive','active',false);
      INSERT INTO sourcing_candidates
        (id,product_id,candidate_ref,product_name,supplier_name,supplier_product_id,
         state,scan_result)
      VALUES (7,NULL,'SC-WATCH','Référence en surveillance',
        'AliExpress','A-WATCH','scanned','{"sourcing_decision":"WATCH"}'),
             (8,NULL,'SC-WATCH-CATEGORY','Référence à classer',
        'AliExpress','A-WATCH-CATEGORY','scanned',
        '{"sourcing_decision":"WATCH","commercial_review":{"status":"PENDING_CLASSIFICATION","action":"REVIEW_BOUTIQUE_TAXONOMY"}}');
    `);
    const before = await client.query('SELECT COUNT(*)::int AS n FROM sourcing_candidates');
    const result = await listUnified({ limit: 50 }, client);
    assert.equal(result.page.total, 10, 'product + pre-handoff count');
    assert.equal(result.products.filter(r => r.product_ref === 'KPR-001').length, 1,
      'a handed product with two candidate observations must appear once');
    assert.equal(result.products.filter(r => r.candidate_ref === 'SC-ALT').length, 0,
      'a secondary observation must not become a second row');
    const approved = result.products.find(r => r.product_ref === 'KPR-001');
    assert.equal(approved.candidate_ref, 'SC-001');
    assert.equal(approved.work_status, 'catalog_approved');
    assert.equal(approved.operator_group, 'validated');
    assert.equal(approved.active_media_count, 1);
    assert.equal(approved.media_status, 'canonical_ready');
    const draft = result.products.find(r => r.product_ref === 'KPR-002');
    assert.equal(draft.active_media_count, 0);
    assert.equal(draft.source_media_count, 1);
    assert.equal(draft.media_status, 'source_recoverable');
    assert(draft.issues.includes('media_missing'));
    const history = result.products.find(r => r.product_ref === 'KPR-003');
    assert.equal(history.active_media_count, 0);
    assert.equal(history.total_media_count, 1);
    assert.equal(history.media_status, 'canonical_inactive_review');
    assert.equal(history.operator_group, 'correction',
      'an active legacy product must remain visible without inventing sourcing evidence');
    const raw = result.products.find(r => r.candidate_ref === 'SC-RAW');
    assert.equal(raw.record_kind, 'candidate');
    assert.equal(raw.operator_group, 'processing');
    assert.deepEqual(raw.issues, []);
    const orphan = result.products.find(r => r.candidate_ref === 'SC-ORPHAN');
    assert.equal(orphan.work_status, 'handoff_missing');
    assert.deepEqual(orphan.issues, ['handoff_missing']);
    const review = result.products.find(r => r.candidate_ref === 'SC-SCAN');
    assert.equal(review.operator_group, 'review');
    assert.equal(review.product_ref, null);
    const deferred = result.products.find(r => r.candidate_ref === 'SC-WATCH');
    assert.equal(deferred.work_status,'sourcing_deferred');
    assert.equal(deferred.operator_group,'processing');
    assert.deepEqual(deferred.issues,[]);
    const categoryReview=result.products.find(r=>r.candidate_ref==='SC-WATCH-CATEGORY');
    assert.equal(categoryReview.work_status,'sourcing_category_review');
    assert.equal(categoryReview.operator_group,'correction');
    assert.deepEqual(categoryReview.issues,['sourcing_economic_category_missing']);
    const candidateActivated=result.products.find(r=>r.product_ref==='KPR-ACTIVE-CANDIDATE');
    assert.equal(candidateActivated.work_status,'activation_to_reconcile');
    assert(candidateActivated.issues.includes('activation_to_reconcile'));
    const disabled=result.products.find(r=>r.product_ref==='KPR-INACTIVE-ACTIVE');
    assert.notEqual(disabled.work_status,'activation_to_reconcile',
      'a soft-deactivated previously approved lifecycle is not necessarily inconsistent');
    assert(!disabled.issues.includes('activation_to_reconcile'));
    const filtered = await listUnified({ search: 'SC-001', status: 'validated' }, client);
    assert.equal(filtered.page.total, 1);
    assert.equal(filtered.products[0].product_ref, 'KPR-001');
    const after = await client.query('SELECT COUNT(*)::int AS n FROM sourcing_candidates');
    assert.equal(after.rows[0].n, before.rows[0].n, 'read-only proof');
    console.log('PASS physical PostgreSQL unified Catalogue: identity, audit, orphan, legacy, filters and no writes');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error('FAIL physical PostgreSQL unified Catalogue', err);
  process.exit(1);
});
