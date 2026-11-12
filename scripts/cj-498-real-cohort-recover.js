#!/usr/bin/env node
/** @komerce-arch-lite
 * @role CJ real-identity recovery for frozen read-only commercial proof
 * @domain catalog
 * @layer tooling
 * @owner backend-core
 * @purpose Recover two genuine CJ kids-clothing identities after 498-source artifact expiry, without inventing supplier data.
 * @db-read none
 * @db-write none
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cj=require('../services/suppliers/connectors/cj-connector');
const {basicCleanProduct,semanticRelevance}=require('./cj-500-e2e-catalog-sync');
const INPUT='baseline/classification-evidence.json';
const OUTPUT='artifacts/cj-real-498/classification-evidence.json';
const BASE_SHA='18a93c7dc27cc2074df21f313ec0a1982836bfa664381c20a9b29a5e68598b0f';
const BASE_COUNT=496;
const TARGET=498;
const QUERIES=[
  'baby romper','infant outfit','toddler clothing','baby clothing set',
  'baby onesie','kids summer dress','toddler dress','baby jacket',
  'girls sweater','boys tracksuit','children leggings','baby pajamas',
  'girls skirt','toddler winter coat','baby jumpsuit','kids cardigan',
  'boys hoodie','girls socks','infant bodysuit','children coat',
  'kids cotton shirt','baby overalls','boys short pants','baby dress'
];
function sha(buf){return crypto.createHash('sha256').update(buf).digest('hex');}
function readBase(file=INPUT){
  const buf=fs.readFileSync(file);
  if(sha(buf)!==BASE_SHA)throw Error('CJ_BASE_SHA_MISMATCH');
  const data=JSON.parse(buf.toString('utf8'));
  if(data.inspected!==BASE_COUNT||data.products?.length!==BASE_COUNT
      ||data.automatic!==54||data.certification!=='NOT_ASSERTED'
      ||new Set(data.products.map(x=>String(x.supplier_product_id))).size!==BASE_COUNT)
    throw Error('CJ_BASE_REAL_SOURCE_INVARIANTS_FAILED');
  return data;
}
function assertIsolation(env=process.env){
  if(env.NODE_ENV!=='test'||env.KOMERCE_ENV!=='staging'
    ||env.GITHUB_ACTIONS!=='true'||env.KOMERCE_DISABLE_CRONS!=='true'
    ||!(env.CJ_ACCESS_TOKEN||env.CJ_API_KEY))
    throw Error('CJ_CAPTURE_ISOLATED_OWNER_GITHUB_ACTIONS_ONLY');
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function fetchOne(query,page){
  for(let attempt=1;attempt<=4;attempt++){
    try {
      return await cj.fetchProducts({
        keyword:query,page,size:20,
        includeCommandableUnits:false,startWarehouseInventory:1
      });
    } catch(e) {
      if(attempt===4||!/429|rate.?limit|qps|insufficient api points/i.test(String(e.message||e)))throw e;
      await sleep(4000*attempt);
    }
  }
  throw Error('CJ_FETCH_NOT_COMPLETED');
}
async function run(input=INPUT,output=OUTPUT){
  assertIsolation();
  const data=readBase(input),seen=new Set(data.products.map(x=>String(x.supplier_product_id)));
  const captured=[],requests=[];
  for(const keyword of QUERIES){
    for(let page=1;page<=2;page++){
      const response=await fetchOne(keyword,page);
      const products=Array.isArray(response.products)?response.products:[];
      let qualifying=0;
      for(const p of products){
        const id=String(p.supplier_product_id||'').trim();
        if(!id||seen.has(id)||!basicCleanProduct(p))continue;
        if(!String(p.supplier_category||'').trim())continue;
        const relevance=semanticRelevance(p,keyword);
        if(relevance?.relevant!==true)continue;
        const record={
          candidate_ref:'CJ-REAL-RECOVERY-'+String(captured.length+1).padStart(3,'0'),
          supplier_product_id:id,
          product_name:p.product_name,
          supplier_category:p.supplier_category,
          segment_id:'mode-enfant',
          discovery_keyword:keyword,
          discovery_target:'Mode & Beauté/Enfant',
          status:'UNASSESSED',
          category:null,
          subcategory:null,
          operational_status:null,
          operational_evidence:null,
          operational_category:null,
          operational_subcategory:null,
          evidence:'REAL_CJ_SOURCE_OBSERVATION_ONLY',
          conflict:null,
          review_flags:[],
          fx_gate:null,
          candidate_state:'source_observed',
          publication_linked:false,
          real_source_proof:{
            supplier:'CJdropshipping',
            endpoint:'CJ product.listV2 query',
            request_id:response.request_id||null,
            query:keyword,page,
            normalized_schema_version:String(p.schema_version),
            positive_stock:true,
            positive_supplier_price:true,
            real_https_media:true,
            semantic_relevance:relevance
          }
        };
        captured.push(record);seen.add(id);qualifying++;
        if(captured.length===TARGET-BASE_COUNT)break;
      }
      requests.push({keyword,page,returned:products.length,selected:qualifying});
      if(captured.length===TARGET-BASE_COUNT)break;
      await sleep(1200);
    }
    if(captured.length===TARGET-BASE_COUNT)break;
  }
  if(captured.length!==TARGET-BASE_COUNT)
    throw Error('CJ_REAL_SOURCE_RECOVERY_SHORTFALL:'+captured.length+'/2');
  const byStatus={...data.by_status,UNASSESSED:captured.length};
  const byEvidence={...data.by_evidence,REAL_CJ_SOURCE_OBSERVATION_ONLY:captured.length};
  const bySegment={...data.by_segment};
  const kids={...bySegment['mode-enfant']};
  kids.total=Number(kids.total||0)+captured.length;
  kids.unassessed=captured.length;
  bySegment['mode-enfant']=kids;
  const out={
    ...data,
    kind:'REAL_CJ_498_SOURCE_TO_PG_INPUT',
    certification:'NOT_ASSERTED',
    inspected:TARGET,
    shortfall:500-TARGET,
    products:[...data.products,...captured],
    by_status:byStatus,
    by_evidence:byEvidence,
    by_segment:bySegment,
    unassessed:captured.length,
    provenance:{
      prior_run_id:40518230098,
      previous_count:BASE_COUNT,
      previous_sha256:BASE_SHA,
      recovered_by:'CJ_LIVE_PRODUCT_LISTV2',
      recovered_count:captured.length,
      provider_calls_read_only:true,
      source_queries:requests,
      produced_at:new Date().toISOString()
    }
  };
  if(out.products.length!==TARGET||new Set(out.products.map(p=>p.supplier_product_id)).size!==TARGET)
    throw Error('CJ_RECOVERED_498_IDENTITY_INVALID');
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n');
  console.log('[CJ_REAL_RECOVERY] '+JSON.stringify({
    inspected:out.inspected,base:BASE_COUNT,recovered:captured.length,
    uniqueIds:seen.size,queries:requests.length,sha256:sha(fs.readFileSync(output)),
    recovered_ids:captured.map(x=>x.supplier_product_id),
    sourceOnly:true,certification:out.certification
  }));
}
if(require.main===module){
 run(process.argv[2]||INPUT,process.argv[3]||OUTPUT)
  .catch(e=>{console.error('[CJ_REAL_RECOVERY] FAILED '+(e.stack||e));process.exitCode=1;});
}
module.exports={assertIsolation,readBase,run};
