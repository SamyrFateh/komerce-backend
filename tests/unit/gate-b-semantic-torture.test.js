'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {validateNormalizedProduct}=require('../../services/suppliers/normalized-product');
const {classifySupplierProduct}=require('../../services/customs-dynamic-category-classifier');
function p(overrides={}){return{schema_version:'2',supplier_name:'GateB',supplier_product_id:'g-b',product_name:'Gate B product',currency:'USD',raw_payload:{},...overrides};}
describe('Gate B semantic torture — production seams',()=>{
 test('malformed media URL is rejected by canonical V2',()=>expect(validateNormalizedProduct(p({media:[{url:'not-a-url',role:'PRODUCT'}]})).valid).toBe(false));
 test('contradictory variant attribute is rejected instead of guessed',()=>{
  const v=p({option_axes:[{key:'Color',values:['Black']}],sellable_units:[{supplier_sku:'sku-1',option_values:{Color:'Red'}}]});
  const verdict=validateNormalizedProduct(v); expect(verdict.valid).toBe(false); expect(verdict.errors.some(e=>e.includes('valeur inconnue'))).toBe(true);
 });
 test('duplicate supplier SKU is rejected',()=>{
  const v=p({sellable_units:[{supplier_sku:'dup',option_values:{}},{supplier_sku:'dup',option_values:{}}]});
  const verdict=validateNormalizedProduct(v); expect(verdict.valid).toBe(false); expect(verdict.errors.some(e=>e.includes('supplier_sku dupliqué'))).toBe(true);
 });
 test('ambiguous category fails to an unresolved/default result',()=>{
  const cats=[
   {key:'a',label:'A',classification_terms:{widget:1},is_active:true,display_order:1},
   {key:'b',label:'B',classification_terms:{widget:1},is_active:true,display_order:2},
  ];
  expect(classifySupplierProduct({product_name:'widget'},cats)).toEqual(expect.objectContaining({key:null,source:'default',confidence:'low',reason:'ambiguous_category_match'}));
 });
 test('taxonomy change cannot resolve into an inactive formerly matching category',()=>{
  const cats=[{key:'old',label:'Old',classification_terms:{widget:10},is_active:false}];
  expect(classifySupplierProduct({product_name:'widget'},cats)).toEqual(expect.objectContaining({key:null,source:'default',confidence:'low'}));
 });
});
