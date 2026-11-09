#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role hub-v1-fixture-ownership-inventory
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Découvrir le graphe FK de la fixture E2E-HUB-V1 sans jamais purger ou modifier des données.
 * @db-read orders, users, relais, suppliers, products, product_skus, product_suppliers, hub_physical_units, international_shipments, customs_shipments, purchase_lines, sourcing_candidates, pg_catalog, relations FK liées
 * @db-write none
 * @db-txn READ ONLY
 */
'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {confirmTarget}=require('./target-guard');
const SCOPE='E2E-HUB-V1';
const SUFFIXES=Object.freeze(['KOM-101','KOM-102','KOM-103','LOCAL']);
const RUN=/^[A-Z0-9]{8}$/;
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const MAX_IDS=2500;
const MAX_VISITS=500;
const HOST='https://komerce-backend-production.up.railway.app';
const identifier=s=>{
  if(!/^[a-z_][a-z0-9_]*$/.test(String(s||'')))throw Error('HUB_V1_INVALID_DATABASE_IDENTIFIER');
  return '"'+s+'"';
};
function exactRefs(run){
  if(!RUN.test(String(run||'')))throw Error('HUB_V1_RUN8_INVALID');
  return SUFFIXES.map(s=>SCOPE+'-'+run+'-'+s);
}
function validateRoots(orders,run){
  const allowed=new Set(exactRefs(run));
  const expectedEmail='e2e-hub-v1-'+run.toLowerCase()+'@komerce.test';
  const seen=new Set();
  for(const o of orders){
    if(!allowed.has(o.reference)||seen.has(o.reference)||
       o.simulation_scope!==SCOPE||
       String(o.buyer_email||'').toLowerCase()!==expectedEmail||
       o.payment_mode!=='cash_relais'||!UUID.test(o.id)){
      throw Error('HUB_V1_FIXTURE_ROOT_OWNERSHIP_MISMATCH');
    }
    seen.add(o.reference);
  }
  return {present:seen.size,missing:[...allowed].filter(r=>!seen.has(r))};
}

const FOREIGN_KEYS="\nSELECT c.conname AS constraint_name,child.relname AS child_table,parent.relname AS parent_table,\n  array_to_json(ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,ord)\n    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.ord)) AS child_columns,\n  array_to_json(ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,ord)\n    JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.ord)) AS parent_columns,\n  EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.conrelid\n          AND a.attname='id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped) AS child_has_uuid_id\nFROM pg_constraint c\nJOIN pg_class child ON child.oid=c.conrelid\nJOIN pg_class parent ON parent.oid=c.confrelid\nJOIN pg_namespace cn ON cn.oid=child.relnamespace\nJOIN pg_namespace pn ON pn.oid=parent.relnamespace\nWHERE c.contype='f' AND cn.nspname='public' AND pn.nspname='public'\nORDER BY parent.relname,child.relname,c.conname\n";

