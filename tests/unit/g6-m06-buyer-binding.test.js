/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {buyerParams,basketLines}=require('../../scripts/recette/canonical/scenario-profile');

describe('G6 M06 fresh buyer binding',()=>{
 test('requires the canonical central Hub product and resolved current price',()=>{
  expect(()=>buyerParams({G6_CANONICAL_SCENARIO:'M06',G6_TARGET_MARKET:'KM'}))
   .toThrow('G6_M06_CENTRAL_HUB_PRODUCT_NOT_BOUND');
  expect(()=>buyerParams({G6_CANONICAL_SCENARIO:'M06',G6_TARGET_MARKET:'KM',
   G6_BUYER_PRODUCT_REF:'KPR-000321',G6_BUYER_EXPECTED_PRICE:'1500'}))
   .toThrow('G6_M06_CENTRAL_HUB_PRODUCT_NOT_BOUND');
 });

 test('binds one on-demand Hub line at quantity three without synthetic supplier values',()=>{
  const p=buyerParams({G6_CANONICAL_SCENARIO:'M06',G6_TARGET_MARKET:'KM',
   G6_BUYER_PRODUCT_REF:'KPR-000255',G6_BUYER_EXPECTED_PRICE:'1500'});
  expect(p).toMatchObject({scenario:'M06',product_ref:'KPR-000255',unit_price:1500,
   expected_price:4500,quantity:3,fulfillment:'IMPORT',centralHubManual:true});
  expect(basketLines(p)).toEqual([{product_ref:'KPR-000255',price:1500,fulfillment:'IMPORT',
   quantity:3,source_key:'central_hub'}]);
 });
});
