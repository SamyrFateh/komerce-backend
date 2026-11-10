#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role hub-v1-orphan-refs-preview
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Contrôler les usages FK et non-FK nommés des 34 fournisseurs / 17 sources E2E orphelins sur staging, SANS suppression.
 * @db-read suppliers, sourcing_sources, orders, users, relais, products, pg_catalog, information_schema, tables de relations
 * @db-write none
 * @db-txn REPEATABLE READ READ ONLY
 */
'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {listMarkers,assertEnvironment}=require('./hub-v1-staging-run-census');
const {buildCleanupInventory,FOREIGN_KEYS}=require('./hub-v1-fixture-dependency-inventory');
const {confirmTarget}=require('./target-guard');
const BASE='https://komerce-backend-production.up.railway.app';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const RUN=/^[A-F0-9]{8}$/;
const MAX_LINK_COLUMNS=300;
const ident=v=>{
  if(!/^[a-z_][a-z0-9_]*$/.test(String(v||'')))throw Error('ORPHAN_PREVIEW_UNSAFE_SQL_IDENTIFIER');
  return '"'+v+'"';
};

function makeOwnership(markers,inventories){
  if(markers.length!==inventories.length)throw Error('ORPHAN_PREVIEW_INVENTORY_MISMATCH');
  const target={supplierIds:[],sourceIds:[],runBySupplier:new Map(),runBySource:new Map(),counts:[]};
  for(let i=0;i<markers.length;i++){
    const r=markers[i],inv=inventories[i];
    if(!RUN.test(r.run8)||r.run8!==inv.run||inv.roots.length!==0||
        inv.verdict!=='HOLD_ORPHANED_FIXTURE_ROOTS'||
        inv.external_fixture_consumers.some(v=>v.external_rows>0))
      throw Error('ORPHAN_PREVIEW_SCOPE_NOT_ISOLATED:'+r.run8);
    const present=inv.owned_roots_outside_fk_graph.filter(v=>v.count>0);
    const suppliers=present.find(v=>v.table==='suppliers');
    const sources=present.find(v=>v.table==='sourcing_sources');
    if(present.length!==2||!suppliers||suppliers.count!==2||
        !sources||sources.count!==1||suppliers.truncated||sources.truncated||
        suppliers.invalid_ids||sources.invalid_ids)
      throw Error('ORPHAN_PREVIEW_UNEXPECTED_OWNED_ROOTS:'+r.run8);
    for(const id of suppliers.ids){
      if(!UUID.test(id)||target.runBySupplier.has(id))throw Error('ORPHAN_PREVIEW_SUPPLIER_ID_INVALID');
      target.supplierIds.push(id);target.runBySupplier.set(id,r.run8);
    }
    for(const id of sources.ids){
      if(id!=='api:whatsapp:E2E-HUB-V1-'+r.run8||target.runBySource.has(id))
        throw Error('ORPHAN_PREVIEW_SOURCE_ID_INVALID');
      target.sourceIds.push(id);target.runBySource.set(id,r.run8);
    }
    target.counts.push({run8:r.run8,suppliers:2,sources:1});
  }
  return target;
}

async function scanLinks(client, target) {
  const refs=[], opaque=[], visited=new Set();
  const sourceNames=new Map();
  const {rows:suppliers}=await client.query(
    'SELECT id::text AS id,name FROM suppliers WHERE id=ANY($1::uuid[])',[target.supplierIds]);
  if(suppliers.length!==target.supplierIds.length)throw Error('ORPHAN_PREVIEW_SUPPLIER_DRIFT');
  for(const item of suppliers){
    const run=target.runBySupplier.get(item.id);
    if(!run || !new RegExp('^E2E-HUB-V1-'+run+'-SUP-[A-Za-z0-9_-]+$').test(item.name))
      throw Error('ORPHAN_PREVIEW_SUPPLIER_NAME_MISMATCH');
    sourceNames.set(item.name,run);
  }

  // A detected link (even ON DELETE CASCADE) is a HOLD, never an invitation
  // to delete a historical child record or immutable proof.
  const inputs=[
    {kind:'supplier_id',ids:target.supplierIds,type:'uuid',runs:target.runBySupplier},
    {kind:'source_id',ids:target.sourceIds,type:'text',runs:target.runBySource},
    {kind:'supplier_name',ids:[...sourceNames.keys()],type:'text',runs:sourceNames},
  ];
  async function scan(table,column,input,relation){
    const key=[table,column,input.kind].join('.');
    if(visited.has(key))return;
    visited.add(key);
    const sql='SELECT '+ident(column)+'::text AS marker,COUNT(*)::int AS n FROM public.'+
      ident(table)+' WHERE '+ident(column)+'=ANY($1::'+input.type+'[]) GROUP BY '+ident(column);
    const {rows}=await client.query(sql,[input.ids]);
    for(const row of rows){
      if(!input.runs.has(row.marker))throw Error('ORPHAN_PREVIEW_UNEXPECTED_LINK_MARKER');
      if(Number(row.n)>0)refs.push({run8:input.runs.get(row.marker),table,column,relation,rows:Number(row.n)});
    }
  }

  const fks=(await client.query(FOREIGN_KEYS)).rows.filter(x=>
    x.parent_table==='suppliers'||x.parent_table==='sourcing_sources');
  for(const fk of fks){
    const parent=fk.parent_table;
    const wanted=parent==='suppliers'?'id':'source_id';
    const cols=fk.child_columns||[],parents=fk.parent_columns||[];
    if(cols.length!==1||parents.length!==1||parents[0]!==wanted){
      opaque.push({table:fk.child_table,constraint:fk.constraint_name,reason:'COMPOSITE_OR_UNEXPECTED_FK'});
      continue;
    }
    await scan(fk.child_table,cols[0],inputs[parent==='suppliers'?0:1],'FOREIGN_KEY');
  }
  const {rows:columns}=await client.query(
    "SELECT table_name,column_name,udt_name FROM information_schema.columns "+
    "WHERE table_schema='public' AND column_name ~* '(supplier|source)' "+
    "AND udt_name IN ('uuid','text','varchar','bpchar') ORDER BY table_name,column_name");
  if(columns.length>MAX_LINK_COLUMNS)throw Error('ORPHAN_PREVIEW_TOO_MANY_LINK_COLUMNS');
  for(const c of columns){
    if(['suppliers','sourcing_sources'].includes(c.table_name))continue;
    const name=String(c.column_name).toLowerCase();
    const isUuid=c.udt_name==='uuid';
    if(isUuid&&name.includes('supplier'))
      await scan(c.table_name,c.column_name,inputs[0],'NAMED_REFERENCE');
    else if(!isUuid&&name.includes('source'))
      await scan(c.table_name,c.column_name,inputs[1],'NAMED_REFERENCE');
    else if(!isUuid&&name.includes('supplier'))
      await scan(c.table_name,c.column_name,inputs[2],'NAMED_REFERENCE');
  }
  const triggers=(await client.query(
    "SELECT c.relname AS table_name,t.tgname AS trigger_name FROM pg_trigger t "+
    "JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace "+
    "WHERE n.nspname='public' AND c.relname IN ('suppliers','sourcing_sources') "+
    "AND NOT t.tgisinternal AND (t.tgtype & 8)<>0 ORDER BY c.relname,t.tgname"
  )).rows;
  return {refs,opaque,trigger_tables:[...new Set(triggers.map(t=>t.table_name))],
    columns_scanned:visited.size,fk_edges_checked:fks.length};
}

