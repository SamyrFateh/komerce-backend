/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {decide,ALLOWED,MIN_RUNTIME_SHA}=require('../../scripts/recette/economic-result-readonly-pin');
const STAGE='a'.repeat(40),HEAD='b'.repeat(40);
const valid=(overrides={})=>({staging:STAGE,head:HEAD,isAncestor:true,
  hasRequiredFix:true,manifestOnlyTests:true,
  changed:['scripts/recette/economic-result-real-readonly.js','features/economic-engine.feature.js'],
  ...overrides});
test('allow only an explicit test-script and metadata-only diff after the merged #5131 SHA',()=>{
  expect(MIN_RUNTIME_SHA).toMatch(/^[a-f0-9]{40}$/i);
  expect(ALLOWED.has('scripts/recette/economic-result-readonly-pin.js')).toBe(true);
  expect(ALLOWED.has('scripts/recette/g6-m06-receiving-chromium.js')).toBe(true);
  expect(ALLOWED.has('scripts/recette/canonical/m06-receipt-plan.js')).toBe(true);
  expect(ALLOWED.has('tests/unit/g6-m06-receipt-plan.test.js')).toBe(true);
  expect(decide(valid())).toMatchObject({allowed:true,reason:'ONLY_EXPLICIT_TEST_AND_METADATA_DELTA'});
});
test('refuse deployable runtime, older staging, unknown feature edits or nonancestor',()=>{
  expect(decide(valid({changed:['services/pricing-market-decision-projection.js']}))).toMatchObject({allowed:false,reason:'DEPLOYED_SOURCE_DIFFERS'});
  expect(decide(valid({changed:['routes/admin-pricing-workspace.js']})).allowed).toBe(false);
  expect(decide(valid({hasRequiredFix:false})).allowed).toBe(false);
  expect(decide(valid({manifestOnlyTests:false})).allowed).toBe(false);
  expect(decide(valid({isAncestor:false})).allowed).toBe(false);
  expect(decide(valid({staging:'bad'})).allowed).toBe(false);
});
test('when staging and head are identical, require the merged economic fix',()=>{
  expect(decide(valid({head:STAGE,changed:[]})).reason).toBe('EXACT_DEPLOYMENT');
  expect(decide(valid({head:STAGE,hasRequiredFix:false})).allowed).toBe(false);
});
