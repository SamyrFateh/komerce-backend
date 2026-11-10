'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('node:fs');
const path = require('node:path');
const { BASE, REFS, ALL, guard } =
  require('../../scripts/recette/p1-cj-four-chromium-readonly');
const workflow = fs.readFileSync(path.resolve(__dirname,
  '../../.github/workflows/staging-p1-cj-four-commercial-boundary-chromium.yml'),'utf8');
const source = fs.readFileSync(path.resolve(__dirname,
  '../../scripts/recette/p1-cj-four-chromium-readonly.js'),'utf8');

const ok = {
  GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'issues',GITHUB_ACTOR:'test-owner',
  GITHUB_REPOSITORY_OWNER:'test-owner',KOMERCE_ENV:'staging',KOMERCE_TARGET_ENV:'staging',
  EXPECTED_RAILWAY_ENVIRONMENT:'staging',STAGING_BASE_URL:BASE,NODE_ENV:'test',
  E2E_EXPECTED_DEPLOY_SHA:'a'.repeat(40)
};

test('G6 P1 matches only the three sourced TEST candidates and preserves WATCH refusal',()=>{
  expect(REFS).toEqual(['KPR-000099','KPR-000100','KPR-000101']);
  expect(ALL).toEqual(['KPR-000098',...REFS]);
});

test('real Chromium P1 is owner-only exact protected staging SHA, fails closed',()=>{
  expect(()=>guard(ok)).not.toThrow();
  expect(()=>guard({...ok,GITHUB_ACTOR:'foreign'})).toThrow();
  expect(()=>guard({...ok,KOMERCE_ENV:'production'})).toThrow();
  expect(()=>guard({...ok,KOMERCE_TARGET_ENV:'production'})).toThrow();
  expect(()=>guard({...ok,STAGING_BASE_URL:'https://komerce.co'})).toThrow();
  expect(()=>guard({...ok,E2E_EXPECTED_DEPLOY_SHA:''})).toThrow();
  expect(workflow).toContain("github.event.issue.title == '[staging-op] p1-cj-four-commercial-chromium-readonly'");
  expect(workflow).toContain('github.actor == github.repository_owner');
  expect(workflow).toContain('default_transaction_read_only=on');
  expect(workflow).toContain('resolve-staging-deploy-pin.js');
});

test('Chromium uses real pages and canonical GET contracts, with business mutation blocked',()=>{
  expect(source).toContain('chromium.launch({headless:true})');
  expect(source).toContain('viewport:{width:1440,height:900}');
  expect(source).toContain('/admin/workspaces/catalog?search=');
  expect(source).toContain('/admin/workspaces/pricing?market=KM&product_ref=');
  expect(source).toContain('/dashboards/canonical/market-catalog.html?market=KM');
  expect(source).toContain('/boutique/?market=KM');
  expect(source).toContain('/api/products?market=KM');
  expect(source).toContain("['GET','HEAD','OPTIONS'].includes(method)");
  expect(source).toContain("route.abort('blockedbyclient')");
  expect(source).not.toContain('route.fulfill(');
  expect(source).not.toMatch(/(?:db|client|pool)\.query\(/);
  expect(source).toContain('never_claims');
  expect(source).toContain("P1_KM_NOT_YET_VISIBLE");
});

test('canonical certification is read inside the same READ ONLY source audit',()=>{
  const audit=fs.readFileSync(path.resolve(__dirname,
    '../../scripts/recette/cj-four-km-commercial-readiness.js'),'utf8');
  expect(audit).toContain("await client.query('BEGIN READ ONLY')");
  expect(audit).toContain('certifyCatalogProduct(client, row.product_id)');
  expect(audit).toContain('inspectCatalogVisualFrEvidence(client, row.product_id)');
  expect(audit).toContain('allowed_to_approve_from_this_report: false');
});
