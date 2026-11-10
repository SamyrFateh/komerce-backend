#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role hub-v1-orphan-selective-retire
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Supprimer UNIQUEMENT 34 fournisseurs et 17 sources E2E-HUB-V1 explicitement inventoriés, sans CASCADE, après simulation annulée et vérification de dépendances.
 * @db-read suppliers, sourcing_sources, orders, users, relais, products, pg_catalog, information_schema, références entrantes
 * @db-write suppliers, sourcing_sources (identités E2E exactes uniquement)
 * @db-txn one_owned_transaction (rollback dry-run, commit guarded execute)
 */
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {listMarkers,assertEnvironment}=require('./hub-v1-staging-run-census');
const {buildCleanupInventory}=require('./hub-v1-fixture-dependency-inventory');
const {makeOwnership,scanLinks,ident}=require('./hub-v1-orphan-refs-preview');
const {confirmTarget}=require('./target-guard');

const STAGING='https://komerce-backend-production.up.railway.app';
const EXPECTED_MANIFEST='439fb559dca1400209ac71ed7c4251e297c6c37c21fb0787dd44fd32b0aaf1b0';
const OWNER_ISSUE='[staging-op] hub-v1-orphan-selective-retire-51';
const ACK='RETIRE-EXACT-51-ORPHANED-E2E';
const EXPECTED={runs:17,suppliers:34,sources:17};
const MAX_FREEFORM_COLUMNS=500;

