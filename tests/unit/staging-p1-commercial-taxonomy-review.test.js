/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';
const {inputs,summarize}=require('../../scripts/recette/p1-20-commercial-taxonomy-review');
const ORIGIN='https://komerce-backend-production.up.railway.app';
test('taxonomy audit only runs for pinned staging target',()=>{
  expect(inputs({KOMERCE_ENV:'staging',NODE_ENV:'test',STAGING_BASE_URL:ORIGIN})).toBe('KIR-000009');
  expect(()=>inputs({KOMERCE_ENV:'production',NODE_ENV:'production',STAGING_BASE_URL:ORIGIN})).toThrow('STAGING_ONLY');
  expect(()=>inputs({KOMERCE_ENV:'staging',NODE_ENV:'test',STAGING_BASE_URL:'https://komerce.co'})).toThrow('STAGING_ONLY');
});
test('all eligible candidates without active category and subcategory remain blocked',()=>{
  const list=[
    {sourcing_certified:true,catalog_linked:false,commercial_taxonomy_active:false,taxonomy:{status:'REVIEW_REQUIRED'}},
    {sourcing_certified:true,catalog_linked:false,commercial_taxonomy_active:false,taxonomy:{status:'EXPLICIT_REVIEW'}},
    {sourcing_certified:true,catalog_linked:true,commercial_taxonomy_active:false,taxonomy:{status:'REVIEW_REQUIRED'}},
    {sourcing_certified:false,catalog_linked:false,commercial_taxonomy_active:true,taxonomy:{status:'AUTO_CLASSIFIED'}},
  ];
  expect(summarize(list)).toEqual({
    inspected:4,sourced_certified:3,
    promotable_source_candidates:2,
    promotable_with_active_commercial_taxonomy:0,
    promotable_blocked_taxonomy:2,
    needs_review:2,no_business_writes:true
  });
});
test('a confirmed active commercial classification changes readiness, never source certification',()=>{
  const list=[{sourcing_certified:true,catalog_linked:false,
    commercial_taxonomy_active:true,taxonomy:{status:'AUTO_CLASSIFIED'}}];
  expect(summarize(list).promotable_with_active_commercial_taxonomy).toBe(1);
  expect(summarize(list).sourced_certified).toBe(1);
});
