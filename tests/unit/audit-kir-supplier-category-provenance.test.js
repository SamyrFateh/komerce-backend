'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({query:jest.fn(),pool:{end:jest.fn()}}));
const {audit,sourceCategory}=require('../../scripts/audit-kir-supplier-category-provenance');
test('AliExpress preserves source category hierarchy and ID independently from boutique and customs',()=>{
  expect(sourceCategory({provider:'AliExpress',supplier_category:'Automobiles',
    raw_payload:{source_locale:'en',aliexpress:{feed:{
      first_level_category_name:'Automobiles',second_level_category_name:'Interior Accessories'
    },detail:{category_id:1234}}}})).toMatchObject({
      category_id:'1234',category_path:['Automobiles','Interior Accessories'],source_locale:'en',
    missing_category_metadata:false,
  });
});
test('CJ preserves three level category path and does not invent absent IDs',()=>{
  expect(sourceCategory({provider:'CJ',raw_payload:{source_locale:'en',cj:{
    oneCategoryName:'Car',twoCategoryName:'Interior',threeCategoryName:'Pillows'
  }}})).toMatchObject({
    category_id:null,category_path:['Car','Interior','Pillows'],
    missing_category_metadata:false,
  });
});
test('historical KIR category audit is read only and reports missing metadata',async()=>{
  const q={query:jest.fn()
    .mockResolvedValueOnce({rows:[{id:'run-1',run_ref:'KIR-000007',provider:'AliExpress',source_total:20}]})
    .mockResolvedValueOnce({rows:[{candidate_ref:'KSC-000128',supplier_product_id:'1005010574838342',
      supplier_category:null,raw_payload:{aliexpress:{feed:{}}}}]})};
  const result=await audit('KIR-000007',q);
  expect(result).toMatchObject({inspected:1,with_category_path:0,missing_category_metadata:1,writes:0,provider_calls:0});
  expect(q.query).toHaveBeenCalledTimes(2);
  expect(q.query.mock.calls.every(([sql])=>sql.trim().startsWith('SELECT')||sql.trim().startsWith('WITH'))).toBe(true);
});
