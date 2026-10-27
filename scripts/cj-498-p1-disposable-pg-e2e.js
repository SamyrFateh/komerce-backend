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
const {buildCounterAudit}=require('./lib/cj-classification-counter-audit');
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
  const activeCategories=new Set(active.map(x=>x.category));
  if(activeSet.size<15||!activeSet.has('Mode & Beauté/Enfant')
    ||!activeSet.has('Auto/Accessoires')||!activeSet.has('Tech/Phones'))throw Error('CANONICAL_TAXONOMY_NOT_READY');
  const byStatus={},byEvidence={},byPair={},byCategory={},drift=[],samples=[],categorySamples=[],decisions=[];
  let ignoredDiscovery=0,discoveryOnly=0,auto=0,category=0;
  const mixedGenderRefs=new Set(['KSC-000012','KSC-000017','KSC-000031']);
  const counterAuditRefs=new Map([
    ['KSC-000094',['REVIEW_REQUIRED',null,null]],
    ['KSC-000479',['REVIEW_REQUIRED',null,null]],
    ['KSC-000150',['REVIEW_REQUIRED',null,null]],
    ['KSC-000399',['REVIEW_REQUIRED',null,null]],
    ['KSC-000465',['CATEGORY_CLASSIFIED','Maison',null]],
    ['KSC-000476',['CATEGORY_CLASSIFIED','Maison',null]],
    ['KSC-000477',['CATEGORY_CLASSIFIED','Maison',null]],
    ['KSC-000478',['REVIEW_REQUIRED',null,null]],
  ]);
  const realObjectRegression=new Map([
    ['KSC-000168',['CATEGORY_CLASSIFIED','Tech',null]],
    ['KSC-000169',['CATEGORY_CLASSIFIED','Tech',null]],
    ['KSC-000051',['CATEGORY_CLASSIFIED','Mode & Beauté',null]],
    ['KSC-000060',['AUTO_CLASSIFIED','Mode & Beauté','Enfant']],
    ['KSC-000104',['CATEGORY_CLASSIFIED','Maison',null]],
    ['KSC-000110',['CATEGORY_CLASSIFIED','Maison',null]],
    ['KSC-000283',['CATEGORY_CLASSIFIED','Bricolage',null]],
    ['KSC-000284',['CATEGORY_CLASSIFIED','Bricolage',null]],
    ['KSC-000285',['CATEGORY_CLASSIFIED','Bricolage',null]],
    ['KSC-000286',['CATEGORY_CLASSIFIED','Bricolage',null]],
    ['KSC-000287',['CATEGORY_CLASSIFIED','Bricolage',null]],
    ['KSC-000290',['CATEGORY_CLASSIFIED','Bricolage',null]],
    ['KSC-000291',['CATEGORY_CLASSIFIED','Bricolage',null]],
    ['KSC-000292',['CATEGORY_CLASSIFIED','Bricolage',null]],
    ['KSC-000312',['CATEGORY_CLASSIFIED','Maison',null]],
    ['KSC-000324',['CATEGORY_CLASSIFIED','Maison',null]],
    ['KSC-000326',['CATEGORY_CLASSIFIED','Maison',null]],
    ['KSC-000327',['CATEGORY_CLASSIFIED','Maison',null]],
  ]);
  for(const original of doc.products){
    const candidate=sourceCandidate(original);
    const v=await resolveCommercialTaxonomyVerdict(db,candidate);
    const p=v.category&&v.subcategory?v.category+'/'+v.subcategory:null;
    inc(byStatus,v.status);inc(byEvidence,v.source);
    if(counterAuditRefs.has(original.candidate_ref)){
      const want=counterAuditRefs.get(original.candidate_ref);
      if([v.status,v.category,v.subcategory].some((x,i)=>x!==want[i]))
        throw Error('COUNTER_AUDIT_WRONG_CLASSIFICATION:'+
          original.candidate_ref+':expected='+JSON.stringify(want)+
          ':observed='+JSON.stringify(v));
      counterAuditRefs.delete(original.candidate_ref);
    }
    if(realObjectRegression.has(original.candidate_ref)){
      const want=realObjectRegression.get(original.candidate_ref);
      if([v.status,v.category,v.subcategory].some((x,i)=>x!==want[i]))
        throw Error('REAL_OBJECT_CATEGORY_REGRESSION:'+original.candidate_ref+
          ':expected='+JSON.stringify(want)+':observed='+JSON.stringify(v));
      realObjectRegression.delete(original.candidate_ref);
    }
    if(mixedGenderRefs.has(original.candidate_ref)) {
      if(v.status!=='CATEGORY_CLASSIFIED'||v.category!=='Mode & Beauté'
        ||v.subcategory!==null||v.source!=='SEMANTIC_MIXED_GENDER_APPAREL')
        throw Error('MIXED_GENDER_PARENT_REGRESSION:'+original.candidate_ref+':'+JSON.stringify(v));
      mixedGenderRefs.delete(original.candidate_ref);
    }
    decisions.push({supplier_product_id:original.supplier_product_id,
      candidate_ref:original.candidate_ref,product_name:original.product_name,
      supplier_category:original.supplier_category,
      verdict:v.status,category:v.category||null,subcategory:v.subcategory||null,
      evidence_source:v.source,evidence:v.evidence||null,
      suggestion:v.proposal||null});
    if(v.status==='AUTO_CLASSIFIED'){
      auto++;inc(byPair,p);
      if(!activeSet.has(p)||v.source==='OPERATOR_OR_DISCOVERY'||v.source==='DISCOVERY_PRIOR')
        throw Error('UNJUSTIFIED_AUTO:'+original.candidate_ref+':'+JSON.stringify(v));
    } else if(v.status==='CATEGORY_CLASSIFIED') {
      category++;inc(byCategory,v.category);
      if(!v.category||v.subcategory!==null||!activeCategories.has(v.category)
        ||!['OBJECT_TERM_COMMON_PARENT','SUPPLIER_PATH_AND_OBJECT',
          'SEMANTIC_MIXED_GENDER_APPAREL','SEMANTIC_CHILD_APPAREL_PARENT'].includes(v.source))
        throw Error('UNJUSTIFIED_CATEGORY:'+original.candidate_ref+':'+JSON.stringify(v));
      if(v.source==='SUPPLIER_PATH_AND_OBJECT' && !v.evidence?.object_families?.length)
        throw Error('CATEGORY_EVIDENCE_MISSING:'+original.candidate_ref);
      if(categorySamples.length<35) categorySamples.push({ref:original.candidate_ref,
        title:original.product_name,path:original.supplier_category,
        category:v.category,source:v.source,evidence:v.evidence||null});
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
  if(mixedGenderRefs.size)throw Error('MIXED_GENDER_CORPUS_REFS_MISSING:'+Array.from(mixedGenderRefs).join(','));
  if(realObjectRegression.size)throw Error('REAL_OBJECT_CORPUS_REFS_MISSING:'+Array.from(realObjectRegression.keys()).join(','));
  if(counterAuditRefs.size)throw Error('COUNTER_AUDIT_REFS_MISSING:'+Array.from(counterAuditRefs.keys()).join(','));
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
    const mixed={supplier_name:'CJdropshipping',
      product_name:'Woolen Loose Cape Tops For Men And Women',
      supplier_category:"Women's Clothing > Outerwear & Jackets > Blazers",
      komerce_category:'vetements',
      raw_payload:{discovery:{target_category:'Auto',target_subcategory:'Éclairage'}}};
    draftProofs.push(await transactionProof(client,'mixed_gender_parent_unpriced',mixed,
      {shouldCreate:true,expectedCategory:'Mode & Beauté',expectedSubcategory:null}));
    // Human learning is governed, not unsupervised. First a human explicitly
    // confirms an object's destination. Reuse for other SKUs is only allowed
    // after an editor separately accepts a reusable multiword OBJECT phrase in
    // the active boutique vocabulary. Both decisions are rolled back.
    const first={supplier_name:'CJdropshipping',
      product_name:'Foldable Rattan Fruit Basket',
      supplier_category:'Unmapped > Experimental Household',
      komerce_category:'autre',
      raw_payload:{discovery:{target_category:'Tech',target_subcategory:'Phones'}},
      commercial_taxonomy_review:{status:'CONFIRMED',category:'Maison',subcategory:'Cuisine'}};
    const similar={...first,product_name:'Large Foldable Rattan Fruit Basket'};
    delete similar.commercial_taxonomy_review;
    const beforeVocabulary=await resolveCommercialTaxonomyVerdict(client,similar);
    if(beforeVocabulary.status!=='REVIEW_REQUIRED')
      throw Error('LEARNING_BEFORE_EDITORIAL_APPROVAL:'+JSON.stringify(beforeVocabulary));
    draftProofs.push(await transactionProof(client,'human_confirms_first_object',first,
      {shouldCreate:true,expectedCategory:'Maison',expectedSubcategory:'Cuisine'}));
    const taught=await client.query(
      "UPDATE boutique_subcategories SET object_classification_terms = "+
      "object_classification_terms || '{\"foldable rattan fruit basket\":12}'::jsonb "+
      "WHERE category_key='Maison' AND key='Cuisine' AND is_active=TRUE");
    if(taught.rowCount!==1)throw Error('REUSABLE_OBJECT_TERM_TARGET_INACTIVE');
    const learned=await resolveCommercialTaxonomyVerdict(client,similar);
    if(learned.status!=='AUTO_CLASSIFIED'||learned.category!=='Maison'
      ||learned.subcategory!=='Cuisine'||learned.source!=='OBJECT_NAME_MATCH')
      throw Error('EDITOR_APPROVED_OBJECT_NOT_REUSED:'+JSON.stringify(learned));
    draftProofs.push(await transactionProof(client,'editorial_object_reused_for_similar_sku',similar,
      {shouldCreate:true,expectedCategory:'Maison',expectedSubcategory:'Cuisine'}));
    const unrelated={...similar,product_name:'Foldable Rattan Shoe Shelf'};
    draftProofs.push(await transactionProof(client,'unrelated_object_not_taught',unrelated,
      {shouldCreate:false}));
  }finally {
    try{await client.query('ROLLBACK');rolledBack=true;}finally{client.release();}
  }
  const counterAudit=buildCounterAudit(decisions);
  assertEqual(counterAudit.data_count,498,'COUNTER_AUDIT_CORPUS_INCOMPLETE');
  const out={kind:'REAL_PG_E2E_CJ_SOURCE_TO_CATALOG_DRAFT',
    certification:'PROVEN_BOUNDARY_NOT_PRODUCT_PRECISION',
    source_count:498,previous_automatic:doc.automatic,
    candidate_automatic:auto,candidate_category:category,
    candidate_placement:auto+category,candidate_review:498-auto-category,
    prior_discovery_proposals:ignoredDiscovery,discovery_only:discoveryOnly,
    by_status:byStatus,by_evidence:byEvidence,by_pair:byPair,
    by_category:byCategory,category_evidence_samples:categorySamples,
    changed_examples:drift,review_samples:samples,product_draft_proofs:draftProofs,
    counter_audit_summary:{flagged:counterAudit.flagged_count,
      by_code:counterAudit.flag_counts,
      duplicate_groups:counterAudit.duplicates.groups,
      discordant_duplicate_groups:counterAudit.duplicates.discordant_groups},
    transaction_rolled_back:rolledBack,publication_performed:false,supplier_calls:0};
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n');
  fs.writeFileSync(path.join(path.dirname(output),'counter-audit-risks.json'),
    JSON.stringify(counterAudit,null,2)+'\n');
  const decisionOutput=path.join(path.dirname(output),'all-498-decisions.json');
  fs.writeFileSync(decisionOutput,JSON.stringify({
    kind:'REVIEWABLE_CJ_498_COMMERCIAL_CLASSIFICATION',
    note:'Proposed classifications, not an independently annotated accuracy score',
    source_sha256:EXPECTED_SHA,decisions,
  },null,2)+'\n');
  console.log('[CJ_P1_REAL_PG] '+JSON.stringify({inspected:498,automatic:auto,
    category,placement:auto+category,review:498-auto-category,
    discovery_only:discoveryOnly,prior_seen:ignoredDiscovery,
    by_evidence:byEvidence,draft_proofs:draftProofs.length,rollback:rolledBack}));
  return out;
}
if(require.main===module){
  run().catch(e=>{console.error('[CJ_P1_REAL_PG] FAILED: '+(e.stack||e));process.exitCode=1;})
    .finally(()=>db.pool.end());
}
module.exports={assertRuntime,sourceCandidate,loadCorpus,transactionProof,run};
