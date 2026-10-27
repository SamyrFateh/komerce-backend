'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({query:jest.fn(),pool:{end:jest.fn()}}));
jest.mock('../../services/catalog-candidate-product-service',()=>({resolveCommercialTaxonomyVerdict:jest.fn()}));
const {stripUnconfirmedDiscoveryTarget,buildReport}=require('../../scripts/cj-balanced-500-classification-audit');
const {replay}=require('../../scripts/replay-cj-frozen-semantic-classification');
const make=(id,name,path,status='EXPLICIT_REVIEW')=>({
  candidate_ref:'KSC-'+id,supplier_product_id:'CJ-'+id,product_name:name,
  supplier_category:path,status,segment_id:'mode-enfant',
  discovery_target:'Mode & Beauté/Enfant'
});
describe('independent classification vs search provenance',()=>{
 test('removes ONLY unverified discovery destination without altering the original',()=>{
   const orig={product_name:'Kids Cotton Onesie',supplier_category:'Baby Clothing > Baby Rompers',
     raw_payload:{discovery:{target_category:'Mode & Beauté',target_subcategory:'Enfant',
       keyword:'kids clothing',segment_id:'mode-enfant'},source:'real'}};
   const independent=stripUnconfirmedDiscoveryTarget(orig);
   expect(independent.raw_payload.discovery).toEqual({keyword:'kids clothing',segment_id:'mode-enfant'});
   expect(orig.raw_payload.discovery.target_category).toBe('Mode & Beauté');
   expect(independent.supplier_category).toBe(orig.supplier_category);
   expect(independent.raw_payload.source).toBe('real');
 });
 test('reports operational discovery as UNVERIFIED rather than independent AUTO',()=>{
   const candidate={candidate_ref:'KSC-1',supplier_product_id:'CJ-1',product_name:'Lip Gloss',
     supplier_category:'Health > Makeup',raw_payload:{discovery:{
       segment_id:'auto-eclairage',target_category:'Auto',target_subcategory:'Éclairage'}}};
   const r=buildReport([{candidate,operationalVerdict:{
     status:'EXPLICIT_REVIEW',category:'Auto',subcategory:'Éclairage',
     source:'OPERATOR_OR_DISCOVERY'},
     verdict:{status:'REVIEW_REQUIRED',source:'UNRESOLVED_COMMERCIAL_TAXONOMY'}}],
     {target:1,activePairs:[{category:'Auto',subcategory:'Éclairage'}]});
   expect(r.automatic).toBe(0);
   expect(r.proposal_masking_independent).toBe(1);
   expect(r.products[0].operational_category).toBe('Auto');
   expect(r.products[0].category).toBeNull();
   expect(r.products[0].review_flags).toContain('PRODUCTION_DISCOVERY_PROPOSAL_UNVERIFIED');
 });
 test('replay pure semantics resolves children while rejecting unrelated goods',()=>{
   const report=replay({products:[
     make('1','Women Summer Dress',"Women's Clothing > Lady Dresses",'AUTO_CLASSIFIED'),
     make('2','Girls Floral Dress','Toys, Kids & Babies > Girls Clothing > Girl Dresses'),
     make('3','Silver Ring','Jewelry & Watches > Fashion Jewelry > Rings'),
     make('4','Mens Jacket','Toys, Kids & Babies > Girls Clothing > Girl Dresses')
   ]});
   expect(report).toMatchObject({source_count:4,previous_auto:1,
     semantic_auto:2,newly_semantic:1,conflicts:1,regressions:0,certification:'NOT_CERTIFIED'});
   expect(report.changes[0].semantic_destination).toBe('Mode & Beauté/Enfant');
 });
});