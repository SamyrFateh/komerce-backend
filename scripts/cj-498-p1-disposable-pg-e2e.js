#!/usr/bin/env node
/** @komerce-arch-lite
 * @role sourcing-commercial-evidence-real-pg-certification
 * @domain catalog
 * @layer test
 * @owner backend-core
 * @purpose Certify 498 real CJ source identities and actual Sourcing->inactive-Catalog draft on disposable PG.
 * @db-read boutique_categories,boutique_subcategories,supplier_commercial_category_mappings,products
 * @db-write products (ROLLED BACK)
 * @impact-areas sourcing,catalog,isolated-ci
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const db=require('../db');
const {resolveCommercialTaxonomyVerdict,
  createDraftProductFromSourcingCandidate}=require('../services/catalog-candidate-product-service');
const EXPECTED_URL='postgresql://komerce:komerce@127.0.0.1:5432/komerce_real_catalog_stress';
const EXPECTED_SHA='9ff18f6f902f2e72fc893a90da96b61058c77028d55e941381631fc9fb8116de';
const OUTPUT='artifacts/cj-p1-evidence-boundary-real-pg/report.json';
const inc=(x,k)=>{x[k]=(x[k]||0)+1;};
function sourceCandidate(item){
  const [category,subcategory]=String(item.discovery_target||'').split('/');
  return {
    supplier_name:'CJdropshipping',supplier_product_id:item.supplier_product_id,
    product_name:item.product_name,supplier_category:item.supplier_category,
    normalized_source_contract:{supplier_name:'CJdropshipping',source_locale:'en',
      supplier_category:item.supplier_category},
    raw_payload:{discovery:{target_category:category||null,target_subcategory:subcategory||null,
      keyword:item.discovery_keyword||null,segment_id:item.segment_id}},
  };
}
function assertRuntime(env=process.env) {
  if(env.NODE_ENV!=='test'||env.KOMERCE_ENV!=='staging'
    ||env.GITHUB_ACTIONS!=='true'||env.KOMERCE_DISABLE_CRONS!=='true'
    ||env.DATABASE_URL!==EXPECTED_URL)
    throw Error('E2E_DISPOSABLE_PG_ONLY');
}
function assertEqual(a,b,code){if(a!==b)throw Error(code+':'+String(a)+'!='+String(b));}
function loadCorpus(file){
  const bytes=fs.readFileSync(file),sha=crypto.createHash('sha256').update(bytes).digest('hex');
  assertEqual(sha,EXPECTED_SHA,'REAL_CJ_SHA256_MISMATCH');
  const data=JSON.parse(bytes.toString('utf8'));
  assertEqual(data.inspected,498,'REAL_CJ_INSPECTED_MISMATCH');
  assertEqual(data.products.length,498,'REAL_CJ_ROWS_MISMATCH');
  assertEqual(data.automatic,52,'REAL_CJ_BASELINE_AUTO_MISMATCH');
  assertEqual(new Set(data.products.map(x=>x.supplier_product_id)).size,498,'DUPLICATE_SUPPLIER_ID');
  return data;
}
async function transactionProof(client,label,candidate,{shouldCreate,expectedCategory,expectedSubcategory}={}){
  const before=Number((await client.query('SELECT COUNT(*)::int AS n FROM products')).rows[0].n);
  let createdId=null,reason=null;
  try {
    createdId=await createDraftProductFromSourcingCandidate(client,{candidate,initialPrice:null});
  }catch(e){reason=e.message||String(e);}
  if(shouldCreate){
    if(!createdId)throw Error('EXPECTED_INACTIVE_DRAFT_MISSING:'+label+':'+reason);
    const {rows:[prod]}=await client.query('SELECT id,is_active,is_available,lifecycle_status,price_kmf,boutique_category_key,boutique_subcategory_key FROM products WHERE id=$1',[createdId]);
    if(!prod||prod.is_active!==false||prod.is_available!==false||prod.lifecycle_status!=='candidate'
      ||prod.price_kmf!==null||prod.boutique_category_key!==expectedCategory
      ||prod.boutique_subcategory_key!==expectedSubcategory)
      throw Error('INACTIVE_DRAFT_OR_TAXONOMY_INVARIANT_FAILED:'+label+':'+JSON.stringify(prod));
    assertEqual(Number((await client.query('SELECT COUNT(*)::int AS n FROM products')).rows[0].n),before+1,'PRODUCT_INSERT_EXPECTED');
    return {label,created:true,category:prod.boutique_category_key,subcategory:prod.boutique_subcategory_key,
      inactive:true,unpriced:true};
  }
  if(createdId)throw Error('UNJUSTIFIED_DRAFT_CREATED:'+label+':'+createdId);
  if(!reason||!reason.includes('BOUTIQUE_TAXONOMY'))throw Error('EXPECTED_CLASSIFICATION_GATE_NOT_FIRED:'+label+':'+reason);
  assertEqual(Number((await client.query('SELECT COUNT(*)::int AS n FROM products')).rows[0].n),before,'REJECTED_DRAFT_MUST_NOT_WRITE');
  return {label,created:false,reason};
}
async function run(file=process.argv[2]||'baseline/classification-evidence.json',
  output=process.argv[3]||OUTPUT){
  assertRuntime();
  const doc=loadCorpus(file);
  const dbName=(await db.query('SELECT current_database() AS db')).rows[0].db;
  assertEqual(dbName,'komerce_real_catalog_stress','DATABASE_IDENTITY');
  const active=(await db.query('SELECT bc.key AS category, bs.key AS subcategory FROM boutique_subcategories bs JOIN boutique_categories bc ON bc.key=bs.category_key WHERE bc.is_active=TRUE AND bs.is_active=TRUE')).rows;
  const activeSet=new Set(active.map(x=>x.category+'/'+x.subcategory));
  if(activeSet.size<15||!activeSet.has('Mode & Beauté/Enfant')
    ||!activeSet.has('Auto/Accessoires')||!activeSet.has('Tech/Phones'))throw Error('CANONICAL_TAXONOMY_NOT_READY');
  const byStatus={},byEvidence={},byPair={},drift=[],samples=[];
  let ignoredDiscovery=0,discoveryOnly=0,auto=0;
  for(const original of doc.products){
    const candidate=sourceCandidate(original);
    const v=await resolveCommercialTaxonomyVerdict(db,candidate);
    const p=v.category&&v.subcategory?v.category+'/'+v.subcategory:null;
    inc(byStatus,v.status);inc(byEvidence,v.source);
    if(v.status==='AUTO_CLASSIFIED'){
      auto++;inc(byPair,p);
      if(!activeSet.has(p)||v.source==='OPERATOR_OR_DISCOVERY'||v.source==='DISCOVERY_PRIOR')
        throw Error('UNJUSTIFIED_AUTO:'+original.candidate_ref+':'+JSON.stringify(v));
    } else if(v.status==='EXPLICIT_REVIEW'){
      throw Error('HUMAN_CONFIRMATION_FABRICATED:'+original.candidate_ref);
    } else if(v.status==='REVIEW_REQUIRED') {
      if(v.category||v.subcategory)throw Error('REVIEW_HAS_AUTHORITATIVE_PAIR:'+original.candidate_ref);
      if(v.source==='DISCOVERY_PRIOR') {
        discoveryOnly++;
        const prior=String(original.discovery_target||'');
        if(p||v.proposal?.category+'/'+v.proposal?.subcategory!==prior)
          throw Error('DISCOVERY_PRIOR_LOST:'+original.candidate_ref);
      }
    } else throw Error('UNKNOWN_CLASSIFICATION_STATUS:'+v.status);
    if(original.evidence==='OPERATOR_OR_DISCOVERY')ignoredDiscovery++;
    const previous=original.status+'|'+(original.category||'')+'/'+(original.subcategory||'');
    const current=v.status+'|'+(v.category||'')+'/'+(v.subcategory||'');
    if(previous!==current&&drift.length<30)drift.push({ref:original.candidate_ref,title:original.product_name,previous,current,
      source:v.source,discovery_target:original.discovery_target});
    if(samples.length<20&&['DISCOVERY_PRIOR','CLOTHING_SOURCE_OBJECT_CONTRADICTION',
      'CHILD_APPAREL_SOURCE_OBJECT_CONTRADICTION'].includes(v.source))
      samples.push({ref:original.candidate_ref,title:original.product_name,source:v.source,
        proposal:v.proposal||null});
  }
  // These are genuine service calls on a real PostgreSQL transaction and
  // canonical boutique reference tables, not mocked SQL nor live Railway.
  const client=await db.getClient(),draftProofs=[];
  let rolledBack=false;
  try{
    await client.query('BEGIN');
    const trap={supplier_name:'CJdropshipping',product_name:'Silky Light Fog Lip Gloss',
      supplier_category:'Health, Beauty & Hair > Makeup > Lipstick',
      komerce_category:'cosmetiques',raw_payload:{discovery:{target_category:'Auto',target_subcategory:'Éclairage'}}};
    draftProofs.push(await transactionProof(client,'lip_gloss_discovery_wrong',trap,{shouldCreate:false}));
    const actualObject={supplier_name:'CJdropshipping',product_name:'Car Neck Pillow Memory Foam',
      supplier_category:'Automobiles > Car Accessories',komerce_category:'materiels',
      raw_payload:{discovery:{target_category:'Maison',target_subcategory:'Déco'}}};
    draftProofs.push(await transactionProof(client,'car_object_wins_wrong_discovery',actualObject,
      {shouldCreate:true,expectedCategory:'Auto',expectedSubcategory:'Accessoires'}));
    const realChild={supplier_name:'CJdropshipping',product_name:'Girls Floral Dress',
      supplier_category:'Girls Clothing > Girl Dresses',komerce_category:'vetements',
      raw_payload:{discovery:{target_category:'Créations personnelles',target_subcategory:'Cérémonie'}}};
    draftProofs.push(await transactionProof(client,'child_garment_wins_wrong_discovery',realChild,
      {shouldCreate:true,expectedCategory:'Mode & Beauté',expectedSubcategory:'Enfant'}));
    const human={supplier_name:'AliExpress',product_name:'Generic Source Object',
      supplier_category:'Unmapped > Generic',komerce_category:'materiels',
      commercial_taxonomy_review:{status:'CONFIRMED',category:'Tech',subcategory:'Phones'},
      raw_payload:{discovery:{target_category:'Auto',target_subcategory:'Éclairage'}}};
    draftProofs.push(await transactionProof(client,'explicit_human_wins',human,
      {shouldCreate:true,expectedCategory:'Tech',expectedSubcategory:'Phones'}));
    const inactive={...human,commercial_taxonomy_review:{status:'CONFIRMED',
      category:'Tech',subcategory:'Inactive'}};
    draftProofs.push(await transactionProof(client,'inactive_human_pair_blocked',inactive,
      {shouldCreate:false}));
    // Deliberately collide two proven object phrases under ONE active parent.
    // The transaction must produce a category-only draft, not invent a leaf.
    for(const subcategory of ['Cuisine','Déco']){
      const update=await client.query(
        "UPDATE boutique_subcategories SET object_classification_terms = "+
        "object_classification_terms || '{\"storage cube\":12}'::jsonb "+
        "WHERE category_key='Maison' AND key=$1 AND is_active=TRUE",
        [subcategory]);
      if(update.rowCount!==1)throw Error('CATEGORY_PARENT_E2E_FIXTURE_MISSING:'+subcategory);
    }
    const categoryOnly={supplier_name:'CJdropshipping',
      product_name:'Storage Cube Organizer',
      supplier_category:'Unmapped > Unclear Objects',
      komerce_category:'autre',
      raw_payload:{discovery:{target_category:'Tech',target_subcategory:'Phones'}}};
    draftProofs.push(await transactionProof(client,'category_only_common_parent',categoryOnly,
      {shouldCreate:true,expectedCategory:'Maison',expectedSubcategory:null}));
  }finally {
    try{await client.query('ROLLBACK');rolledBack=true;}finally{client.release();}
  }
  const out={kind:'REAL_PG_E2E_CJ_SOURCE_TO_CATALOG_DRAFT',
    certification:'PROVEN_BOUNDARY_NOT_PRODUCT_PRECISION',
    source_count:498,previous_automatic:doc.automatic,
    candidate_automatic:auto,candidate_review:498-auto,
    prior_discovery_proposals:ignoredDiscovery,discovery_only:discoveryOnly,
    by_status:byStatus,by_evidence:byEvidence,by_pair:byPair,
    changed_examples:drift,review_samples:samples,product_draft_proofs:draftProofs,
    transaction_rolled_back:rolledBack,publication_performed:false,supplier_calls:0};
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n');
  console.log('[CJ_P1_REAL_PG] '+JSON.stringify({inspected:498,automatic:auto,
    review:498-auto,discovery_only:discoveryOnly,prior_seen:ignoredDiscovery,
    by_evidence:byEvidence,draft_proofs:draftProofs.length,rollback:rolledBack}));
  return out;
}
if(require.main===module){
  run().catch(e=>{console.error('[CJ_P1_REAL_PG] FAILED: '+(e.stack||e));process.exitCode=1;})
    .finally(()=>db.pool.end());
}
module.exports={assertRuntime,sourceCandidate,loadCorpus,transactionProof,run};
