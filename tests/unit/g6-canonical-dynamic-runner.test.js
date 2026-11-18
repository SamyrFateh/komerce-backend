/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {createHash}=require('node:crypto');
const {executeBoundJourney}=require('../../scripts/recette/canonical/dynamic-runner');
const {prerequisiteIds}=require('../../scripts/recette/canonical/stage-registry');
const context={scenario_id:'M01',market:'KM',
 order_id:'550e8400-e29b-41d4-a716-446655440000',
 order_reference:'KNEW1234',db_fingerprint:'new-staging-db',
 staging_sha:'a'.repeat(40),production_permitted:false};
const digest=id=>createHash('sha256').update(id).digest('hex');
const proof=id=>({stage_id:id,scenario_id:context.scenario_id,market:context.market,
 order_id:context.order_id,order_reference:context.order_reference,
 db_fingerprint:context.db_fingerprint,staging_sha:context.staging_sha,
 source_run_id:'45123456789',evidence_path:'test-results/'+id+'/report.json',
 verdict:'PASS',production_permitted:false});
const attestation=id=>({...context,stage_id:id,evidence_sha256:digest(id),
 attestation_origin:'INDEPENDENT_CHROMIUM_POSTGRESQL',
 external_supplier_calls:0,external_payment_executed:false});
function services(){
 return {
  attestRuntime:jest.fn(async()=>({...context,environment:'staging',
   attestation_origin:'INDEPENDENT_CHROMIUM_POSTGRESQL'})),
  authenticateCheckpoint:jest.fn(async({checkpoint})=>attestation(checkpoint.stage_id)),
  executeStage:jest.fn(async({stageId})=>({raw_stage:stageId,chromium:true})),
  verifyStageProof:jest.fn(async({stageId,proof})=>{
   if(proof.raw_stage!==stageId)throw Error('WRONG_STAGE_PROOF');
   return attestation(stageId);
  }),
  persistEvidence:jest.fn(async({stageId,attestation:a})=>({
   stage_id:stageId,evidence_sha256:a.evidence_sha256,persisted:true
  }))
 };
}
describe('G6 registered dynamic execution core, no fixture fallback',()=>{
 test('two fresh stages execute and persist in dependency order, never self-certify',async()=>{
  const adapters=services();
  const r=await executeBoundJourney({
   fromStage:'BUYER',toStage:'RELAY_CASH',context,checkpoints:[],adapters
  });
  expect(r).toMatchObject({order_reference:'KNEW1234',verdict:'NOT_PROVEN',
   full_chain_certified:false,production_permitted:false});
  expect(r.stages.map(x=>x.stage_id)).toEqual(['BUYER','RELAY_CASH']);
  expect(adapters.executeStage.mock.calls.map(x=>x[0].stageId)).toEqual(['BUYER','RELAY_CASH']);
  expect(adapters.persistEvidence).toHaveBeenCalledTimes(2);
 });
 test('resume is authorized by independent prerequisite attestation only',async()=>{
  const adapters=services();
  const checkpoints=prerequisiteIds('HUB_COMMITMENT').map(proof);
  const r=await executeBoundJourney({
   fromStage:'HUB_COMMITMENT',toStage:'HUB_VENDOR_READINESS',
   context,checkpoints,adapters
  });
  expect(r.stages.map(x=>x.stage_id)).toEqual(['HUB_COMMITMENT','HUB_VENDOR_READINESS']);
  expect(adapters.authenticateCheckpoint).toHaveBeenCalledTimes(3);
  expect(adapters.executeStage).toHaveBeenCalledTimes(2);
 });
 test('missing independent adapters is never interpreted as a dry-run success',async()=>{
  await expect(executeBoundJourney({context,adapters:{}}))
   .rejects.toThrow('G6_DYNAMIC_CERTIFIED_ADAPTERS_REQUIRED');
 });
 test('wrong runtime and foreign order fail before any mutation',async()=>{
  const a=services();
  a.attestRuntime.mockResolvedValue({...context,environment:'production',
    attestation_origin:'INDEPENDENT_CHROMIUM_POSTGRESQL'});
  await expect(executeBoundJourney({context,adapters:a})).rejects.toThrow('RUNTIME_NOT_INDEPENDENTLY_ATTESTED');
  expect(a.executeStage).not.toHaveBeenCalled();
  const b=services();
  b.attestRuntime.mockResolvedValue({...context,order_id:'foreign',environment:'staging',
    attestation_origin:'INDEPENDENT_CHROMIUM_POSTGRESQL'});
  await expect(executeBoundJourney({context,adapters:b})).rejects.toThrow('RUNTIME_NOT_INDEPENDENTLY_ATTESTED');
  expect(b.executeStage).not.toHaveBeenCalled();
 });
 test('unverified resume evidence rejects before business execution',async()=>{
  const a=services();
  a.authenticateCheckpoint.mockResolvedValue({...attestation('BUYER'),order_id:'foreign'});
  await expect(executeBoundJourney({
   fromStage:'RELAY_CASH',toStage:'HUB_PO',context,
   checkpoints:prerequisiteIds('RELAY_CASH').map(proof),adapters:a
  })).rejects.toThrow('STAGE_ATTESTATION_INVALID_BUYER');
  expect(a.executeStage).not.toHaveBeenCalled();
 });
 test('a foreign business proof blocks later stages and cannot be persisted',async()=>{
  const a=services();
  a.verifyStageProof.mockResolvedValue({...attestation('BUYER'),external_payment_executed:true});
  await expect(executeBoundJourney({
   fromStage:'BUYER',toStage:'RELAY_CASH',context,adapters:a
  })).rejects.toThrow('STAGE_ATTESTATION_INVALID_BUYER');
  expect(a.executeStage).toHaveBeenCalledTimes(1);
  expect(a.persistEvidence).not.toHaveBeenCalled();
 });
 test('no durable evidence means no later physical gesture',async()=>{
  const a=services();
  a.persistEvidence.mockResolvedValue({persisted:false});
  await expect(executeBoundJourney({
   fromStage:'BUYER',toStage:'RELAY_CASH',context,adapters:a
  })).rejects.toThrow('EVIDENCE_NOT_DURABLE_BUYER');
  expect(a.executeStage).toHaveBeenCalledTimes(1);
 });
 test('all-stage run still requires final independent E2E certificate',async()=>{
  const a=services();
  const result=await executeBoundJourney({context,adapters:a});
  expect(result.stages).toHaveLength(15);
  expect(result.next_action).toBe('INDEPENDENT_FINAL_CHROMIUM_PG_CERTIFICATION_REQUIRED');
  expect(result).toMatchObject({verdict:'NOT_PROVEN',full_chain_certified:false});
 });
});