async function inspect(client,run,{transactionManaged=true}={}){
  const refs=exactRefs(run);
  const report={scope:SCOPE,run,mode:'READ_ONLY',delete_performed:false,
    cleanup_certified:false,roots:[],missing:refs,dependencies:[],
    opaque_dependencies:[],truncated:false,verdict:'HOLD_NO_CLEANUP'};
  if(transactionManaged)await client.query('BEGIN READ ONLY');
  try{
    const {rows:orders}=await client.query(
      'SELECT o.id,o.reference,o.simulation_scope,o.payment_mode,u.email AS buyer_email '+
      'FROM public.orders o JOIN public.users u ON u.id=o.user_id '+
      'WHERE o.reference=ANY($1::text[]) ORDER BY o.reference',[refs]);
    const ownership=validateRoots(orders,run);
    report.roots=orders.map(o=>({id:o.id,reference:o.reference}));
    report.missing=ownership.missing;
    if(!orders.length){
      report.verdict='EMPTY_FIXTURE_NO_CLEANUP_NEEDED';
      return report;
    }
    const {rows:fks}=await client.query(FOREIGN_KEYS);
    const byParent=new Map();
    for(const fk of fks){
      if(!byParent.has(fk.parent_table))byParent.set(fk.parent_table,[]);
      byParent.get(fk.parent_table).push(fk);
    }
    const ids=new Map([['orders',new Set(orders.map(o=>o.id))]]);
    const queue=['orders'];
    let visits=0;
    while(queue.length){
      if(++visits>MAX_VISITS){report.truncated=true;break;}
      const parent=queue.shift(),parentIds=[...(ids.get(parent)||[])];
      if(!parentIds.length)continue;
      for(const edge of byParent.get(parent)||[]){
        const child=edge.child_table,cc=edge.child_columns||[],pc=edge.parent_columns||[];
        const label={table:child,column:cc.join(','),parent,constraint:edge.constraint_name};
        if(cc.length!==1||pc.length!==1||pc[0]!=='id'){
          report.opaque_dependencies.push({...label,reason:'COMPOSITE_OR_NON_ID_FOREIGN_KEY'});
          continue;
        }
        // Identifiers come from pg_catalog and are allowlisted, not input text.
        const table='public.'+identifier(child),column=identifier(cc[0]);
        const sql=edge.child_has_uuid_id
          ? 'SELECT DISTINCT id::text AS id FROM '+table+' WHERE '+column+'=ANY($1::uuid[]) LIMIT '+(MAX_IDS+1)
          : 'SELECT COUNT(*)::int AS n FROM '+table+' WHERE '+column+'=ANY($1::uuid[])';
        const rows=(await client.query(sql,[parentIds])).rows;
        if(!edge.child_has_uuid_id){
          const n=Number(rows[0]?.n||0);
          if(n)report.opaque_dependencies.push({...label,rows:n,reason:'NO_UUID_ID_CANNOT_ATTRIBUTE_RECURSIVELY'});
          continue;
        }
        const found=rows.map(r=>String(r.id));
        if(found.length>MAX_IDS){report.truncated=true;continue;}
        if(!found.length)continue;
        if(found.some(v=>!UUID.test(v)))throw Error('HUB_V1_NON_UUID_DEPENDENCY');
        const set=ids.get(child)||new Set(),oldSize=set.size;
        for(const v of found)set.add(v);
        ids.set(child,set);
        report.dependencies.push({...label,matching_rows:found.length});
        if(set.size>MAX_IDS)report.truncated=true;
        if(set.size>oldSize&&!queue.includes(child))queue.push(child);
      }
      if(report.truncated)break;
    }
    // The scan is intentionally discovery-only. It does not prove the absence
    // of non-FK references, append-only triggers or ownership of shared parents.
    report.discovered_tables=[...ids.entries()].map(([table,set])=>({table,count:set.size}))
      .sort((a,b)=>a.table.localeCompare(b.table));
    // Deux ensembles de dependances peuvent avoir le MEME count avec des UUID
    // differents. Le manifeste doit alors changer. Publier seulement une
    // empreinte de chaque ensemble (pas les UUID des preuves dans les logs).
    report.dependency_identity_fingerprints=[...ids.entries()].map(([table,set])=>({
      table,count:set.size,
      ids_sha256:crypto.createHash('sha256')
        .update(JSON.stringify({table,ids:[...set].sort()})).digest('hex'),
    })).sort((a,b)=>a.table.localeCompare(b.table));
    report.verdict=report.truncated?'HOLD_DEPENDENCY_GRAPH_TOO_LARGE'
      :report.opaque_dependencies.length?'HOLD_OPAQUE_RELATIONS'
      :ownership.missing.length?'HOLD_INCOMPLETE_FIXTURE'
      :'HOLD_FK_GRAPH_ONLY_NOT_CERTIFIED_FOR_DELETE';
    return report;
  }finally{if(transactionManaged)await client.query('ROLLBACK');}
}

