/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {canonicalScenario,resolveCanonicalReplay,resolveRelayCashRefs}=require('../../scripts/recette/g6-canonical-journey-binding');
const {SCENARIO_STAGE_IDS}=require('../../scripts/recette/canonical/stage-registry');

describe('G6 executable sub-branches must retain their actual stage ID through Relais cash',()=>{
 const cases=['N26b','N39F1','N39F2','N39F3'];
 test.each(cases)('%s binds cash to its exact runnable stage, with one real business parent',id=>{
  const parent=id.startsWith('N26')?'N26':'N39';
  for(const market of ['KM','CM','CG']){
   expect(canonicalScenario(parent,market).id).toBe(parent);
   expect(SCENARIO_STAGE_IDS[id]).toContain('RELAY_CASH');
   const actual=resolveCanonicalReplay({G6_CANONICAL_SCENARIO:id,G6_TARGET_MARKET:market});
   expect(actual).toMatchObject({id,market});
   expect(resolveRelayCashRefs({
    G6_CANONICAL_SCENARIO:id,G6_CANONICAL_MARKET:market,
    G6_CANONICAL_ORDER_REFERENCE:'K26TEST1'
   })).toEqual({[market]:'K26TEST1'});
  }
 });
 test('N26a is PSP-only and must not be aliased to the cash replay',()=>{
  expect(SCENARIO_STAGE_IDS.N26a).toEqual(['BUYER','N26A_LINE_REFUND_PSP_DECISION']);
  expect(SCENARIO_STAGE_IDS.N26a).not.toContain('RELAY_CASH');
  for(const market of ['KM','CM','CG']){
   expect(canonicalScenario('N26',market).id).toBe('N26');
   expect(()=>resolveCanonicalReplay({G6_CANONICAL_SCENARIO:'N26a',G6_TARGET_MARKET:market}))
    .toThrow('G6_EXISTING_BUYER_CASH_ADAPTER_NOT_BOUND_FOR_SCENARIO_N26a');
  }
 });
 test('N26b case normalization preserves the b branch, not an invalid N26B',()=>{
  expect(resolveCanonicalReplay({G6_CANONICAL_SCENARIO:'n26B',G6_TARGET_MARKET:'km'}))
   .toMatchObject({id:'N26b',market:'KM'});
 });
 test('reject unknown branches, missing market, unsupported or badly formed identity',()=>{
  expect(()=>resolveCanonicalReplay({G6_CANONICAL_SCENARIO:'N26c',G6_TARGET_MARKET:'KM'}))
   .toThrow('G6_SCENARIO_ID_INVALID');
  expect(()=>resolveCanonicalReplay({G6_CANONICAL_SCENARIO:'N39F4',G6_TARGET_MARKET:'KM'}))
   .toThrow('G6_SCENARIO_ID_INVALID');
  expect(()=>resolveCanonicalReplay({G6_CANONICAL_SCENARIO:'N26b',G6_TARGET_MARKET:'ZZ'}))
   .toThrow('G6_MARKET_OUTSIDE_SCENARIO');
  expect(()=>resolveRelayCashRefs({G6_CANONICAL_SCENARIO:'N26b',G6_CANONICAL_MARKET:'KM'}))
   .toThrow('G6_CANONICAL_CASH_BINDING_INCOMPLETE');
 });
 test('M01/M02/M03 and explicit M04/M05 dispatch remain unchanged',()=>{
  for(const [id,market] of [['M01','KM'],['M02','KM'],['M02','CM'],['M03','KM'],['M04','CM'],['M05','CG']])
   expect(resolveCanonicalReplay({G6_CANONICAL_SCENARIO:id,G6_TARGET_MARKET:market}).id).toBe(id);
 });
});