async function run({database,env=process.env,fetchImpl=fetch}={}){
  assertEnvironment(env);
  const db=database||require('../../db');
  const target=await confirmTarget({db,fetchImpl,env});
  if(!target?.confirmed)throw Error('ORPHAN_PREVIEW_TARGET_MISMATCH');
  const response=await fetchImpl(BASE+'/health/version');
  if(!response.ok)throw Error('ORPHAN_PREVIEW_VERSION_UNAVAILABLE');
  const version=await response.json();
  const sha=String(version.commit||version.sha||'');
  if(sha.toLowerCase()!==env.E2E_EXPECTED_DEPLOY_SHA.toLowerCase())
    throw Error('ORPHAN_PREVIEW_SHA_DRIFT');
  const client=await db.getClient();
  try{
    const markers=await listMarkers(client);
    if(!markers.length)throw Error('ORPHAN_PREVIEW_NO_RUN_MARKERS');
    const inventories=[];
    for(const marker of markers) {
      const inv=await buildCleanupInventory(client,marker.run8);
      inventories.push(inv);
    }
    const owned=makeOwnership(markers,inventories);
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    let links;
    try {links=await scanLinks(client,owned);} finally {await client.query('ROLLBACK');}
    const scope=owned.counts;
    const hashes=crypto.createHash('sha256').update(JSON.stringify({
      scope, suppliers:owned.supplierIds.slice().sort(),sources:owned.sourceIds.slice().sort(),
    })).digest('hex');
    return {
      schema:'hub-v1-orphan-links-preview/1',mode:'READ_ONLY',target:'OFFICIAL_STAGING',
      runtime_sha:sha,run_count:scope.length,supplier_count:owned.supplierIds.length,
      source_count:owned.sourceIds.length,manifest_sha256:hashes,
      counts:scope,foreign_key_edges_checked:links.fk_edges_checked,
      named_reference_columns_scanned:links.columns_scanned,
      links:links.refs,opaque:links.opaque,delete_trigger_tables:links.trigger_tables,
      verdict:links.refs.length||links.opaque.length||links.trigger_tables.length
        ? 'HOLD_LINKED_OR_TRIGGERED_FIXTURE'
        : 'CANDIDATE_NO_NAMED_LINKS_FOUND_POLICY_REVIEW_REQUIRED',
      limits:'Des references en JSONB, texte libre ou colonnes non semantiques ne sont pas exclues. Le statut CANDIDATE ne certifie pas un DELETE. Tables de fondation: revue explicite obligatoire.',
      delete_performed:false,cleanup_certified:false,
    };
  } finally {client.release();}
}

async function main(){
  const db=require('../../db');
  try{
    const result=await run({database:db});
    const dir=path.join('test-results','hub-v1-cert');
    fs.mkdirSync(dir,{recursive:true});
    const file=path.join(dir,'staging-orphan-refs-preview.json');
    fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify({
      verdict:result.verdict,run_count:result.run_count,
      supplier_count:result.supplier_count,source_count:result.source_count,
      link_count:result.links.length,opaque:result.opaque.length,
      delete_trigger_tables:result.delete_trigger_tables,
      manifest_sha256:result.manifest_sha256,delete_performed:false,file,
    }));
  } finally {if(db.pool?.end)await db.pool.end();}
}
if(require.main===module)main().catch(e=>{
  console.error('ORPHAN_REFS_PREVIEW_REFUSED:'+String(e.message).slice(0,180));
  process.exitCode=2;
});
module.exports={makeOwnership,scanLinks,run,ident};
