/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const script=name=>fs.readFileSync(path.join(ROOT,'scripts/recette',name),'utf8');
const workflow=fs.readFileSync(path.join(ROOT,'.github/workflows/staging-g6-n34-unified.yml'),'utf8');
const dbProof=fs.readFileSync(path.join(ROOT,'.github/workflows/p0-central-hub-supplier-postgres.yml'),'utf8');
const {graphFor,SCENARIO_STAGE_IDS}=require('../../scripts/recette/canonical/stage-registry');
describe('N34 unified independent security/source proof',()=>{
 test('the dedicated stage DAG has two real modules without M01 aliases',()=>{
  expect(SCENARIO_STAGE_IDS.N34).toEqual(['N34_CENTRAL_IMMUTABILITY','N34_EXPLICIT_SOURCE']);
  const graph=graphFor('N34');
  expect(graph.order).toEqual(['N34_CENTRAL_IMMUTABILITY','N34_EXPLICIT_SOURCE']);
  expect(graph.byId.get('N34_EXPLICIT_SOURCE').requires).toEqual(['N34_CENTRAL_IMMUTABILITY']);
  expect(graph.byId.get('N34_CENTRAL_IMMUTABILITY').roles).toContain('admin');
 });
 test('negative proof demands authenticated HTTP 409 normal+force and unchanged PG',()=>{
  const negative=script('g6-n34a-api-delete-negative-chromium.js');
  expect(negative).toContain("res.status===409&&res.body?.code==='CENTRAL_HUB_SUPPLIER_IMMUTABLE'");
  expect(negative).toContain("for(const force of [false,true])");
  expect(negative).toContain("isDeepStrictEqual(after,before)");
  expect(negative).toContain("['KM','CM','CG'].includes(env.G6_TARGET_MARKET)");
  expect(negative).not.toMatch(/db\.query\(\s*['`"]\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)/i);
 });
 test('isolated postgres checks update, deactivation and delete, without touching staging',()=>{
  for(const s of ["UPDATE public.suppliers SET name='Renamed unsafe supplier'",
   "UPDATE public.suppliers SET system_key=NULL",
   "UPDATE public.suppliers SET is_active=false",
   "DELETE FROM public.suppliers WHERE id=v_id",
   "CENTRAL_HUB_SUPPLIER_IMMUTABLE"])expect(dbProof).toContain(s);
  expect(dbProof).toContain("image: postgres:16");
  expect(dbProof).toContain("PGDATABASE: komerce_central_hub_proof");
 });
 test('real live supplier is reselected in browser, candidate/product readback is strict',()=>{
  const provenance=script('g6-n34b-final-provenance-readonly.js');
  expect(provenance).toContain("explicitSupplierProvenance(db");
  expect(provenance).toContain("await humanSelect(null,select,COHORT.supplier)");
  expect(provenance).toContain("G6_N34_FINAL_READONLY");
  expect(provenance).toContain("default_transaction_read_only=on");
  expect(provenance).toContain("original_positive_run:45023874015");
  expect(provenance).not.toContain("submit-manual-import");
  expect(provenance).not.toMatch(/db\.query\(\s*['`"]\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)/i);
 });
 test('same SHA and PG required for both stages and CM/CG not passed as fresh import',()=>{
  const verifier=script('g6-n34-final-verdict.js');
  expect(verifier).toContain("a.sha===b.sha&&a.db_fingerprint===b.db_fingerprint");
  expect(verifier).toContain("N34_KM_SOURCE_INVARIANTS_CHROMIUM_API_PG_PASS");
  expect(verifier).toContain("N34_GLOBAL_SOURCE_INVARIANTS_MARKET_SMOKE_NOT_MARKET_TRANSACTION");
  expect(verifier).toContain("market_specific_import_proven=env.G6_TARGET_MARKET==='KM'");
  expect(verifier).toContain("N34B_SHARED_PROVENANCE_PG_CHROMIUM_REVALIDATED_NOT_NEW_IMPORT");
  expect(verifier).toContain("scenario_bound:true");
 });
 test('one owner-only GitHub workflow, shared lock, SHA pin and read-only PG',()=>{
  for(const label of ['KM','CM','CG'])
   expect(workflow).toContain("g6-dynamic-fresh-full-N34-"+label+"'");
  expect(workflow).toContain('group: komerce-g6-canonical-real-transaction');
  expect(workflow).toContain('cancel-in-progress: false');
  expect(workflow).toContain("github.actor == github.repository_owner");
  expect(workflow).toContain("github.event.issue.user.login == github.repository_owner");
  expect(workflow).toContain("PGOPTIONS: '-c default_transaction_read_only=on'");
  expect(workflow).toContain('node scripts/recette/target-guard.js');
  expect(workflow).toContain('E2E_EXPECTED_DEPLOY_SHA');
  expect(workflow).toContain('node scripts/recette/g6-n34-final-verdict.js');
 });
});
