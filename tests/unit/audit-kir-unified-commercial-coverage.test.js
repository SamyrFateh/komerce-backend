'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({query:jest.fn(),pool:{end:jest.fn()}}));
const {audit}=require('../../scripts/audit-kir-unified-commercial-coverage');
test('unifies supplier mappings and object names; groups unresolved review',async()=>{
 const items=[1,2,3,4].map(n=>({candidate_ref:'KSC-'+n,supplier_category:n===3?'Unknown':'Accessories',category_path:[],source_locale:'en'}));
 const query={query:jest.fn().mockResolvedValue({rows:items.map(x=>({candidate_ref:x.candidate_ref,product_name:'Item '+x.candidate_ref}))})};
 const resolveVerdict=jest.fn(async(_,candidate)=>{
  const id=Number(candidate.candidate_ref.slice(-1));
  if(id===1)return {status:'AUTO_CLASSIFIED',source:'CONFIRMED_SUPPLIER_PATH',category:'Tech',subcategory:'Phones'};
  if(id===2)return {status:'AUTO_CLASSIFIED',source:'OBJECT_NAME_MATCH',category:'Auto',subcategory:'Accessoires'};
  return {status:'REVIEW_REQUIRED',source:'UNRESOLVED_COMMERCIAL_TAXONOMY',category:null,subcategory:null};
 });
 const result=await audit('KIR-000007',{query,resolveVerdict,sourceAudit:async()=>({provider:'AliExpress',items})});
 expect(result).toMatchObject({inspected:4,auto_classifiable_products:2,automatic_coverage_pct:50,
  via_supplier_mapping:1,via_object_name:1,unresolved_products:2,human_review_groups:2,
  target_met:false,writes:0,provider_calls:0});
 expect(result.review_workpack).toHaveLength(2);
 expect(query.query).toHaveBeenCalledTimes(1);
});
test('empty KIR never reports target met',async()=>{
 const result=await audit('KIR-000008',{sourceAudit:async()=>({provider:'CJdropshipping',items:[]})});
 expect(result).toMatchObject({inspected:0,automatic_coverage_pct:0,target_met:false,review_workpack:[]});
});

test('historical discovery classifications do not masquerade as automatic coverage',async()=>{
 const row={candidate_ref:'KSC-000120',product_name:'Car Phone Holder',
  raw_payload:{discovery:{target_category:'Auto',target_subcategory:'Accessoires'}},
  commercial_taxonomy_review:{status:'CONFIRMED',category:'Auto',subcategory:'Accessoires'}};
 const resolveVerdict=jest.fn(async(_,candidate)=>{
   expect(candidate.raw_payload.discovery).toBeNull();
   expect(candidate.commercial_taxonomy_review).toBeNull();
   return {status:'AUTO_CLASSIFIED',source:'OBJECT_NAME_MATCH',category:'Auto',subcategory:'Accessoires'};
 });
 const result=await audit('KIR-000007',{
  sourceAudit:async()=>({provider:'AliExpress',items:[{candidate_ref:row.candidate_ref,supplier_category:'Auto',category_path:[]}]}),
  query:{query:jest.fn().mockResolvedValue({rows:[row]})},resolveVerdict,
 });
 expect(result).toMatchObject({historically_classified_products:1,auto_classifiable_products:1,
  automatic_coverage_pct:100,explicit_review_products:0});
});
test('replayed category conflict triggers review instead of silent auto approval',async()=>{
 const result=await audit('KIR-000007',{
  sourceAudit:async()=>({provider:'AliExpress',items:[{candidate_ref:'KSC-1',supplier_category:'Electronics',category_path:[]}]}),
  query:{query:jest.fn().mockResolvedValue({rows:[{candidate_ref:'KSC-1',
    raw_payload:{discovery:{target_category:'Tech',target_subcategory:'Phones'}}}]})},
  resolveVerdict:async()=>({status:'AUTO_CLASSIFIED',source:'OBJECT_NAME_MATCH',category:'Auto',subcategory:'Accessoires'}),
 });
 expect(result).toMatchObject({auto_classifiable_products:0,conflicting_classifications:1,
  unresolved_products:1,human_review_groups:1});
});
