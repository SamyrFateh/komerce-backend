/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {planBoundResume}=require('../../scripts/recette/canonical/resume-preflight');
const {prerequisiteIds}=require('../../scripts/recette/canonical/stage-registry');
const context={scenario_id:'M01',market:'KM',order_id:'550e8400-e29b-41d4-a716-446655440000',
 order_reference:'KNEW123',staging_sha:'a'.repeat(40),db_fingerprint:'staging-example',production_permitted:false};
const proof=stage_id=>({stage_id,source_run_id:'45123456789',evidence_path:'test-results/'+stage_id+'/report.json',
 scenario_id:context.scenario_id,market:context.market,order_id:context.order_id,
 order_reference:context.order_reference,staging_sha:context.staging_sha,
 db_fingerprint:context.db_fingerprint,verdict:'PASS',production_permitted:false});
describe('G6 dynamic bound resume: structural preflight is never execution authorization',()=>{
 test('fresh arbitrary order reference and full dependency chain accepted read-only',()=>{
  const required=prerequisiteIds('HUB_COMMITMENT');
  const result=planBoundResume({fromStage:'HUB_COMMITMENT',toStage:'HUB_RECEIVING',
   context,checkpoints:required.map(proof)});
  expect(result).toMatchObject({mode:'read-only',verdict:'NOT_PROVEN',mutations:0,
   execution_authorized:false,independent_pg_chromium_verification_required:true,
   from_stage:'HUB_COMMITMENT',to_stage:'HUB_RECEIVING',checkpoint_count:3});
 });
 test('a first BUYER stage needs no checkpoint but cannot become certified',()=>{
  expect(planBoundResume({fromStage:'BUYER',toStage:'RELAY_CASH',context,checkpoints:[]}))
   .toMatchObject({checkpoint_count:0,execution_authorized:false,verdict:'NOT_PROVEN'});
 });
 test('missing, reordered or duplicate prerequisite stages are rejected',()=>{
  const checkpoints=prerequisiteIds('HUB_RECEIVING').map(proof);
  expect(()=>planBoundResume({fromStage:'HUB_RECEIVING',context,checkpoints:checkpoints.slice(1)})).toThrow('INCOMPLETE');
  const swapped=checkpoints.slice();[swapped[0],swapped[1]]=[swapped[1],swapped[0]];
  expect(()=>planBoundResume({fromStage:'HUB_RECEIVING',context,checkpoints:swapped})).toThrow('PROVENANCE');
  const duplicate=checkpoints.map((p,i)=>i===1?{...p,stage_id:checkpoints[0].stage_id}:p);
  expect(()=>planBoundResume({fromStage:'HUB_RECEIVING',context,checkpoints:duplicate})).toThrow('PROVENANCE');
 });
 test.each([
  {order_reference:'FOREIGN'},{order_id:'00000000-0000-4000-8000-000000000001'},
  {db_fingerprint:'other-db'},{staging_sha:'b'.repeat(40)},
  {market:'CM'},{verdict:'PREVIOUS_RUN_PASS'},{production_permitted:true},
  {source_run_id:'7'},{evidence_path:'../outside/report.json'}
 ])('reject foreign, uncertain or historical checkpoint mutation %p',edit=>{
  const checkpoints=prerequisiteIds('HUB_PO').map(proof);
  checkpoints[0]={...checkpoints[0],...edit};
  expect(()=>planBoundResume({fromStage:'HUB_PO',context,checkpoints})).toThrow('PROVENANCE');
 });
 test('production contexts, reversed stages and unknown phases fail closed',()=>{
  expect(()=>planBoundResume({fromStage:'HUB_PO',context:{...context,production_permitted:true},checkpoints:[]})).toThrow('CONTEXT');
  expect(()=>planBoundResume({fromStage:'CLIENT_PICKUP',toStage:'BUYER',context,checkpoints:[]})).toThrow('RANGE');
  expect(()=>planBoundResume({fromStage:'NOT_REGISTERED',context,checkpoints:[]})).toThrow('NOT_REGISTERED');
 });
});
