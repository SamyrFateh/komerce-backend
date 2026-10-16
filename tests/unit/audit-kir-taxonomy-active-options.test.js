'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
jest.mock('../../db',()=>({query:jest.fn(),pool:{end:jest.fn()}}));
const {audit,suggest}=require('../../scripts/audit-kir-taxonomy-active-options');
test('uses active existing French boutique pair when labels match',()=>{
 const result=suggest({source_path:'Automobiles, Parts & Accessories > Interior Accessories'},
  [{key:'Auto',label:'Auto',is_active:true}],
  [{category_key:'Auto',key:'Intérieur',label:'Accessoires intérieurs',is_active:true}]);
 expect(result).toMatchObject({status:'EXISTING_ACTIVE',category_key:'Auto',subcategory_key:'Intérieur'});
});
test('proposes missing subcategory without inventing database key',()=>{
 const result=suggest({source_path:'Automobiles, Parts & Accessories > Interior Accessories'},
  [{key:'Auto',label:'Auto',is_active:true}],[]);
 expect(result).toMatchObject({status:'SUBCATEGORY_PROPOSED',category_key:'Auto',subcategory_key:null});
});
test('read-only preview groups KIR once and never mutates',async()=>{
 const q={query:jest.fn()
 .mockResolvedValueOnce({rows:[{key:'Auto',label:'Auto',is_active:true}]})
 .mockResolvedValueOnce({rows:[]})};
 const result=await audit('KIR-000007',{coverageAudit:async()=>({
  categories:[{source_path:'Automobiles, Parts & Accessories > Interior Accessories',count:5,mapping:null}]
 }),query:q});
 expect(result).toMatchObject({writes:0,provider_calls:0,source_category_groups:1});
 expect(result.categories[0].suggestion.status).toBe('SUBCATEGORY_PROPOSED');
 expect(q.query).toHaveBeenCalledTimes(2);
});
