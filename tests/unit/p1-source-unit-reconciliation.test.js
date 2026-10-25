/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {reconcileRun,chooseCandidate}=require('../../scripts/recette/p1-source-unit-reconciliation');
const {normalizeRunRef}=require('../../scripts/aliexpress-promote-run-staging');
test('refuses to select from a run whose snapshot differs from actual canonical count',()=>{
 const make=(expected,computed)=>({
   run_ref:'KIR-000009',source_type:'api',pipeline_status:'CANONICAL_RESOLVED',
   accounting_consistent:expected===computed,
   summary:{blocked:0},details:[{candidate_id:'c',supplier_product_id:'s',unlinked_unique:true}],
   import_id:'i'
 });
 expect(chooseCandidate([make(12,13)])).toBeNull();
 expect(chooseCandidate([make(13,13)])).toMatchObject({candidate_id:'c'});
});
test('requires a supplier run reference and does not infer a price or approval',()=>{
 expect(normalizeRunRef('KIR-000009')).toBe('KIR-000009');
 expect(()=>normalizeRunRef('KPR-000093')).toThrow();
});
