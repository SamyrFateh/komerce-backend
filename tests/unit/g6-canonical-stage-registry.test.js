/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {STAGE_IDS,loadGoldenStages,stageGraph,resolvePhase,prerequisiteIds,requiresResumeProof,validateProofBoundary,planGolden}
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
 test('checkpoint requirements derive from DAG, preserving buyer cash legacy entry',()=>{
  const graph=stageGraph(loadGoldenStages());
  expect(requiresResumeProof('BUYER',graph)).toBe(false);
  expect(requiresResumeProof('BUYER_CASH',graph)).toBe(true);
  expect(requiresResumeProof('HUB_PO',graph)).toBe(true);
  expect(requiresResumeProof('CLIENT_PICKUP',graph)).toBe(true);
  expect(()=>requiresResumeProof('UNKNOWN',graph)).toThrow(/NOT_REGISTERED/);
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
 test.each([
  'HUB_COMMITMENT','HUB_VENDOR_READINESS','HUB_VENDOR_SIMULATION',
  'HUB_RECEIVING','HUB_RECEIVING_READBACK','HUB_CUSTOMER_BAG','HUB_KOM_BOX'
 ])('%s requires actual executor and independent oracle',async id=>{
  const stage=resolvePhase(id);
  const proof={stage_id:id,reference:'TEST-ORDER',external_supplier_calls:0};
  const execution=jest.fn(stageId=>{expect(stageId).toBe(id);return proof;});
  expect(await stage.run({runCertifiedStage:execution})).toBe(proof);
  expect(execution).toHaveBeenCalledTimes(1);
  const oracle=jest.fn((stageId,provided)=>{
   expect(stageId).toBe(id);expect(provided).toBe(proof);
   return {reference:provided.reference};
  });
  expect(stage.validate({validateCertifiedStage:oracle},proof)).toEqual({reference:'TEST-ORDER'});
  expect(oracle).toHaveBeenCalledTimes(1);
  await expect(stage.run({runCertifiedStage:()=>{throw Error('UI_BLOCKED');}})).rejects.toThrow('UI_BLOCKED');
  expect(()=>stage.validate({},proof)).toThrow('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 });
 test.each(['HUB_SHIPMENT','FORWARDER','CUSTOMS','RELAY_RECEIPT','CLIENT_PICKUP'])
 ('%s logistics and pickup contracts reject missing execution and validation',async id=>{
  const stage=resolvePhase(id);
  const proof={reference:'FRESH-STAGING-TEST',shipment_id:'fixture-id'};
  const executor=jest.fn(actual=>{expect(actual).toBe(id);return proof;});
  expect(await stage.run({runCertifiedStage:executor})).toBe(proof);
  expect(executor).toHaveBeenCalledTimes(1);
  const oracle=jest.fn((actual,provided)=>{expect(actual).toBe(id);return provided.reference;});
  expect(stage.validate({validateCertifiedStage:oracle},proof)).toBe('FRESH-STAGING-TEST');
  expect(oracle).toHaveBeenCalledTimes(1);
  await expect(stage.run({runCertifiedStage:()=>{throw Error('CHROMIUM_FAIL_CLOSED');}}))
   .rejects.toThrow('CHROMIUM_FAIL_CLOSED');
  expect(()=>stage.validate({},proof)).toThrow('G6_STAGE_VALIDATOR_NOT_BOUND_'+id);
 });
 test('historical phase aliases and all registered stage IDs remain unambiguous',()=>{
  const graph=stageGraph(loadGoldenStages());
  expect(graph.order).toHaveLength(15);
  expect(new Set(graph.order).size).toBe(15);
  expect(resolvePhase('BUYER_CASH',graph).id).toBe('RELAY_CASH');
  expect(graph.order.slice(3)).toEqual([
   'HUB_COMMITMENT','HUB_VENDOR_READINESS','HUB_VENDOR_SIMULATION',
   'HUB_RECEIVING','HUB_RECEIVING_READBACK','HUB_CUSTOMER_BAG',
   'HUB_KOM_BOX','HUB_SHIPMENT','FORWARDER','CUSTOMS','RELAY_RECEIPT','CLIENT_PICKUP'
  ]);
  expect(()=>resolvePhase('UNKNOWN_STAGE',graph)).toThrow(/NOT_REGISTERED/);
 });
 test('dry run is a graph plan, not a new shipment or a certified execution',()=>{
  const plan=planGolden({fromStage:'RELAY_RECEIPT',toStage:'CLIENT_PICKUP'});
  expect(plan).toMatchObject({contract:'G6-CANONICAL-JOURNEY-v1',mode:'dry-run',
   stages:['RELAY_RECEIPT','CLIENT_PICKUP'],mutations:0,verdict:'NOT_PROVEN'});
  expect(plan.missing_prerequisites).toContain('CUSTOMS');
  expect(()=>planGolden({fromStage:'CLIENT_PICKUP',toStage:'BUYER'})).toThrow(/RANGE_INVALID/);
 });
});
