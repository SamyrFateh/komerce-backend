/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {createHash}=require('node:crypto');
const {bootstrapFreshM01}=require('../../scripts/recette/canonical/fresh-buyer-bootstrap');
const sha='a'.repeat(40),db='new-staging-fingerprint';
const order={id:'550e8400-e29b-41d4-a716-446655440000',
 reference:'KNEW1234',market:'KM',scope:'G6-BUYER',
 status:'pending',payment_status:'pending'};
const buyer={verdict:'G6_P2_REAL_OTP_CHROMIUM_ORDER_CREATED_NO_EXTERNAL_EFFECTS',
 market:'KM',order,db_fingerprint:db,runtime_sha:sha,
 payment_real:false,supplier_order_real:false,blocked_requests:[]};
const digest=x=>createHash('sha256').update(x).digest('hex');
function adapters(){
 const runtime={environment:'staging',scenario_id:'M01',market:'KM',
  staging_sha:sha,db_fingerprint:db,production_permitted:false,
  attestation_origin:'INDEPENDENT_CHROMIUM_POSTGRESQL'};
 const makeProof=stageId=>({
  stage_id:stageId,scenario_id:'M01',market:'KM',order_id:order.id,
  order_reference:order.reference,db_fingerprint:db,staging_sha:sha,
  production_permitted:false,attestation_origin:'INDEPENDENT_CHROMIUM_POSTGRESQL',
  external_supplier_calls:0,external_payment_executed:false,
  evidence_sha256:digest(stageId)
 });
 return {
  attestRuntimeBeforeBuyer:jest.fn(async()=>runtime),
  executeBuyerChromium:jest.fn(async()=>buyer),
  verifyBuyerIndependently:jest.fn(async()=>makeProof('BUYER')),
  persistEvidence:jest.fn(async({stageId,attestation})=>({
   stage_id:stageId,evidence_sha256:attestation.evidence_sha256,persisted:true,
   source_run_id:'45123456789',evidence_path:'test-results/'+stageId+'/report.json'
  })),
  attestRuntime:jest.fn(async()=>({...runtime,order_id:order.id,order_reference:order.reference})),
  authenticateCheckpoint:jest.fn(async({checkpoint})=>makeProof(checkpoint.stage_id)),
  executeStage:jest.fn(async({stageId})=>({stage_id:stageId,chromium:true})),
  verifyStageProof:jest.fn(async({stageId})=>makeProof(stageId))
 };
}
describe('G6 dynamic bootstrap: the order must originate from buyer Chromium',()=>{
 test('creates a new order then executes cash on exactly this order',async()=>{
  const a=adapters();
  const result=await bootstrapFreshM01({toStage:'RELAY_CASH',adapters:a});
  expect(a.executeBuyerChromium).toHaveBeenCalledTimes(1);
  expect(a.authenticateCheckpoint).toHaveBeenCalledTimes(1);
  expect(a.executeStage.mock.calls.map(c=>c[0].stageId)).toEqual(['RELAY_CASH']);
  expect(a.executeStage.mock.calls[0][0].context.order_id).toBe(order.id);
  expect(result).toMatchObject({order_id:order.id,order_reference:order.reference,
   verdict:'NOT_PROVEN',full_chain_certified:false});
 });
 test('buyer-only stage still does not certify M01',async()=>{
  const a=adapters();
  const result=await bootstrapFreshM01({toStage:'BUYER',adapters:a});
  expect(result).toMatchObject({order_id:order.id,verdict:'NOT_PROVEN'});
  expect(a.executeStage).not.toHaveBeenCalled();
 });
 test('rejects a foreign buyer order before any downstream gesture',async()=>{
  const a=adapters();
  a.verifyBuyerIndependently.mockResolvedValue({
   stage_id:'BUYER',order_id:'foreign',attestation_origin:'INDEPENDENT_CHROMIUM_POSTGRESQL'
  });
  await expect(bootstrapFreshM01({adapters:a})).rejects.toThrow('INDEPENDENT_PROOF_INVALID');
  expect(a.persistEvidence).not.toHaveBeenCalled();
  expect(a.executeStage).not.toHaveBeenCalled();
 });
 test('rejects production or mismatched staging before creating buyer',async()=>{
  const a=adapters();
  a.attestRuntimeBeforeBuyer.mockResolvedValue({environment:'production'});
  await expect(bootstrapFreshM01({adapters:a})).rejects.toThrow('RUNTIME_INVALID');
  expect(a.executeBuyerChromium).not.toHaveBeenCalled();
 });
 test('rejects a fabricated buyer verdict or stale DB fingerprint',async()=>{
  for(const modified of [{...buyer,verdict:'PASS'},{...buyer,db_fingerprint:'foreign-db'}]){
   const a=adapters();a.executeBuyerChromium.mockResolvedValue(modified);
   await expect(bootstrapFreshM01({adapters:a})).rejects.toThrow('BUYER_PROOF_INVALID');
   expect(a.persistEvidence).not.toHaveBeenCalled();
  }
 });
 test('cannot continue if buyer evidence was not durably stored',async()=>{
  const a=adapters();
  a.persistEvidence.mockResolvedValue({stage_id:'BUYER',persisted:false});
  await expect(bootstrapFreshM01({adapters:a})).rejects.toThrow('EVIDENCE_NOT_DURABLE');
  expect(a.executeStage).not.toHaveBeenCalled();
 });
 test('cannot run without all runtime, UI and independent proof adapters',async()=>{
  await expect(bootstrapFreshM01({adapters:{}}))
   .rejects.toThrow('ADAPTERS_REQUIRED');
 });
});
