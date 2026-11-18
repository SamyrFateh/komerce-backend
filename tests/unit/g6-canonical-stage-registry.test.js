/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {STAGE_IDS,loadGoldenStages,stageGraph,resolvePhase,prerequisiteIds,validateProofBoundary,planGolden}
 =require('../../scripts/recette/canonical/stage-registry');
const step=(id,requires=[])=>({id,requires,produces:[id.toLowerCase()+'_proof'],roles:['client'],
 run:async()=>null,validate:()=>true});
describe('G6 Golden declarative stage registry (non-mutating)',()=>{
 test('one contract module per Golden stage, preserving full M01 chain',()=>{
  const modules=loadGoldenStages(),g=stageGraph(modules);
  expect(modules).toHaveLength(15);
  expect(g.order).toEqual(STAGE_IDS);
  expect(resolvePhase('BUYER_CASH',g).id).toBe('RELAY_CASH');
  expect(resolvePhase('CLIENT_PICKUP',g).roles).toEqual(['client','agent_relais']);
  expect(prerequisiteIds('CLIENT_PICKUP',g)).toContain('RELAY_RECEIPT');
 });
 test('reject missing, cyclic or duplicate dependency without side effects',()=>{
  expect(()=>stageGraph([step('A',['MISSING'])])).toThrow(/G6_STAGE_DEPENDENCY_MISSING/);
  expect(()=>stageGraph([step('A',['B']),step('B',['A'])])).toThrow(/G6_STAGE_DEPENDENCY_CYCLE/);
  expect(()=>stageGraph([step('A'),step('A')])).toThrow(/G6_STAGE_DUPLICATE_A/);
  expect(()=>stageGraph([step('A',['B','B']),step('B')])).toThrow(/G6_STAGE_DUPLICATE_DEPENDENCY/);
 });
 test('reject missing executors and incomplete proof, never infer a PASS',async()=>{
  const s=resolvePhase('CLIENT_PICKUP');
  await expect(s.run({})).rejects.toThrow(/G6_STAGE_EXECUTOR_NOT_BOUND/);
  expect(()=>s.validate({},{})).toThrow(/G6_STAGE_VALIDATOR_NOT_BOUND/);
  expect(()=>validateProofBoundary(s,{})).toThrow(/G6_STAGE_PROOF_INVALID/);
  expect(validateProofBoundary(s,{pickup_scan:{count:1}})).toBe(true);
 });
 test('dry run is a graph plan, not a new shipment or a certified execution',()=>{
  const plan=planGolden({fromStage:'RELAY_RECEIPT',toStage:'CLIENT_PICKUP'});
  expect(plan).toMatchObject({contract:'G6-CANONICAL-JOURNEY-v1',mode:'dry-run',
   stages:['RELAY_RECEIPT','CLIENT_PICKUP'],mutations:0,verdict:'NOT_PROVEN'});
  expect(plan.missing_prerequisites).toContain('CUSTOMS');
  expect(()=>planGolden({fromStage:'CLIENT_PICKUP',toStage:'BUYER'})).toThrow(/RANGE_INVALID/);
 });
});
