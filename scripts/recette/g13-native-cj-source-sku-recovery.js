#!/usr/bin/env node
/** @komerce-arch-lite
 * @role g13-native-cj-source-sku-recovery
 * @domain catalog
 * @layer tooling
 * @owner backend-core
 * @purpose Owner-only staging canary/batch: invoke official Sourcing admin API to restore exact CJ V2 SKUs.
 * @db-read sourcing_candidates, products, product_skus
 * @db-write none
 * @impact-areas catalog, sourcing, purchasing
 */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const db=require('../../db');
const {confirmTarget}=require('./target-guard');
const manifest=require('./g13-catalogue-manifest.json');
const BASE='https://komerce-backend-production.up.railway.app';
const out=path.resolve('test-results/g13-native-cj-sku-recovery/report.json');
const env=process.env;
const result={schema:'g13-source-sku-recovery/1',mode:env.G13_SKU_RECOVERY_SCOPE||null,
  verdict:'NOT_PROVEN',entries:[]};
function save(){fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n')}
async function read(sql,args=[]){
  const client=await db.pool.connect();
  try{await client.query('BEGIN READ ONLY');const r=await client.query(sql,args);return r.rows}
  finally{await client.query('ROLLBACK').catch(()=>{});client.release()}
}
async function call(url,options={}) {
  const resp=await fetch(BASE+url,options);
  let body=null;try{body=await resp.json()}catch(_){}
  return {status:resp.status,ok:resp.ok,body};
}
async function main(){
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_ACTOR!==env.GITHUB_REPOSITORY_OWNER ||
     env.KOMERCE_ENV!=='staging'||env.EXPECTED_RAILWAY_ENVIRONMENT!=='staging' ||
     env.STAGING_BASE_URL!==BASE ||
     !String(env.PGOPTIONS||'').includes('default_transaction_read_only=on') ||
     !['canary','batch'].includes(env.G13_SKU_RECOVERY_SCOPE) ||
     !/^\d{5,20}$/.test(env.GITHUB_RUN_ID||''))throw Error('G13_SKU_RECOVERY_GUARD_REFUSED');
  const pin=await confirmTarget({db,env});
  if(!pin.confirmed)throw Error('TARGET_NOT_CONFIRMED');
  result.target=pin.fingerprint;
  if(!env.E2E_ADMIN_EMAIL||!env.E2E_ADMIN_PASSWORD)throw Error('E2E_ADMIN_MISSING');
  const login=await fetch(BASE+'/api/auth/login',{method:'POST',
    headers:{'content-type':'application/json',origin:BASE},
    body:JSON.stringify({email:env.E2E_ADMIN_EMAIL,password:env.E2E_ADMIN_PASSWORD})});
  if(!login.ok)throw Error('G13_SKU_ADMIN_LOGIN_'+login.status);
  const cookie=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
  const me=await call('/api/auth/me',{headers:{cookie,origin:BASE}});
  if(!me.ok||!['admin'].includes(me.body?.role||me.body?.user?.role))throw Error('G13_SKU_ADMIN_NOT_AUTHORIZED');
  const cj=manifest.entries.filter(e=>e.source==='cj');
  if(cj.length!==17)throw Error('G13_SKU_PINNED_17_REQUIRED');
  const entries=env.G13_SKU_RECOVERY_SCOPE==='canary'?cj.slice(0,1):cj;
  for(const entry of entries){
    const [before]=await read(
      `SELECT sc.candidate_ref,sc.state,sc.product_id,p.lifecycle_status,p.is_active,
              (SELECT COUNT(*)::int FROM product_skus WHERE product_id=p.id) AS skus,
              (SELECT COUNT(*)::int
                 FROM jsonb_array_elements(sc.normalized_source_contract->'sellable_units') unit
                WHERE COALESCE((unit->>'is_active')::boolean,TRUE)) AS expected_active,
              (SELECT COUNT(*)::int
                 FROM product_skus sku
                 JOIN jsonb_array_elements(sc.normalized_source_contract->'sellable_units') unit
                   ON sku.supplier_sku=unit->>'supplier_sku'
                  AND sku.supplier_unit_ref=unit->>'supplier_unit_ref'
                  AND sku.supplier_order_identity=unit->'supplier_order_identity'
                WHERE sku.product_id=p.id AND sku.is_active=TRUE
                  AND COALESCE((unit->>'is_active')::boolean,TRUE)) AS verified_exact
         FROM sourcing_candidates sc JOIN products p ON p.id=sc.product_id
        WHERE sc.supplier_product_id=$1 AND LOWER(sc.supplier_name) LIKE 'cj%'`,
      [String(entry.supplier_ref)]);
    const row={id:entry.id,candidate_ref:before?.candidate_ref||null,
      state:before?.state||null,previous_skus:before?.skus??null,api_status:null,code:null,
      restored:null,actual_skus:null};
    result.entries.push(row);
    if(!before||before.state!=='imported_to_catalog'||before.is_active||
      before.lifecycle_status==='active'||Number(before.expected_active)<=0){
      row.code='PRECONDITION_NOT_MET';continue;
    }
    // Batch after the successful canary: do not reissue a writer request if
    // every existing source SKU and its native identity match the V2 snapshot.
    if(Number(before.skus)>0){
      if(Number(before.skus)===Number(before.expected_active) &&
         Number(before.verified_exact)===Number(before.expected_active)){
        row.api_status=200;row.code='ALREADY_RESTORED_VERIFIED';
        row.restored=Number(before.expected_active);
        row.actual_skus=Number(before.skus);
      } else row.code='PREEXISTING_SKU_IDENTITY_MISMATCH';
      continue;
    }
    const url='/api/admin/sourcing/candidates/'+encodeURIComponent(before.candidate_ref)+'/restore-source-skus';
    const resp=await call(url,{method:'POST',headers:{cookie,origin:BASE,'content-type':'application/json'},body:'{}'});
    row.api_status=resp.status;row.code=resp.body?.code||resp.body?.error||null;
    row.restored=resp.body?.restored??null;
    const [after]=await read('SELECT COUNT(*)::int AS n FROM product_skus WHERE product_id=$1',[before.product_id]);
    row.actual_skus=after?.n??null;
    if(!resp.ok||row.actual_skus!==row.restored||Number(row.actual_skus)<=0)
      row.code=row.code||'VERIFY_MISMATCH';
  }
  result.verdict=result.entries.every(x=>x.api_status===200&&x.actual_skus===x.restored&&x.actual_skus>0)
    ? 'RECOVERED_INACTIVE_DRAFTS_NOT_PUBLISHED' : 'PARTIAL_BLOCKED';
  save();
  if(result.verdict==='PARTIAL_BLOCKED')process.exitCode=2;
}
main().catch(e=>{result.verdict='BLOCKED';result.error=String(e.code||e.message||e).slice(0,300);save();process.exitCode=2})
.finally(()=>db.pool.end?.().catch(()=>{}));