// ─── Inventaire de nettoyage étendu (lecture seule) : racines hors graphe FK + preuves immuables ───
const DELETE_BLOCKERS = "\nSELECT c.relname AS table_name, t.tgname AS trigger_name, p.proname AS function_name,\n  (t.tgtype & 8) <> 0 AS on_delete, (t.tgtype & 16) <> 0 AS on_update\nFROM pg_trigger t\nJOIN pg_class c ON c.oid=t.tgrelid\nJOIN pg_namespace n ON n.oid=c.relnamespace\nJOIN pg_proc p ON p.oid=t.tgfoid\nWHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname = ANY($1::text[])\n  AND (t.tgtype & 2) <> 0 AND ((t.tgtype & 8) <> 0 OR (t.tgtype & 16) <> 0)\n  AND p.prosrc ~* 'raise\\s+(exception|.*exception)'\nORDER BY c.relname, t.tgname\n";
const FK_DELETE_RULES = "\nSELECT parent.relname AS parent_table, child.relname AS child_table, c.conname AS constraint_name, c.confdeltype::text AS delete_rule\nFROM pg_constraint c\nJOIN pg_class child ON child.oid=c.conrelid\nJOIN pg_class parent ON parent.oid=c.confrelid\nJOIN pg_namespace pn ON pn.oid=parent.relnamespace\nWHERE c.contype='f' AND pn.nspname='public' AND parent.relname = ANY($1::text[])\nORDER BY 1,2,3\n";
// Racines propres à la fixture mais sans clé étrangère depuis orders : retrouvées par leurs marqueurs RUN8 exacts.
const OWNED_ROOTS = (run) => [
  ['users', "SELECT id::text AS id FROM users WHERE lower(email) LIKE $1", ['e2e-hub-v1-' + run.toLowerCase() + '%@komerce.test']],
  ['relais', 'SELECT id::text AS id FROM relais WHERE name = $1', [SCOPE + '-' + run + '-RELAIS']],
  ['suppliers', 'SELECT id::text AS id FROM suppliers WHERE name LIKE $1', [SCOPE + '-' + run + '-SUP-%']],
  ['products', 'SELECT id::text AS id FROM products WHERE product_ref LIKE $1', [SCOPE + '-' + run + '-%']],
  ['product_skus', 'SELECT s.id::text AS id FROM product_skus s JOIN products p ON p.id=s.product_id WHERE p.product_ref LIKE $1', [SCOPE + '-' + run + '-%']],
  ['product_suppliers', 'SELECT ps.id::text AS id FROM product_suppliers ps JOIN products p ON p.id=ps.product_id WHERE p.product_ref LIKE $1', [SCOPE + '-' + run + '-%']],
  ['local_stock', 'SELECT l.id::text AS id FROM local_stock l JOIN products p ON p.id=l.product_id WHERE p.product_ref LIKE $1', [SCOPE + '-' + run + '-%']],
  ['product_market_price_drafts', 'SELECT d.id::text AS id FROM product_market_price_drafts d JOIN products p ON p.id=d.product_id WHERE p.product_ref LIKE $1', [SCOPE + '-' + run + '-%']],
  ['product_sku_physical_codes', 'SELECT c.id::text AS id FROM product_sku_physical_codes c JOIN product_skus s ON s.id=c.product_sku_id JOIN products p ON p.id=s.product_id WHERE p.product_ref LIKE $1', [SCOPE + '-' + run + '-%']],
  ['sourcing_candidates', 'SELECT id::text AS id FROM sourcing_candidates WHERE supplier_name = $1', [SCOPE + '-' + run]],
  ['sourcing_sources', 'SELECT source_id::text AS id FROM sourcing_sources WHERE source_id = $1', ['api:whatsapp:' + SCOPE + '-' + run]],
  ['purchase_orders', 'SELECT DISTINCT pl.purchase_order_id::text AS id FROM purchase_lines pl JOIN order_items oi ON oi.id=pl.order_item_id JOIN orders o ON o.id=oi.order_id WHERE o.reference LIKE $1 AND pl.purchase_order_id IS NOT NULL', [SCOPE + '-' + run + '-%']],
  ['hub_physical_units', 'SELECT id::text AS id FROM hub_physical_units WHERE reference LIKE $1', [SCOPE + '-' + run + '-%']],
  ['international_shipments', 'SELECT id::text AS id FROM international_shipments WHERE reference LIKE $1', [SCOPE + '-' + run + '-%']],
  ['customs_shipments', 'SELECT id::text AS id FROM customs_shipments WHERE reference LIKE $1', [SCOPE + '-' + run + '-%']],
];
async function buildCleanupInventory(client, run) {
  // Une seule photographie MVCC : les commandes, dépendances et preuves immuables
  // ne peuvent pas provenir de deux états différents de staging.
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const report = await inspect(client, run, {transactionManaged:false});
    const owned = [];
    for (const [table, sql, args] of OWNED_ROOTS(run)) {
      const { rows } = await client.query(sql, args);
      const ids=rows.map((r)=>String(r.id||''));
      const validIds=ids.filter((v)=>/^[A-Za-z0-9:_.-]{1,80}$/.test(v));
      owned.push({ table, count:rows.length, ids:validIds.slice(0,MAX_IDS),
        truncated:rows.length>MAX_IDS, invalid_ids:rows.length-validIds.length });
    }
    const direct = [...new Set([...(report.discovered_tables || []).map((t) => t.table), ...owned.filter((o) => o.count).map((o) => o.table)])].sort();
    const fkRules = (await client.query(FK_DELETE_RULES, [direct])).rows;
    // Enfants (1 saut) des racines propres à la fixture : tables qui bloqueraient aussi la suppression (ex. autorisations, événements).
    const tables = [...new Set([...direct, ...fkRules.map((r) => r.child_table)])].sort();
    const blockers = (await client.query(DELETE_BLOCKERS, [tables])).rows;
    const byTable = new Map(tables.map((t) => [t, { table: t, delete_blocking_triggers: [], update_guard_triggers: [] }]));
    for (const b of blockers) {
      const entry = byTable.get(b.table_name);
      (b.on_delete ? entry.delete_blocking_triggers : entry.update_guard_triggers).push(b.trigger_name);
    }
    const immutableAll = [...byTable.values()].filter((t) => t.delete_blocking_triggers.length);
    const holdsFixtureRows = new Set(direct);
    const immutable = immutableAll.filter((t) => holdsFixtureRows.has(t.table));
    report.owned_roots_outside_fk_graph = owned;
    report.immutability = [...byTable.values()];
    report.fk_delete_rules = fkRules;
    report.tables_considered = tables;
    // Empreinte de l'état observé : utile au contrôle avant/après, mais jamais une
    // autorisation de suppression. Les preuves append-only sont conservées.
    const snapshot={scope:SCOPE,run,roots:report.roots,
      discovered_tables:report.discovered_tables||[],
      dependency_identity_fingerprints:report.dependency_identity_fingerprints||[],
      owned_roots:owned.map(({table,count,ids})=>({table,count,ids:ids.slice().sort()})),
      opaque_dependencies:report.opaque_dependencies,
      immutable_tables:immutable.map((t)=>t.table).sort()};
    report.snapshot_sha256=crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    report.cleanup_scope_checks={
      exact_roots:report.roots.length===0||report.missing.length===0,
      no_opaque_fk:(report.opaque_dependencies||[]).length===0,
      no_truncation:!report.truncated&&!owned.some((o)=>o.truncated),
      valid_owned_root_ids:owned.every((o)=>o.invalid_ids===0),
      immutable_evidence_retained:true,
    };
    // Un trigger de suppression sur un ENFANT d'une racine est au minimum
    // une preuve potentielle : conserver le RUN8 en bloc. Ne jamais transformer
    // une absence de match direct en permission DELETE.
    report.cleanup_strategy = immutableAll.length
      ? {decision:'RETAIN_FIXTURE_PREFIX_NO_DELETE',
          reason:'preuves append-only directes ou potentielles : conserver le RUN8 ; ne pas supprimer ni desactiver les triggers',
          immutable_tables:immutable.map((t)=>t.table),
          immutable_tables_potential_children:immutableAll.filter((t)=>!holdsFixtureRows.has(t.table)).map((t)=>t.table),
          delete_performed:false}
      : {decision:'HOLD_DISCOVERY_ONLY_NO_APPLY',
          reason:'absence de trigger de blocage ne prouve ni exclusivite des relations ni permission DELETE',
          immutable_tables:[],
          immutable_tables_potential_children:[],
          delete_performed:false};
    if(report.roots.length===0&&owned.some((o)=>o.count>0))report.verdict='HOLD_ORPHANED_FIXTURE_ROOTS';
    else if(!Object.values(report.cleanup_scope_checks).every(Boolean))report.verdict='HOLD_INCOMPLETE_OWNERSHIP_INVENTORY';
    else if(immutable.length)report.verdict='HOLD_IMMUTABLE_PROOFS_RETAINED';
    else if(immutableAll.length)report.verdict='HOLD_IMMUTABLE_PROOFS_POTENTIAL';
    report.cleanup_certified=false;
    report.delete_performed=false;
    return report;
  } finally { await client.query('ROLLBACK'); }
}
async function main(){
  const run=String(process.argv[2]||'');
  exactRefs(run); // fail before database access
  if(process.env.KOMERCE_ENV!=='staging'||process.env.KOMERCE_TARGET_ENV!=='staging'||
     process.env.NODE_ENV==='production'||process.env.STAGING_BASE_URL!==HOST){
    throw Error('HUB_V1_INVENTORY_STAGING_ONLY');
  }
  const sha=String(process.env.E2E_EXPECTED_DEPLOY_SHA||'');
  if(!/^[a-f0-9]{40}$/i.test(sha))throw Error('HUB_V1_PINNED_SHA_REQUIRED');
  const db=require('../../db');
  try{
    if(!(await confirmTarget({db}))?.confirmed)throw Error('HUB_V1_TARGET_NOT_CONFIRMED');
    const response=await fetch(HOST+'/health/version');
    if(!response.ok)throw Error('HUB_V1_VERSION_UNAVAILABLE');
    const version=await response.json();
    if(String(version.commit||version.sha||'').toLowerCase()!==sha.toLowerCase())
      throw Error('HUB_V1_RUNTIME_SHA_DRIFT');
    const client=await db.getClient();
    let report;
    try{report=await buildCleanupInventory(client,run);}finally{client.release();}
    report.runtime_sha=sha;
    const dir=path.join('test-results','hub-v1-cert');
    fs.mkdirSync(dir,{recursive:true});
    const file=path.join(dir,'dependency-inventory-'+run+'.json');
    fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({verdict:report.verdict,roots:report.roots.length,
      dependencies:report.dependencies.length,opaque:report.opaque_dependencies.length,
      owned_root_tables:report.owned_roots_outside_fk_graph.length,
      immutable_tables:report.cleanup_strategy.immutable_tables,
      snapshot_sha256:report.snapshot_sha256,
      delete_performed:false,cleanup_certified:false,artifact:file}));
  }finally{await db.pool.end();}
}
if(require.main===module)main().catch(e=>{
  console.error('HUB_V1_CLEANUP_INVENTORY_REFUSED:'+String(e.message).slice(0,180));
  process.exitCode=2;
});
module.exports={exactRefs,validateRoots,inspect,buildCleanupInventory,FOREIGN_KEYS,DELETE_BLOCKERS};
