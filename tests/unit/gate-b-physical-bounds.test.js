'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {validateNormalizedProduct}=require('../../services/suppliers/normalized-product');
function p(overrides={}){return{schema_version:'2',supplier_name:'Torture',supplier_product_id:'physical-1',product_name:'Physical torture',currency:'USD',purchase_price:10,raw_payload:{},...overrides};}
describe('Gate B physical bounds — canonical V2 seam',()=>{
 test.each([
  ['weight above canonical maximum',{weight_kg:500.01}],
  ['length above canonical maximum',{dimensions:{l_cm:1000.01,w_cm:10,h_cm:10}}],
  ['width above canonical maximum',{dimensions:{l_cm:10,w_cm:1000.01,h_cm:10}}],
  ['height above canonical maximum',{dimensions:{l_cm:10,w_cm:10,h_cm:1000.01}}],
  ['non-positive weight',{weight_kg:0}],
  ['non-positive dimension',{dimensions:{l_cm:10,w_cm:0,h_cm:10}}],
 ])('%s is rejected before refinery acceptance',(_label,mutation)=>{
   const verdict=validateNormalizedProduct(p(mutation));
   expect(verdict.valid).toBe(false);
 });
 test('boundary values remain valid and are not silently rewritten',()=>{
   const product=p({weight_kg:500,dimensions:{l_cm:1000,w_cm:1000,h_cm:1000}});
   expect(validateNormalizedProduct(product)).toEqual({valid:true,errors:[]});
 });
});
