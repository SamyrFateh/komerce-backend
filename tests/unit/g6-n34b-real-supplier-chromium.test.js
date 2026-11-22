/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const runner=fs.readFileSync(path.join(ROOT,'scripts/recette/g6-n34b-real-supplier-chromium.js'),'utf8');
const workflow=fs.readFileSync(path.join(ROOT,'.github/workflows/staging-g6-n34b-real-supplier.yml'),'utf8');
describe('N34b supplier provenance — real Chromium + independent PG, never blanket PASS',()=>{
 test('the supplier is chosen explicitly and the unique fixture is run-scoped',()=>{
  expect(runner).toContain('chooseSupplierFixtures(rows)');
  expect(runner).toContain('await humanSelect(null,select,selected.real.id)');
  expect(runner).toContain('p.supplier_id===selected.real.id');
  expect(runner).toContain("GITHUB_RUN_ID");
  expect(runner).toContain('FIXTURE_ALREADY_EXISTS_NO_REPLAY');
  expect(runner).toContain("supplier_product_id:'G6-N34B-'");  
 });
 test('source identity must persist from candidate into product after the actual UI promotion',()=>{
  expect(runner).toContain("submit-manual-import");
  expect(runner).toContain("'[data-sourcing-promote]'");
  expect(runner).toContain("explicitSupplierProvenance(db,{productId:product.product_id");
  expect(runner).toContain('candidateId:product.id,expectedSupplierId:selected.real.id');
  expect(runner).toContain('CENTRAL_HUB_FICTITIOUS_DEBT_OR_PO');
  expect(runner).toContain("scenario_bound:false");
  expect(runner).toContain("N34B_REAL_SOURCE_DRAFT_CHROMIUM_PG_PASS_NOT_FULL");
  expect(runner).toContain("CANDIDATE_CLASSIFICATION_OR_PROMOTION_REPAIR");
 });
 test('Node fetch uses boolean Response.ok property, never callable .ok()',()=>{
  expect(runner).toContain("check(v.ok===true,'HEALTH_FAILED')");
  expect(runner).not.toMatch(/\\bv\\.ok\\s*\\(/);
  expect(runner).toContain("version.commit===env.E2E_EXPECTED_DEPLOY_SHA");
 });
 test('fail-closed owner staging workflow, canonical lock, SHA, no direct business SQL write',()=>{
  expect(workflow).toContain("github.actor == github.repository_owner");
  expect(workflow).toContain("github.event.issue.user.login == github.repository_owner");
  expect(workflow).toContain("group: komerce-g6-canonical-real-transaction");
  expect(workflow).toContain("cancel-in-progress: false");
  expect(workflow).toContain("node scripts/recette/target-guard.js");
  expect(workflow).toContain("E2E_EXPECTED_DEPLOY_SHA");
  expect(workflow).toContain("node scripts/recette/g6-n34b-real-supplier-chromium.js");
  expect(runner).not.toMatch(/page\.request\.(post|put|patch|delete)\(/);
  expect(runner).not.toMatch(/db\.query\(\s*['`"]\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)/i);
 });
});
