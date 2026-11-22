/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../..');
const s=fs.readFileSync(path.join(ROOT,'scripts/recette/g6-n34a-api-delete-negative-chromium.js'),'utf8');
const w=fs.readFileSync(path.join(ROOT,'.github/workflows/staging-g6-n34a-central-hub-negative.yml'),'utf8');
describe('N34a central Hub immutable — guarded NEGATIVE API probe only',()=>{
 test('requires owner staging, read-only PG and exact served SHA',()=>{
  expect(s).toContain("G6_N34A_REFUSAL_ONLY==='1'");
  expect(s).toContain("default_transaction_read_only=on");
  expect(w).toContain("github.actor == github.repository_owner");
  expect(w).toContain("github.event.issue.user.login == github.repository_owner");
  expect(w).toContain("group: komerce-g6-canonical-real-transaction");
  expect(w).toContain("cancel-in-progress: false");
  expect(w).toContain("node scripts/recette/target-guard.js");
  expect(w).toContain('E2E_EXPECTED_DEPLOY_SHA');
 });
 test('never confuses API-only DELETE with real UI and verifies both normal and forced 409',()=>{
  expect(s).toContain("Supplier 360 offers no destructive button");
  expect(s).toContain("no_mutation_controls:true");
  expect(s).toContain("for(const force of [false,true])");
  expect(s).toContain("req.method()==='DELETE'");
  expect(s).toContain("headers['x-force-delete']==='true'");
  expect(s).toContain("res.status===409&&res.body?.code==='CENTRAL_HUB_SUPPLIER_IMMUTABLE'");
  expect(s).toContain("api_negative:true");
  expect(s).toContain("ui:false");
  expect(s).toContain("N34A_CENTRAL_HUB_DELETE_REFUSED_HTTP409_PG_UNCHANGED_NOT_FULL");
  expect(s).toContain("scenario_bound:false");
 });
 test('all authoritative snapshots are SELECT only and include PO/line/authorization/mappings',()=>{
  expect(s).toContain("centralHubIdentity(db)");
  expect(s).toContain("to_jsonb(s)");
  expect(s).toContain("purchase_orders po");
  expect(s).toContain("purchase_lines pl");
  expect(s).toContain("product_suppliers ps");
  expect(s).toContain("purchase_order_authorizations a");
  expect(s).toContain("POST_REJECTION_BUSINESS_MUTATION");
  expect(s).toContain("isDeepStrictEqual(after,before)");
  expect(s).not.toMatch(/db\.query\(\s*['`"]\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)/i);
  expect(s).not.toContain("external_payment_executed:true");
  expect(w).toContain("Save only redacted HTTP and PG hashes");
 });
});
