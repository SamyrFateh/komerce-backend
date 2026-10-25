/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const { REFS, classify } = require('../../scripts/recette/staging-sql-demo-cleanup-preview');
const row = { product_ref: 'KPR-000084' };
const use = (table,n,relation='FOREIGN_KEY')=>({
  table,relation,by_ref:{'KPR-000084':n},count:n
});
test('cleanup preview targets exactly 8 stated demo references',()=>{
  expect(REFS).toEqual(['KPR-000084','KPR-000085','KPR-000086','KPR-000087',
    'KPR-000088','KPR-000089','KPR-000090','KPR-000091']);
});
test('business histories are never automatically eligible for delete',()=>{
  expect(classify(row,[use('order_items',2)]).decision).toBe('HOLD_BUSINESS_DEPENDENCIES');
  expect(classify(row,[use('purchase_lines',1)]).decision).toBe('HOLD_BUSINESS_DEPENDENCIES');
});
test('sourcing provenance must be separately reviewed and preserved',()=>{
  expect(classify(row,[use('sourcing_candidates',1)]).decision).toBe('HOLD_SOURCE_LINKED_REVIEW_REQUIRED');
});
test('catalogue descendants require a dependency plan; root alone requires human review',()=>{
  expect(classify(row,[use('product_skus',6)]).decision).toBe('HOLD_DEPENDENCY_PLAN_REQUIRED');
  expect(classify(row,[]).decision).toBe('ROOT_ONLY_CANDIDATE_NOT_APPROVED');
});
test('zero-count rows cannot create fictitious dependencies',()=>{
  expect(classify(row,[use('order_items',0)]).external_business_links).toEqual([]);
});
