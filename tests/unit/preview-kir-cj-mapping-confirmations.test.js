'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({query:jest.fn(),pool:{end:jest.fn()}}));
const {buildPlan}=require('../../scripts/preview-kir-cj-mapping-confirmations');
test('12 safe CJ groups are presented, broad sports group remains excluded',()=>{
 const groups=Array.from({length:12},(_,i)=>({source_path:'Path '+i,count:i===0?3:1,
   product_refs:['KSC-'+i],proposal:{category:'Maison',subcategory:'Rangement'},reason:'SOURCE_PATH_PHRASE'}));
 groups.push({source_path:'Sports > Accessories',count:1,product_refs:['KSC-143'],
  proposal:{category:'Sport',subcategory:'Fitness'},reason:'BROAD_CATEGORY_CONFIRM'});
 const plan=buildPlan({provider:'CJdropshipping',run_ref:'KIR-000008',inspected:16,all_groups:groups});
 expect(plan).toMatchObject({eligible_groups:12,manual_groups:1,manual_products:1,
   confirmation_state:'NOT_APPROVED',write_enabled:false,writes:0,provider_calls:0});
 expect(plan.fingerprint).toMatch(/^[a-f0-9]{64}$/);
 expect(plan.manual_review[0].decision).toBe('MANUAL_REVIEW_ONLY');
});
test('refuses non CJ and ambiguous canonical duplicates',()=>{
 const g={source_path:'A / B',count:1,product_refs:['X'],proposal:{category:'Maison',subcategory:'Rangement'},
  reason:'SOURCE_PATH_PHRASE'};
 expect(()=>buildPlan({provider:'AliExpress',run_ref:'KIR-000008',all_groups:[g]})).toThrow('CJ_PROVIDER_REQUIRED');
 expect(()=>buildPlan({provider:'CJdropshipping',run_ref:'KIR-000008',all_groups:[g,{...g,source_path:'A > B'}]}))
   .toThrow('DUPLICATE_CANONICAL_SOURCE_PATH');
});
