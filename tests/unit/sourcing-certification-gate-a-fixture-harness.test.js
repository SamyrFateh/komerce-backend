'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const {runGateAFixtureHarness}=require('../../services/sourcing-certification-gate-a-fixture-harness');
const persistedStyle=[
 {supplier_name:'CJdropshipping',supplier_product_id:'cj-001',raw_payload:{source:'persisted'},normalized_source_contract:{schema_version:'2'}},
 {supplier_name:'CJdropshipping',supplier_product_id:'cj-002',raw_payload:{source:'persisted'},normalized_source_contract:{schema_version:'2'}},
 {supplier_name:'AliExpress',supplier_product_id:'ali-001',raw_payload:{source:'persisted'},normalized_source_contract:{schema_version:'2'}},
];
describe('Gate A deterministic fixture harness',()=>{
 test('plays all 18 scenarios without supplier network and certifies the complete inventory',()=>{
  const out=runGateAFixtureHarness(persistedStyle);
  expect(out.certification).toMatchObject({gate:'SOURCING_CERTIFIED',pass:true,required:18,observed:18,missing:[],failed:[]});
  expect(out.scenarios.every(x=>x.network_used===false&&x.paid_ai_used===false)).toBe(true);
 });
 test('requires stable persisted-style supplier identities',()=>{expect(()=>runGateAFixtureHarness(persistedStyle.slice(0,2))).toThrow(/at least 3/);});
});
