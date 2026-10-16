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
