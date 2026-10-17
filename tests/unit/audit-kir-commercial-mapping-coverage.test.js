'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({query:jest.fn(),pool:{end:jest.fn()}}));
const {audit}=require('../../scripts/audit-kir-commercial-mapping-coverage');
test('groups repeated supplier category paths once and counts reusable confirmed coverage',async()=>{
 const result=await audit('KIR-000007',{
  sourceAudit:async()=>({provider:'AliExpress',inspected:3,items:[
   {candidate_ref:'KSC-000128',category_path:['Auto','Interior'],supplier_category:'Auto > Interior',source_locale:'en'},
   {candidate_ref:'KSC-000138',category_path:['Auto','Interior'],supplier_category:'Auto > Interior',source_locale:'en'},
   {candidate_ref:'KSC-000121',category_path:['Phones','Covers'],supplier_category:'Phones > Covers',source_locale:'en'},
  ]}),
  findConfirmed:async(p,path)=>path==='Auto > Interior'?{category:'Auto',subcategory:'Accessoires'}:null,
 });
 expect(result).toMatchObject({source_category_groups:2,auto_classifiable_products:2,mapping_needed_groups:1,
  ungrouped_products:0,writes:0,provider_calls:0});
 expect(result.categories[0]).toMatchObject({count:2,status:'AUTO_CLASSIFIABLE'});
 expect(result.categories[1]).toMatchObject({count:1,status:'MAPPING_NEEDED'});
});

test('bounded grouped review prioritizes largest unknown paths without hiding backlog',async()=>{
 const items=Array.from({length:12},(_,i)=>({candidate_ref:'KSC-'+i,category_path:['Unknown'+i],supplier_category:'Unknown'+i,source_locale:'en'}));
 items.push({candidate_ref:'KSC-extra',category_path:['Unknown0'],supplier_category:'Unknown0',source_locale:'en'});
 const result=await audit('KIR-CJ',{
  sourceAudit:async()=>({provider:'CJdropshipping',inspected:items.length,items}),
  findConfirmed:async()=>null,
 });
 expect(result).toMatchObject({auto_classifiable_products:0,automatic_target_met:false,
  mapping_needed_groups:12,human_review_workpack_limit:10,deferred_review_groups:2,
  unresolved_product_count:13});
 expect(result.human_review_workpack).toHaveLength(10);
 expect(result.human_review_workpack[0]).toMatchObject({source_path:'Unknown0',affected_products:2,
  decision_required:'CONFIRM_ACTIVE_BOUTIQUE_PAIR'});
 expect(result.categories).toHaveLength(12);
});
test('confirmed supplier paths can reach auto target with no individual review',async()=>{
 const items=Array.from({length:20},(_,i)=>({candidate_ref:'KSC-'+i,
  category_path:['Phones','Covers'],supplier_category:'Phones > Covers',source_locale:'en'}));
 const result=await audit('KIR-AE',{
  sourceAudit:async()=>({provider:'AliExpress',inspected:items.length,items}),
  findConfirmed:async()=>({category:'Tech',subcategory:'Phones'}),
 });
 expect(result).toMatchObject({automatic_mapping_coverage_pct:100,automatic_target_met:true,
  mapping_needed_groups:0,human_review_workpack:[],unresolved_product_count:0});
});
