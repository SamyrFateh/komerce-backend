'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({query:jest.fn(),pool:{end:jest.fn()}}));
jest.mock('../../services/catalog-candidate-product-service',()=>({resolveCommercialTaxonomyVerdict:jest.fn()}));
const {buildReport,assertIsolated}=require('../../scripts/cj-balanced-500-classification-audit');
const activePairs=[{category:'Mode & Beauté',subcategory:'Femme'},
  {category:'Mode & Beauté',subcategory:'Homme'},
  {category:'Maison',subcategory:'Rangement'}];
const make=(id,name,path,targetCategory='Mode & Beauté',targetSubcategory='Femme')=>({
  candidate_ref:'KSC-'+id,supplier_product_id:'CJ-'+id,product_name:name,
  supplier_category:path,state:'scanned',scan_result:{},
  raw_payload:{discovery:{campaign:'cj-balanced-e2e-500-v1',segment_id:'mode-femme',
    keyword:'women clothing',target_category:targetCategory,target_subcategory:targetSubcategory}}
});
const v=(category,subcategory,source='SEMANTIC_SUPPLIER_HIERARCHY')=>({
  status:'AUTO_CLASSIFIED',category,subcategory,source
});

describe('CJ 500 read-only classification audit',()=>{
  test('preserves product-level source and verdict, without treating 500 target as proof',()=>{
    const r=buildReport([
      {candidate:make('1','Women Summer Dress',"Women's Clothing > Dresses"),
        verdict:v('Mode & Beauté','Femme')},
      {candidate:make('2','Silver Ring','Jewelry > Fashion Rings'),verdict:{
        status:'REVIEW_REQUIRED',source:'UNRESOLVED_COMMERCIAL_TAXONOMY'}}
    ],{target:500,activePairs});
    expect(r).toMatchObject({inspected:2,shortfall:498,automatic:1,needs_review:1,
      certification:'NOT_ASSERTED',active_pair_count:3,publication_linked:0});
    expect(r.products).toHaveLength(2);
    expect(r.products[0]).toMatchObject({supplier_category:"Women's Clothing > Dresses",
      category:'Mode & Beauté',subcategory:'Femme',evidence:'SEMANTIC_SUPPLIER_HIERARCHY'});
  });
  test('flags a suspect storage assignment instead of counting it as semantically correct',()=>{
    const c=make('3','Insect Repellent Spray',
      'Home, Garden & Furniture > Home Storage > Home Office Storage','Maison','Rangement');
    const r=buildReport([{candidate:c,verdict:v('Maison','Rangement','CONFIRMED_SUPPLIER_PATH')}],
      {target:1,activePairs});
    expect(r.automatic).toBe(1);
    expect(r.explicit_semantic_conflicts).toBe(1);
    expect(r.products[0].review_flags).toEqual(expect.arrayContaining([
      'SEMANTIC_CONTRADICTION:SOURCE_OBJECT_CONTRADICTS_STORAGE_MAPPING',
      'INDEPENDENT_SEMANTIC_REVIEW_REQUIRED']));
    expect(r.certification).toBe('NOT_ASSERTED');
  });
  test('discovery target mismatch is review evidence, never automatic ground truth',()=>{
    const c=make('4','Blue Audio Speaker','Electronics > Audio');
    const r=buildReport([{candidate:c,verdict:v('Tech','Audio','OBJECT_NAME_MATCH')}],
      {target:1,activePairs:[...activePairs,{category:'Tech',subcategory:'Audio'}]});
    expect(r.metadata_mismatches).toBe(1);
    expect(r.products[0].review_flags).toContain('DISCOVERY_TARGET_MISMATCH_REVIEW_ONLY');
  });
  test('rejects duplicate provider identity and inactive chosen pair',()=>{
    const a=make('5','Women Shirt',"Women's Clothing > Tops");
    const b={...make('6','Women Blouse',"Women's Clothing > Blouses"),supplier_product_id:'CJ-5'};
    const r=buildReport([
      {candidate:a,verdict:v('Mode & Beauté','Femme')},
      {candidate:b,verdict:v('Mode & Beauté','Femme')}],{target:2,activePairs:[]});
    expect(r.products[1].review_flags).toEqual(expect.arrayContaining([
      'MISSING_OR_DUPLICATE_SUPPLIER_ID','DESTINATION_NOT_ACTIVE']));
  });
  test('guards the audit against staging/production databases',()=>{
    expect(()=>assertIsolated({DATABASE_URL:'postgresql://private.railway.internal/db',
      GITHUB_ACTIONS:'true',NODE_ENV:'test',KOMERCE_ENV:'staging',
      KOMERCE_DISABLE_CRONS:'true'})).toThrow('ISOLATED_CLASSIFICATION_AUDIT_ONLY');
  });
});