/**
 * @komerce-arch-lite
 * @role staging-catalogue-unified-readonly-census
 * @domain catalog
 * @layer tooling
 * @owner backend-core
 * @purpose Verify the live staging target and count actual catalogue exceptions.
 * @db-read products, sourcing_candidates, catalog_media, catalog_publication_decision_audit, pg_catalog
 * @db-write none
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { confirmTarget } = require('./target-guard');
const { listUnified } = require('../../services/catalog-unified-registry');

const ORIGIN='https://komerce-backend-production.up.railway.app';
const OUTPUT=path.resolve('test-results/staging-catalog-readonly/census.json');
function requiredEnvironment(env=process.env){
 if(env.KOMERCE_ENV!=='staging' || env.NODE_ENV==='production' ||
    env.STAGING_BASE_URL!==ORIGIN || !env.DATABASE_URL)
   throw Error('STAGING_TARGET_CONFIGURATION_REQUIRED');
}
function sqlNumber(row,key) { return Number(row?.[key]||0); }
async function main(){
 requiredEnvironment();
 fs.mkdirSync(path.dirname(OUTPUT),{recursive:true});
 const report={kind:'REAL_STAGING_READ_ONLY',status:'NO_GO',schema_version:1,
  checked_at:new Date().toISOString(),claimed_target:'staging',app_origin:ORIGIN,
  database_target_confirmed:false,live_commit:null,migration_351_present:null,
  tables:null,source:null,products:null,links:null,media:null,approval:null,
  source_decisions:[],watch_blockers:null,cost_input_health:null,cost_output_health:null,product_lifecycle:[],operator_work_statuses:{},
  operator_issue_counts:{},operator_group_by_kind:{},
  operator_groups:null,operator_projection_status:'NOT_CHECKED',
  executed_with:'BEGIN READ ONLY',no_business_writes:true,blockers:[]};
 const client=new Client({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.DATABASE_URL.includes('sslmode=require')
    ? {rejectUnauthorized:process.env.DB_SSL_REJECT_UNAUTHORIZED!=='false'}:false,
  connectionTimeoutMillis:7000,query_timeout:18000,
 });
 let connected=false,transaction=false;
 try{
  await client.connect();connected=true;
  // Proof of exact environment identity before any table census.
  const verdict=await confirmTarget({
    db:{query:(...args)=>client.query(...args)},
    env:{...process.env,EXPECTED_RAILWAY_ENVIRONMENT:'staging'}
  });
  if(verdict.confirmed!==true)throw Error('TARGET_IDENTITY_UNVERIFIED');
  report.database_target_confirmed=true;
  const version=await fetch(ORIGIN+'/health/version',
    {redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!version.ok)throw Error('STAGING_VERSION_UNAVAILABLE');
  const json=await version.json();
  report.live_commit=String(json.commit||json.sha||'').slice(0,40)||null;

  await client.query('BEGIN READ ONLY');transaction=true;
  await client.query("SET LOCAL statement_timeout='12000ms'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout='15000ms'");

  const rel=await client.query(
    "SELECT to_regclass('public.products') IS NOT NULL AS products, "+
    "to_regclass('public.sourcing_candidates') IS NOT NULL AS sourcing_candidates, "+
    "to_regclass('public.catalog_media') IS NOT NULL AS catalog_media, "+
    "to_regclass('public.catalog_publication_decision_audit') IS NOT NULL AS publication_audit, "+
    "to_regclass('public.catalog_media_recovery_audit') IS NOT NULL AS migration_351, "+
    "to_regclass('public.catalog_global_access_grants') IS NOT NULL AS catalog_grants, "+
    "to_regclass('public.sourcing_global_access_grants') IS NOT NULL AS sourcing_grants");
  report.tables=rel.rows[0];
  report.migration_351_present=Boolean(rel.rows[0].migration_351);
  if(!['products','sourcing_candidates','catalog_media','publication_audit'].every(k=>rel.rows[0][k]))
    throw Error('EXPECTED_CATALOG_TABLE_MISSING');

  const [src,prod,linked,media,approval]=await Promise.all([
    client.query(`SELECT COUNT(*)::int AS all_candidates,
      COUNT(*) FILTER (WHERE product_id IS NULL)::int AS pre_handoff,
      COUNT(*) FILTER (WHERE state='imported_to_catalog')::int AS handed_off,
      COUNT(*) FILTER (WHERE state IN ('scanned','test_ready','watchlist') AND product_id IS NULL)::int AS human_review_candidates
      FROM sourcing_candidates`),
    client.query(`SELECT COUNT(*)::int AS all_products,
      COUNT(*) FILTER (WHERE lifecycle_status='candidate' AND is_active IS FALSE)::int AS inactive_drafts,
      COUNT(*) FILTER (WHERE lifecycle_status='active' AND is_active IS TRUE)::int AS active_catalog
      FROM products`),
    client.query(`SELECT
      (SELECT COUNT(*)::int FROM sourcing_candidates sc LEFT JOIN products p ON p.id=sc.product_id
       WHERE sc.state='imported_to_catalog' AND p.id IS NULL) AS broken_handoff,
      (SELECT COUNT(*)::int FROM (
       SELECT product_id FROM sourcing_candidates WHERE product_id IS NOT NULL
       GROUP BY product_id HAVING COUNT(*)>1
      ) duplicated) AS multi_observation_products`),
    client.query(`WITH base AS (
      SELECT p.id, p.lifecycle_status, p.is_active,
        COALESCE(m.total,0) AS media_total,COALESCE(m.active,0) AS media_active,
        COALESCE(sc.contract->>'schema_version','') AS schema_version,
        CASE WHEN jsonb_typeof(sc.contract->'media')='array'
          THEN jsonb_array_length(sc.contract->'media') ELSE 0 END AS source_media
      FROM products p
      LEFT JOIN (SELECT product_id,COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE is_active IS TRUE)::int AS active
        FROM catalog_media GROUP BY product_id) m ON m.product_id=p.id
      LEFT JOIN LATERAL (
        SELECT normalized_source_contract AS contract FROM sourcing_candidates
        WHERE product_id=p.id AND state='imported_to_catalog'
        ORDER BY updated_at DESC NULLS LAST,id DESC LIMIT 1
      ) sc ON TRUE
    ) SELECT
      COUNT(*) FILTER (WHERE lifecycle_status='candidate' AND is_active IS FALSE
        AND media_active=0)::int AS drafts_without_active_canonical_media,
      COUNT(*) FILTER (WHERE lifecycle_status='candidate' AND is_active IS FALSE
        AND media_active=0 AND media_total>0)::int AS drafts_with_disabled_canonical_media,
      COUNT(*) FILTER (WHERE lifecycle_status='candidate' AND is_active IS FALSE
        AND media_active=0 AND media_total=0 AND schema_version='2'
        AND source_media>0)::int AS drafts_with_v2_source_media_to_evaluate,
      COUNT(*) FILTER (WHERE lifecycle_status='candidate' AND is_active IS FALSE
        AND media_active=0 AND source_media=0)::int AS drafts_with_no_v2_source_media
      FROM base`),
    client.query(`SELECT COUNT(*)::int AS active_without_any_approval_event
      FROM products p WHERE p.is_active IS TRUE AND NOT EXISTS (
        SELECT 1 FROM catalog_publication_decision_audit d
        WHERE d.product_id=p.id
          AND d.action IN ('CATALOG_PRODUCT_APPROVED','CATALOG_PRODUCT_OVERRIDDEN_AND_APPROVED')
      )`),
  ]);
  const [decisions,lifecycle]=await Promise.all([
    client.query(`SELECT state,
       COALESCE(UPPER(scan_result->>'sourcing_decision'),'UNKNOWN') AS sourcing_decision,
       COUNT(*)::int AS count,
       COUNT(*) FILTER (WHERE product_id IS NULL)::int AS pre_handoff
       FROM sourcing_candidates GROUP BY state,sourcing_decision
       ORDER BY count DESC, state, sourcing_decision`),
    client.query(`SELECT COALESCE(lifecycle_status,'UNKNOWN') AS lifecycle_status,
       is_active, COUNT(*)::int AS count
       FROM products GROUP BY lifecycle_status,is_active ORDER BY count DESC,lifecycle_status`),
  ]);
  const watch=await client.query(`
    SELECT COUNT(*)::int AS watch_total,
      COUNT(*) FILTER (WHERE purchase_price IS NULL OR purchase_price<=0)::int AS missing_purchase_price,
      COUNT(*) FILTER (WHERE komerce_category IS NULL OR BTRIM(komerce_category)='')::int AS missing_komerce_category,
      COUNT(*) FILTER (WHERE
        scan_result->'commercial_review'->>'status'='PENDING_CLASSIFICATION')::int AS boutique_review_requested,
      COUNT(*) FILTER (WHERE scan_result->'fx_gate'->>'code'='fx_rate_unavailable')::int AS fx_quote_pending,
      COUNT(*) FILTER (WHERE
        scan_result->>'economic_test_health_status'='fragile')::int AS fragile_economics,
      COUNT(*) FILTER (WHERE
        scan_result->>'economic_test_health_status'='unknown')::int AS economics_unknown
    FROM sourcing_candidates
    WHERE state IN ('scanned','test_ready','watchlist')
      AND product_id IS NULL
      AND UPPER(COALESCE(scan_result->>'sourcing_decision',''))='WATCH'`);
  const [costInput,costOutput]=await Promise.all([
    client.query(`SELECT
      COUNT(*)::int AS scoped_candidates,
      COUNT(*) FILTER (WHERE UPPER(COALESCE(scan_result->>'sourcing_decision',''))='WATCH')::int AS watch_count,
      COUNT(*) FILTER (WHERE UPPER(COALESCE(scan_result->>'sourcing_decision',''))='TEST')::int AS test_count,
      COUNT(*) FILTER (WHERE purchase_price_kmf IS NULL OR purchase_price_kmf<=0)::int AS purchase_kmf_missing,
      COUNT(*) FILTER (WHERE estimated_weight_kg IS NULL OR estimated_weight_kg<=0)::int AS weight_missing,
      COUNT(*) FILTER (WHERE estimated_volume_m3 IS NULL OR estimated_volume_m3<=0)::int AS volume_missing,
      COUNT(*) FILTER (WHERE komerce_category IS NULL OR BTRIM(komerce_category)='')::int AS economic_category_missing
      FROM sourcing_candidates
      WHERE state IN ('scanned','test_ready','watchlist')
        AND product_id IS NULL
        AND UPPER(COALESCE(scan_result->>'sourcing_decision','')) IN ('WATCH','TEST')`),
    client.query(`SELECT
      COUNT(*) FILTER (WHERE (scan_result->>'variable_cost_complete_kmf') ~ '^[0-9]+([.][0-9]+)?
  report.product_lifecycle=lifecycle.rows;
  report.source=src.rows[0];report.products=prod.rows[0];
  report.links=linked.rows[0];report.media=media.rows[0];
  report.approval=approval.rows[0];

  // Probe the PROPOSED read-model against the real schema without writes.
  // SAVEPOINT ensures even a schema error cannot contaminate later reads.
  await client.query('SAVEPOINT unified_preview');
  try {
    const preview=await listUnified({limit:100,offset:0},client);
    report.operator_groups=preview.groups;
    for(const row of preview.products) {
      const kind=String(row.record_kind||'unknown');
      const group=String(row.operator_group||'unknown');
      const status=String(row.work_status||'unknown');
      report.operator_group_by_kind[kind+' / '+group]=
        (report.operator_group_by_kind[kind+' / '+group]||0)+1;
      report.operator_work_statuses[status]=(report.operator_work_statuses[status]||0)+1;
      for(const issue of row.issues||[]) {
        report.operator_issue_counts[issue]=(report.operator_issue_counts[issue]||0)+1;
      }
    }
    if(preview.page.has_next)report.blockers.push('UNIFIED_CENSUS_EXCEEDS_FIRST_100_ROWS');
    report.operator_projection_status='SQL_COMPATIBLE';
  } catch(error) {
    report.operator_projection_status='SQL_INCOMPATIBLE';
    report.blockers.push('UNIFIED_PROJECTION_SQL_INCOMPATIBLE_'+String(error.code||'UNKNOWN').slice(0,18));
    await client.query('ROLLBACK TO SAVEPOINT unified_preview');
  }
  await client.query('ROLLBACK');transaction=false;

  if(!report.migration_351_present)report.blockers.push('MIGRATION_351_NOT_INSTALLED');
  if(report.live_commit!=='3b23f91c00af60c768dee16a0a23dc5f86d48e9e')
    report.blockers.push('CATALOGUE_UNIFIED_PR_NOT_DEPLOYED');
  report.status=report.blockers.length?'NO_GO_PENDING_DEPLOYMENT':'READ_ONLY_PREFLIGHT_READY';
  fs.writeFileSync(OUTPUT,JSON.stringify(report,null,2)+'\n');
  console.log('STAGING_CATALOGUE_CENSUS '+JSON.stringify(report));
 } catch(error) {
  report.blockers.push(String(error.code||'STAGING_READONLY_PREFLIGHT_FAILED').slice(0,64));
  if(transaction)await client.query('ROLLBACK').catch(()=>{});
  fs.writeFileSync(OUTPUT,JSON.stringify(report,null,2)+'\n');
  console.error('STAGING_CATALOGUE_CENSUS_BLOCKED '+report.blockers.join(','));
  process.exitCode=1;
 } finally {if(connected)await client.end().catch(()=>{});}
}
main().catch(()=>{process.exitCode=1;});
)::int AS variable_cost_evidenced,
      COUNT(*) FILTER (WHERE (scan_result->>'test_price_kmf') ~ '^[0-9]+([.][0-9]+)?
  report.product_lifecycle=lifecycle.rows;
  report.source=src.rows[0];report.products=prod.rows[0];
  report.links=linked.rows[0];report.media=media.rows[0];
  report.approval=approval.rows[0];

  // Probe the PROPOSED read-model against the real schema without writes.
  // SAVEPOINT ensures even a schema error cannot contaminate later reads.
  await client.query('SAVEPOINT unified_preview');
  try {
    const preview=await listUnified({limit:100,offset:0},client);
    report.operator_groups=preview.groups;
    for(const row of preview.products) {
      const kind=String(row.record_kind||'unknown');
      const group=String(row.operator_group||'unknown');
      const status=String(row.work_status||'unknown');
      report.operator_group_by_kind[kind+' / '+group]=
        (report.operator_group_by_kind[kind+' / '+group]||0)+1;
      report.operator_work_statuses[status]=(report.operator_work_statuses[status]||0)+1;
      for(const issue of row.issues||[]) {
        report.operator_issue_counts[issue]=(report.operator_issue_counts[issue]||0)+1;
      }
    }
    if(preview.page.has_next)report.blockers.push('UNIFIED_CENSUS_EXCEEDS_FIRST_100_ROWS');
    report.operator_projection_status='SQL_COMPATIBLE';
  } catch(error) {
    report.operator_projection_status='SQL_INCOMPATIBLE';
    report.blockers.push('UNIFIED_PROJECTION_SQL_INCOMPATIBLE_'+String(error.code||'UNKNOWN').slice(0,18));
    await client.query('ROLLBACK TO SAVEPOINT unified_preview');
  }
  await client.query('ROLLBACK');transaction=false;

  if(!report.migration_351_present)report.blockers.push('MIGRATION_351_NOT_INSTALLED');
  if(report.live_commit!=='3b23f91c00af60c768dee16a0a23dc5f86d48e9e')
    report.blockers.push('CATALOGUE_UNIFIED_PR_NOT_DEPLOYED');
  report.status=report.blockers.length?'NO_GO_PENDING_DEPLOYMENT':'READ_ONLY_PREFLIGHT_READY';
  fs.writeFileSync(OUTPUT,JSON.stringify(report,null,2)+'\n');
  console.log('STAGING_CATALOGUE_CENSUS '+JSON.stringify(report));
 } catch(error) {
  report.blockers.push(String(error.code||'STAGING_READONLY_PREFLIGHT_FAILED').slice(0,64));
  if(transaction)await client.query('ROLLBACK').catch(()=>{});
  fs.writeFileSync(OUTPUT,JSON.stringify(report,null,2)+'\n');
  console.error('STAGING_CATALOGUE_CENSUS_BLOCKED '+report.blockers.join(','));
  process.exitCode=1;
 } finally {if(connected)await client.end().catch(()=>{});}
}
main().catch(()=>{process.exitCode=1;});
)::int AS test_price_evidenced,
      COUNT(*) FILTER (WHERE (scan_result->>'minimum_safe_price_kmf') ~ '^[0-9]+([.][0-9]+)?
  report.product_lifecycle=lifecycle.rows;
  report.source=src.rows[0];report.products=prod.rows[0];
  report.links=linked.rows[0];report.media=media.rows[0];
  report.approval=approval.rows[0];

  // Probe the PROPOSED read-model against the real schema without writes.
  // SAVEPOINT ensures even a schema error cannot contaminate later reads.
  await client.query('SAVEPOINT unified_preview');
  try {
    const preview=await listUnified({limit:100,offset:0},client);
    report.operator_groups=preview.groups;
    for(const row of preview.products) {
      const kind=String(row.record_kind||'unknown');
      const group=String(row.operator_group||'unknown');
      const status=String(row.work_status||'unknown');
      report.operator_group_by_kind[kind+' / '+group]=
        (report.operator_group_by_kind[kind+' / '+group]||0)+1;
      report.operator_work_statuses[status]=(report.operator_work_statuses[status]||0)+1;
      for(const issue of row.issues||[]) {
        report.operator_issue_counts[issue]=(report.operator_issue_counts[issue]||0)+1;
      }
    }
    if(preview.page.has_next)report.blockers.push('UNIFIED_CENSUS_EXCEEDS_FIRST_100_ROWS');
    report.operator_projection_status='SQL_COMPATIBLE';
  } catch(error) {
    report.operator_projection_status='SQL_INCOMPATIBLE';
    report.blockers.push('UNIFIED_PROJECTION_SQL_INCOMPATIBLE_'+String(error.code||'UNKNOWN').slice(0,18));
    await client.query('ROLLBACK TO SAVEPOINT unified_preview');
  }
  await client.query('ROLLBACK');transaction=false;

  if(!report.migration_351_present)report.blockers.push('MIGRATION_351_NOT_INSTALLED');
  if(report.live_commit!=='3b23f91c00af60c768dee16a0a23dc5f86d48e9e')
    report.blockers.push('CATALOGUE_UNIFIED_PR_NOT_DEPLOYED');
  report.status=report.blockers.length?'NO_GO_PENDING_DEPLOYMENT':'READ_ONLY_PREFLIGHT_READY';
  fs.writeFileSync(OUTPUT,JSON.stringify(report,null,2)+'\n');
  console.log('STAGING_CATALOGUE_CENSUS '+JSON.stringify(report));
 } catch(error) {
  report.blockers.push(String(error.code||'STAGING_READONLY_PREFLIGHT_FAILED').slice(0,64));
  if(transaction)await client.query('ROLLBACK').catch(()=>{});
  fs.writeFileSync(OUTPUT,JSON.stringify(report,null,2)+'\n');
  console.error('STAGING_CATALOGUE_CENSUS_BLOCKED '+report.blockers.join(','));
  process.exitCode=1;
 } finally {if(connected)await client.end().catch(()=>{});}
}
main().catch(()=>{process.exitCode=1;});
)::int AS minimum_safe_evidenced,
      COUNT(*) FILTER (WHERE scan_result->'cost_breakdown' IS NOT NULL)::int AS cost_breakdown_evidenced,
      COUNT(*) FILTER (WHERE scan_result->'cost_breakdown'->>'customs_status'='not_estimated')::int AS customs_not_estimated,
      COUNT(*) FILTER (WHERE scan_result->>'economic_test_health_status' IN ('healthy','strong'))::int AS economically_contributive,
      COUNT(*) FILTER (WHERE scan_result->>'economic_test_health_status' IN ('fragile','danger','loss'))::int AS economically_risky,
      COUNT(*)::int AS measured_test_candidates
      FROM sourcing_candidates WHERE state IN ('scanned','test_ready')
        AND product_id IS NULL
        AND UPPER(COALESCE(scan_result->>'sourcing_decision',''))='TEST'`),
  ]);
  report.cost_input_health=costInput.rows[0];
  report.cost_output_health=costOutput.rows[0];
  report.watch_blockers=watch.rows[0];
  report.source_decisions=decisions.rows;
  report.product_lifecycle=lifecycle.rows;
  report.source=src.rows[0];report.products=prod.rows[0];
  report.links=linked.rows[0];report.media=media.rows[0];
  report.approval=approval.rows[0];

  // Probe the PROPOSED read-model against the real schema without writes.
  // SAVEPOINT ensures even a schema error cannot contaminate later reads.
  await client.query('SAVEPOINT unified_preview');
  try {
    const preview=await listUnified({limit:100,offset:0},client);
    report.operator_groups=preview.groups;
    for(const row of preview.products) {
      const kind=String(row.record_kind||'unknown');
      const group=String(row.operator_group||'unknown');
      const status=String(row.work_status||'unknown');
      report.operator_group_by_kind[kind+' / '+group]=
        (report.operator_group_by_kind[kind+' / '+group]||0)+1;
      report.operator_work_statuses[status]=(report.operator_work_statuses[status]||0)+1;
      for(const issue of row.issues||[]) {
        report.operator_issue_counts[issue]=(report.operator_issue_counts[issue]||0)+1;
      }
    }
    if(preview.page.has_next)report.blockers.push('UNIFIED_CENSUS_EXCEEDS_FIRST_100_ROWS');
    report.operator_projection_status='SQL_COMPATIBLE';
  } catch(error) {
    report.operator_projection_status='SQL_INCOMPATIBLE';
    report.blockers.push('UNIFIED_PROJECTION_SQL_INCOMPATIBLE_'+String(error.code||'UNKNOWN').slice(0,18));
    await client.query('ROLLBACK TO SAVEPOINT unified_preview');
  }
  await client.query('ROLLBACK');transaction=false;

  if(!report.migration_351_present)report.blockers.push('MIGRATION_351_NOT_INSTALLED');
  if(report.live_commit!=='3b23f91c00af60c768dee16a0a23dc5f86d48e9e')
    report.blockers.push('CATALOGUE_UNIFIED_PR_NOT_DEPLOYED');
  report.status=report.blockers.length?'NO_GO_PENDING_DEPLOYMENT':'READ_ONLY_PREFLIGHT_READY';
  fs.writeFileSync(OUTPUT,JSON.stringify(report,null,2)+'\n');
  console.log('STAGING_CATALOGUE_CENSUS '+JSON.stringify(report));
 } catch(error) {
  report.blockers.push(String(error.code||'STAGING_READONLY_PREFLIGHT_FAILED').slice(0,64));
  if(transaction)await client.query('ROLLBACK').catch(()=>{});
  fs.writeFileSync(OUTPUT,JSON.stringify(report,null,2)+'\n');
  console.error('STAGING_CATALOGUE_CENSUS_BLOCKED '+report.blockers.join(','));
  process.exitCode=1;
 } finally {if(connected)await client.end().catch(()=>{});}
}
main().catch(()=>{process.exitCode=1;});
