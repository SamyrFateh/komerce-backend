#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role hub-v1-fixture-ownership-inventory
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Découvrir le graphe FK de la fixture E2E-HUB-V1 sans jamais purger ou modifier des données.
 * @db-read orders, users, pg_catalog, relations FK liées
 * @db-write none
 * @db-txn READ ONLY
 */
'use strict';

const fs=require('fs');
const path=require('path');
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

async function inspect(client,run){
  const refs=exactRefs(run);
  const report={scope:SCOPE,run,mode:'READ_ONLY',delete_performed:false,
    cleanup_certified:false,roots:[],missing:refs,dependencies:[],
    opaque_dependencies:[],truncated:false,verdict:'HOLD_NO_CLEANUP'};
  await client.query('BEGIN READ ONLY');
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
    report.verdict=report.truncated?'HOLD_DEPENDENCY_GRAPH_TOO_LARGE'
      :report.opaque_dependencies.length?'HOLD_OPAQUE_RELATIONS'
      :ownership.missing.length?'HOLD_INCOMPLETE_FIXTURE'
      :'HOLD_FK_GRAPH_ONLY_NOT_CERTIFIED_FOR_DELETE';
    return report;
  }finally{await client.query('ROLLBACK');}
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
    try{report=await inspect(client,run);}finally{client.release();}
    report.runtime_sha=sha;
    const dir=path.join('test-results','hub-v1-cert');
    fs.mkdirSync(dir,{recursive:true});
    const file=path.join(dir,'dependency-inventory-'+run+'.json');
    fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({verdict:report.verdict,roots:report.roots.length,
      dependencies:report.dependencies.length,opaque:report.opaque_dependencies.length,
      delete_performed:false,cleanup_certified:false,artifact:file}));
  }finally{await db.pool.end();}
}
if(require.main===module)main().catch(e=>{
  console.error('HUB_V1_CLEANUP_INVENTORY_REFUSED:'+String(e.message).slice(0,180));
  process.exitCode=2;
});
module.exports={exactRefs,validateRoots,inspect,FOREIGN_KEYS};
