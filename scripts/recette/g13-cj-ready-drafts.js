#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role g13-cj-ready-drafts
 * @domain catalog
 * @layer tooling
 * @owner backend-core
 * @purpose Stage-only exact TEST CJ draft preparation for 3 understocked categories via canonical APIs, never publication.
 * @db-read sourcing_candidates, products, product_skus, catalog_media, product_suppliers, suppliers
 * @db-write none (canonical HTTP APIs only)
 * @impact-areas sourcing, catalog, purchasing
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const db = require('../../db');
const { confirmTarget } = require('./target-guard');
const BASE = 'https://komerce-backend-production.up.railway.app';
const OUT = path.resolve('test-results/g13-cj-ready-drafts/report.json');
const TARGETS = Object.freeze([
  { candidate_ref:'KSC-000524', source:'2601060946311626300', category:'Enfant', subcategory:'École',
    name:'Sac à dos scolaire enfant, ensemble trois pièces',
    description:'Ensemble de trois pièces pour les affaires scolaires, proposé en plusieurs modèles selon le fournisseur.' },
  { candidate_ref:'KSC-000688', source:'1775800548592193536', category:'Bricolage', subcategory:'Outillage',
    name:'Ciseaux universels pour tissu et tapis',
    description:'Ciseaux universels destinés aux travaux de découpe de textile et de tapis.' },
  { candidate_ref:'KSC-000725', source:'1377142388740460544', category:'Créations personnelles', subcategory:'Cadeau',
    name:'Collier personnalisable avec prénom',
    description:'Collier personnalisé avec un prénom selon les options et modèles proposés par le fournisseur.' },
]);
function guard(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER
      || env.KOMERCE_ENV !== 'staging' || env.EXPECTED_RAILWAY_ENVIRONMENT !== 'staging'
      || env.STAGING_BASE_URL !== BASE
      || !String(env.PGOPTIONS || '').includes('default_transaction_read_only=on')
      || env.G13_DRAFT_SCOPE !== 'three-source-proven'
      || !/^\d{5,20}$/.test(env.GITHUB_RUN_ID || '')
      || !env.E2E_ADMIN_EMAIL || !env.E2E_ADMIN_PASSWORD) throw new Error('G13_CJ_DRAFT_GUARD_REFUSED');
  return TARGETS;
}
async function ro(sql,params=[]) {
  const client=await db.pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='15000ms'");
    return (await client.query(sql,params)).rows;
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}
const SRC_SQL=[
  'SELECT sc.candidate_ref,sc.state,sc.product_id,sc.supplier_product_id,',
  "UPPER(sc.scan_result->>'sourcing_decision') AS decision,",
  'p.product_ref,p.lifecycle_status,p.is_active,',
  '(SELECT COUNT(*)::int FROM jsonb_array_elements(',
  "CASE WHEN jsonb_typeof(sc.normalized_source_contract->'sellable_units')='array'",
  "THEN sc.normalized_source_contract->'sellable_units' ELSE '[]'::jsonb END",
  ") unit WHERE COALESCE((unit->>'is_active')::boolean,TRUE)",
  "AND NULLIF(BTRIM(unit->>'supplier_sku'),'') IS NOT NULL",
  "AND NULLIF(BTRIM(unit->>'supplier_unit_ref'),'') IS NOT NULL",
  "AND jsonb_typeof(unit->'supplier_order_identity')='object'",
  "AND (unit->>'stock_available') ~ '^[0-9]+([.][0-9]+)?$'",
  "AND (unit->>'stock_available')::numeric > 0) AS source_exact_stocked",
  'FROM sourcing_candidates sc LEFT JOIN products p ON p.id=sc.product_id',
  'WHERE sc.candidate_ref=$1 AND sc.supplier_product_id=$2',
  "AND LOWER(sc.supplier_name)='cjdropshipping' LIMIT 1",
].join(' ');
async function auth(env) {
  const x=await fetch(BASE+'/api/auth/login',{method:'POST',
    headers:{'content-type':'application/json',origin:BASE},
    body:JSON.stringify({email:env.E2E_ADMIN_EMAIL,password:env.E2E_ADMIN_PASSWORD})});
  if(!x.ok)throw Error('AUTH_HTTP_'+x.status);
  const cookie=x.headers.getSetCookie().map(z=>z.split(';')[0]).join('; ');
  const me=await fetch(BASE+'/api/auth/me',{headers:{cookie,origin:BASE}});
  const data=await me.json().catch(()=>({}));
  if(!me.ok||(data.role||data.user?.role)!=='admin')throw Error('ADMIN_ROLE_NOT_PROVEN');
  return cookie;
}
async function call(cookie,method,url,body) {
  const x=await fetch(BASE+url,{method,headers:{cookie,origin:BASE,
    ...(body===undefined?{}:{'content-type':'application/json'})},
    body:body===undefined?undefined:JSON.stringify(body)});
  const data=await x.json().catch(()=>({}));
  return {status:x.status,ok:x.ok,body:data};
}
async function main(env=process.env){
  const report={schema:'g13-cj-ready-drafts/1',verdict:'NOT_PROVEN',entries:[],run_id:env.GITHUB_RUN_ID||null};
  const save=()=>{fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');};
  try {
    const targets=guard(env);
    const target=await confirmTarget({db,env});
    if(!target.confirmed)throw Error('TARGET_NOT_CONFIRMED');
    report.db_fingerprint=target.fingerprint;
    const cookie=await auth(env);
    for(const spec of targets){
      const row={id:spec.candidate_ref,category:spec.category,subcategory:spec.subcategory,steps:{}};
      report.entries.push(row);
      try {
        let [before]=await ro(SRC_SQL,[spec.candidate_ref,spec.source]);
        row.before={decision:before?.decision||null,state:before?.state||null,
          source_exact_stocked:Number(before?.source_exact_stocked||0),
          product_ref:before?.product_ref||null};
        if(!before||before.decision!=='TEST'||Number(before.source_exact_stocked)<1||before.is_active){
          row.steps.preflight='SOURCE_OR_CATALOGUE_NOT_ELIGIBLE';save();continue;
        }
        if(!before.product_id){
          const res=await call(cookie,'POST',
            '/api/admin/workspaces/sourcing/candidates/'+encodeURIComponent(spec.candidate_ref)+'/confirm-boutique-category',
            {category:spec.category,subcategory:spec.subcategory});
          row.steps.classification={status:res.status,confirmed:res.body?.confirmed??null,
            draft_created:res.body?.draft_created??null,code:res.body?.code||res.body?.error||null};
          if(!res.ok){save();continue;}
        }
        let [after]=await ro(SRC_SQL,[spec.candidate_ref,spec.source]);
        if(!after?.product_id){
          const p=await call(cookie,'POST',
            '/api/admin/workspaces/sourcing/candidates/'+encodeURIComponent(spec.candidate_ref)+'/promote',{});
          row.steps.explicit_promotion={status:p.status,code:p.body?.code||p.body?.error||null};
          if(!p.ok){save();continue;}
          [after]=await ro(SRC_SQL,[spec.candidate_ref,spec.source]);
        }
        if(!after?.product_id||after.is_active||!after.product_ref){
          row.steps.draft='NOT_UNPUBLISHED_DRAFT';save();continue;
        }
        row.product_ref=after.product_ref;
        const [sku]=await ro('SELECT COUNT(*) FILTER (WHERE is_active=TRUE AND stock>0)::int AS stocked FROM product_skus WHERE product_id=$1',
          [after.product_id]);
        row.active_stocked_skus=Number(sku?.stocked||0);
        if(row.active_stocked_skus<1){row.steps.skus='SOURCE_SKU_NOT_MATERIALIZED';save();continue;}
        const fr=await call(cookie,'POST',
          '/api/admin/workspaces/catalog/approval/'+encodeURIComponent(after.product_ref)+'/prepare-fr',
          {name:spec.name,description:spec.description});
        row.steps.french={status:fr.status,code:fr.body?.code||fr.body?.error||null};
        if(!fr.ok){save();continue;}
        const providers=await call(cookie,'GET','/api/purchasing/suppliers');
        const list=Array.isArray(providers.body)?providers.body:providers.body?.suppliers||[];
        const sup=list.find(x=>String(x.platform||'').toLowerCase()==='cj'&&x.is_active!==false&&!x.deleted_at);
        if(!providers.ok||!sup?.id){row.steps.supplier='CJ_SUPPLIER_NOT_FOUND';save();continue;}
        const mapped=await ro(
          'SELECT ps.id FROM product_suppliers ps JOIN product_skus sku ON sku.product_id=ps.product_id AND sku.supplier_sku=ps.supplier_sku AND sku.is_active=TRUE AND sku.stock>0 WHERE ps.product_id=$1 AND ps.supplier_id=$2 AND ps.is_active=TRUE AND ps.deleted_at IS NULL LIMIT 1',
          [after.product_id,sup.id]);
        if(!mapped.length){
          const [first]=await ro('SELECT supplier_sku FROM product_skus WHERE product_id=$1 AND is_active=TRUE AND stock>0 ORDER BY created_at LIMIT 1',[after.product_id]);
          if(!first){row.steps.supplier='SKU_FOR_MAPPING_ABSENT';save();continue;}
          const m=await call(cookie,'POST','/api/purchasing/suppliers/'+sup.id+'/map',
            {product_id:after.product_id,supplier_sku:first.supplier_sku,notes:'G13 staging '+env.GITHUB_RUN_ID});
          row.steps.supplier_link={status:m.status,code:m.body?.code||m.body?.error||null};
          if(!m.ok){save();continue;}
        }
        const [linked]=await ro(
          'SELECT COUNT(*)::int AS n FROM product_suppliers ps JOIN product_skus sku ON sku.product_id=ps.product_id AND sku.supplier_sku=ps.supplier_sku AND sku.is_active=TRUE AND sku.stock>0 WHERE ps.product_id=$1 AND ps.supplier_id=$2 AND ps.is_active=TRUE AND ps.deleted_at IS NULL',[after.product_id,sup.id]);
        row.supplier_links=Number(linked?.n||0);
        const media=await ro('SELECT id, source_media_id, url FROM catalog_media WHERE product_id=$1 AND is_active=TRUE ORDER BY display_order, created_at LIMIT 12',[after.product_id]);
        row.media=media;
        row.verdict=row.supplier_links>0&&media.length>0?'DRAFT_READY_FOR_REAL_VISUAL_REVIEW_NOT_PUBLISHED':'DRAFT_INCOMPLETE';
      } catch(err) {
        row.steps.error=String(err.code||err.message||err).slice(0,240);
      }
      save();
    }
    report.ready=report.entries.filter(x=>x.verdict==='DRAFT_READY_FOR_REAL_VISUAL_REVIEW_NOT_PUBLISHED').length;
    report.verdict=report.ready===targets.length?'THREE_DRAFTS_READY_NOT_G13_GO':'PARTIAL_DRAFTS_NOT_G13_GO';
    if(report.ready!==targets.length)process.exitCode=2;
  }catch(err){report.verdict='BLOCKED';report.error=String(err.code||err.message||err).slice(0,240);process.exitCode=2;}
  finally{save();await db.pool.end().catch(()=>{});console.log(JSON.stringify({verdict:report.verdict,ready:report.ready||0,error:report.error||null}));}
}
if(require.main===module)main();
module.exports={TARGETS,guard};