function assertExecution(mode,env=process.env){
  assertEnvironment(env);
  if(!['dry-run','execute'].includes(mode))throw Error('HUB_V1_RETIRE_MODE_INVALID');
  if(env.HUB_V1_ORPHAN_EXPECTED_MANIFEST!==EXPECTED_MANIFEST)
    throw Error('HUB_V1_RETIRE_MANIFEST_PIN_REQUIRED');
  if(mode==='execute'&&(
      env.HUB_V1_ORPHAN_CLEANUP_ACK!==ACK||
      env.GITHUB_EVENT_NAME!=='issues'||
      env.GITHUB_ACTOR!==env.GITHUB_REPOSITORY_OWNER||
      env.GITHUB_REPOSITORY!=='SamyrFateh/komerce-backend'||
      env.GITHUB_ISSUE_TITLE!==OWNER_ISSUE
    ))throw Error('HUB_V1_RETIRE_OWNER_CONFIRMATION_REQUIRED');
}
function digest(owned){
  return crypto.createHash('sha256').update(JSON.stringify({
    scope:owned.counts,
    suppliers:owned.supplierIds.slice().sort(),
    sources:owned.sourceIds.slice().sort(),
  })).digest('hex');
}
function assertOwnership(owned) {
  if(owned.counts.length!==EXPECTED.runs||
      owned.supplierIds.length!==EXPECTED.suppliers||
      owned.sourceIds.length!==EXPECTED.sources||
      owned.counts.some(x=>x.suppliers!==2||x.sources!==1)||
      digest(owned)!==EXPECTED_MANIFEST)
    throw Error('HUB_V1_RETIRE_OWNERSHIP_OR_MANIFEST_CHANGED');
}
function assertNoLinks(links){
  if(links.refs.length||links.opaque.length||links.trigger_tables.length)
    throw Error('HUB_V1_RETIRE_FOREIGN_KEYS_OR_TRIGGERS_PRESENT');
  if(links.fk_edges_checked<11||links.columns_scanned<151)
    throw Error('HUB_V1_RETIRE_LINK_COVERAGE_REGRESSION');
}
const quote=ident;
function safeRegex(v){return String(v).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
// Free text / JSON may contain denormalized supplier names, source IDs or UUIDs.
// Do not ignore historic event payloads or "soft" references just because FKs are empty.
async function scanFreeform(client,owned){
  const {rows:parents}=await client.query(
    'SELECT id::text AS id,name FROM public.suppliers WHERE id=ANY($1::uuid[]) ORDER BY id',
    [owned.supplierIds]);
  if(parents.length!==EXPECTED.suppliers)throw Error('HUB_V1_RETIRE_SUPPLIERS_CHANGED');
  const markers=[...parents.map(x=>x.name),...owned.sourceIds,...owned.supplierIds];
  if(markers.some(x=>!x||x.length>180))throw Error('HUB_V1_RETIRE_MARKER_INVALID');
  const expression='('+markers.map(safeRegex).join('|')+')';
  const {rows:cols}=await client.query(
    "SELECT c.table_name,c.column_name,c.udt_name FROM information_schema.columns c "+
    "JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name "+
    "WHERE c.table_schema='public' AND t.table_type='BASE TABLE' AND "+
    "(c.udt_name IN ('jsonb','json') OR "+
    "(c.udt_name IN ('text','varchar','bpchar') AND "+
    "c.column_name ~* '(payload|snapshot|metadata|notes|description|comment|message|reason|detail|data|identity|response|request|event|supplier|source|ref)')) "+
    "ORDER BY c.table_name,c.column_name"
  );
  if(!cols.length||cols.length>MAX_FREEFORM_COLUMNS)
    throw Error('HUB_V1_RETIRE_FREEFORM_COVERAGE_UNVERIFIED');
  const hits=[];
  for(const col of cols){
    if(['suppliers','sourcing_sources'].includes(col.table_name))continue;
    const sql='SELECT 1 FROM public.'+quote(col.table_name)+
      ' WHERE '+quote(col.column_name)+'::text ~* $1 LIMIT 1';
    const {rows}=await client.query(sql,[expression]);
    if(rows.length)hits.push({table:col.table_name,column:col.column_name});
    if(hits.length>=8)break;
  }
  return {scanned:cols.length,hits};
}
async function readBaseline(client,owned){
  const {rows:[base]}=await client.query(
    'SELECT (SELECT count(*)::int FROM products) AS products,'+
    '(SELECT count(*)::int FROM orders) AS orders,'+
    '(SELECT count(*)::int FROM users) AS users,'+
    '(SELECT count(*)::int FROM relais) AS relais,'+
    '(SELECT count(*)::int FROM suppliers WHERE id=ANY($1::uuid[])) AS fixture_suppliers,'+
    '(SELECT count(*)::int FROM sourcing_sources WHERE source_id=ANY($2::text[])) AS fixture_sources',
    [owned.supplierIds,owned.sourceIds]);
  if(!base||Object.values(base).some(x=>!Number.isSafeInteger(Number(x))))
    throw Error('HUB_V1_RETIRE_BASELINE_UNAVAILABLE');
  return base;
}
function assertUnrelatedUntouched(before,after) {
  for(const key of ['products','orders','users','relais']){
    if(Number(before[key])!==Number(after[key]))
      throw Error('HUB_V1_RETIRE_UNRELATED_TABLE_CHANGED:'+key);
  }
}
async function prepareOwnership(client){
  const markers=await listMarkers(client);
  const inventories=[];
  for(const row of markers)inventories.push(await buildCleanupInventory(client,row.run8));
  const owned=makeOwnership(markers,inventories);
  assertOwnership(owned);
  return owned;
}
async function run({mode,env=process.env,database,fetchImpl=fetch}={}){
  assertExecution(mode,env);
  const db=database||require('../../db');
  const target=await confirmTarget({db,fetchImpl,env});
  if(!target?.confirmed)throw Error('HUB_V1_RETIRE_STAGING_DB_MISMATCH');
  const response=await fetchImpl(STAGING+'/health/version');
  if(!response.ok)throw Error('HUB_V1_RETIRE_VERSION_UNAVAILABLE');
  const runtime=(await response.json()).commit;
  if(String(runtime||'').toLowerCase()!==env.E2E_EXPECTED_DEPLOY_SHA.toLowerCase())
    throw Error('HUB_V1_RETIRE_SHA_MISMATCH');
  const client=await db.getClient();
  let transactionOpen=false;
  try{
    const owned=await prepareOwnership(client);
    await client.query('BEGIN');transactionOpen=true;
    await client.query("SET LOCAL lock_timeout='3000ms'");
    await client.query("SET LOCAL statement_timeout='15000ms'");
    // Lock only the 51 exact rows, never the catalog or operational tables.
    const {rows:lockedSuppliers}=await client.query(
      'SELECT id::text AS id,name FROM suppliers WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [owned.supplierIds]);
    const {rows:lockedSources}=await client.query(
      'SELECT source_id FROM sourcing_sources WHERE source_id=ANY($1::text[]) ORDER BY source_id FOR UPDATE',
      [owned.sourceIds]);
    if(lockedSuppliers.length!==EXPECTED.suppliers||
        lockedSources.length!==EXPECTED.sources)
      throw Error('HUB_V1_RETIRE_LOCKED_ROWS_MISMATCH');
    for(const r of lockedSuppliers){
      const run8=owned.runBySupplier.get(r.id);
      if(!run8||!new RegExp('^E2E-HUB-V1-'+run8+'-SUP-[A-Za-z0-9_-]+$').test(r.name))
        throw Error('HUB_V1_RETIRE_SUPPLIER_OWNERSHIP_MISMATCH');
    }
    const baseline=await readBaseline(client,owned);
    if(Number(baseline.fixture_suppliers)!==EXPECTED.suppliers||
       Number(baseline.fixture_sources)!==EXPECTED.sources)
      throw Error('HUB_V1_RETIRE_BASELINE_DRIFT');

    const links=await scanLinks(client,owned);
    assertNoLinks(links);
    const freeform=await scanFreeform(client,owned);
    if(freeform.hits.length)throw Error('HUB_V1_RETIRE_HISTORICAL_TEXT_REFERENCE:'+freeform.hits.map(x=>x.table).join(','));

    // No CASCADE keyword, no trigger suppression, no direct status mutation.
    // The transaction is always ROLLBACK for dry-run and COMMIT only for the owner-approved issue.
    const {rows:deletedSources}=await client.query(
      "DELETE FROM sourcing_sources WHERE source_id=ANY($1::text[]) AND source_id LIKE 'api:whatsapp:E2E-HUB-V1-%' RETURNING source_id",
      [owned.sourceIds]);
    const {rows:deletedSuppliers}=await client.query(
      "DELETE FROM suppliers WHERE id=ANY($1::uuid[]) AND name LIKE 'E2E-HUB-V1-%-SUP-%' RETURNING id",
      [owned.supplierIds]);
    if(deletedSources.length!==EXPECTED.sources||
       deletedSuppliers.length!==EXPECTED.suppliers)
      throw Error('HUB_V1_RETIRE_DELETE_COUNT_MISMATCH');
    const after=await readBaseline(client,owned);
    assertUnrelatedUntouched(baseline,after);
    if(Number(after.fixture_suppliers)!==0||Number(after.fixture_sources)!==0)
      throw Error('HUB_V1_RETIRE_RESIDUAL_ROWS');
    if(mode==='dry-run'){
      await client.query('ROLLBACK');transactionOpen=false;
      const restored=await readBaseline(client,owned);
      if(Number(restored.fixture_suppliers)!==EXPECTED.suppliers||
         Number(restored.fixture_sources)!==EXPECTED.sources)
        throw Error('HUB_V1_RETIRE_ROLLBACK_NOT_VERIFIED');
    }else{
      await client.query('COMMIT');transactionOpen=false;
      const readback=await readBaseline(client,owned);
      assertUnrelatedUntouched(baseline,readback);
      if(Number(readback.fixture_suppliers)!==0||Number(readback.fixture_sources)!==0)
        throw Error('HUB_V1_RETIRE_POST_COMMIT_READBACK_FAILED');
    }
    return {schema:'hub-v1-orphan-selective-retire/1',
      verdict:mode==='execute'?'EXACT_51_SELECTIVE_RETIRE_PASS':'EXACT_51_ROLLBACK_DRY_RUN_PASS',
      mode,run_count:EXPECTED.runs,suppliers:EXPECTED.suppliers,sources:EXPECTED.sources,
      manifest_sha256:EXPECTED_MANIFEST,runtime_sha:runtime,
      fk_edges:links.fk_edges_checked,named_columns:links.columns_scanned,
      freeform_columns:freeform.scanned,freeform_matches:0,
      baseline_unrelated:baseline,readback:mode==='execute'?'ZERO_FIXTURE_ROWS':'FULL_ROLLBACK_RESTORED',
      delete_performed:mode==='execute',cleanup_certified:false};
  }catch(error){
    if(transactionOpen)await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==1||!['--dry-run','--execute'].includes(args[0]))
    throw Error('HUB_V1_RETIRE_REQUIRE_EXACT_MODE');
  const mode=args[0].slice(2),db=require('../../db');
  try{
    const report=await run({mode,database:db});
    fs.mkdirSync('test-results/hub-v1-cert',{recursive:true});
    const file=path.join('test-results/hub-v1-cert','orphan-selective-'+mode+'.json');
    fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({verdict:report.verdict,run_count:report.run_count,
      suppliers:report.suppliers,sources:report.sources,
      freeform_columns:report.freeform_columns,delete_performed:report.delete_performed,
      manifest_sha256:report.manifest_sha256,file}));
  }finally{if(db.pool?.end)await db.pool.end();}
}
if(require.main===module)main().catch(e=>{
  console.error('HUB_V1_RETIRE_REFUSED:'+String(e.message||e).slice(0,190));
  process.exitCode=2;
});
module.exports={assertExecution,digest,assertOwnership,assertNoLinks,
  scanFreeform,readBaseline,assertUnrelatedUntouched,run};
