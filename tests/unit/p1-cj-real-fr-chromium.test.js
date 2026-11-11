'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('node:fs');
const path = require('node:path');
const {PLAN,ORIGIN,checkEnv,invariant} = require('../../scripts/recette/p1-cj-real-fr-chromium');
const script=fs.readFileSync(path.resolve(__dirname,
  '../../scripts/recette/p1-cj-real-fr-chromium.js'),'utf8');
const workflow=fs.readFileSync(path.resolve(__dirname,
  '../../.github/workflows/staging-p1-cj-fr-chromium.yml'),'utf8');
function env(){
  return {GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'issues',GITHUB_ACTOR:'owner',
    GITHUB_REPOSITORY_OWNER:'owner',KOMERCE_ENV:'staging',NODE_ENV:'test',
    STAGING_BASE_URL:ORIGIN,EXPECTED_RAILWAY_ENVIRONMENT:'staging',
    G6_CJ_FRENCH_EDITOR_APPROVED:'STAGING_ONLY_3_CJ_TEST',
    E2E_ADMIN_EMAIL:'dummy@example.test',E2E_ADMIN_PASSWORD:'placeholder',
    DATABASE_URL:'postgres://fake@host/staging',
    KOMERCE_STAGING_RESET_DB_PIN:'host:5432/staging',
    PGOPTIONS:'-c default_transaction_read_only=on',E2E_EXPECTED_DEPLOY_SHA:'a'.repeat(40)};
}
test('only the 3 actual KIR-000014 CJ TEST products may be edited',()=>{
  expect(PLAN.map(x=>x.ref)).toEqual(['KPR-000099','KPR-000100','KPR-000101']);
  expect(PLAN.map(x=>x.candidate)).toEqual(['KSC-000257','KSC-000258','KSC-000259']);
  expect(PLAN.some(x=>x.ref==='KPR-000098')).toBe(false); // WATCH stays excluded
  expect(PLAN.every(x=>x.name.length<80&&x.description.length>60)).toBe(true);
});
test('never runs on production, foreign actors, unlocked SHA or writable SQL connection',()=>{
  expect(()=>checkEnv(env())).not.toThrow();
  expect(()=>checkEnv({...env(),KOMERCE_ENV:'production'})).toThrow();
  expect(()=>checkEnv({...env(),GITHUB_ACTOR:'foreign'})).toThrow();
  expect(()=>checkEnv({...env(),G6_CJ_FRENCH_EDITOR_APPROVED:'1'})).toThrow();
  expect(()=>checkEnv({...env(),PGOPTIONS:''})).toThrow();
  expect(()=>checkEnv({...env(),E2E_EXPECTED_DEPLOY_SHA:''})).toThrow();
});
test('precondition refuses source/target drift or any existing sale activation',()=>{
  const plan=PLAN[0],row={product_ref:plan.ref,candidate_ref:plan.candidate,
    supplier_product_id:plan.supplier,name_source:plan.sourceName,
    description_source:'XYZ '+plan.sourceMarker+' more',
    source_decision:'TEST',sourcing_state:'imported_to_catalog',
    lifecycle_status:'candidate',is_active:false,is_available:false,
    exposures_enabled:0,local_prices:0};
  expect(()=>invariant(row,plan)).not.toThrow();
  expect(()=>invariant({...row,source_decision:'WATCH'},plan)).toThrow();
  expect(()=>invariant({...row,is_active:true},plan)).toThrow();
  expect(()=>invariant({...row,local_prices:1},plan)).toThrow();
  expect(()=>invariant({...row,name_source:'different'},plan)).toThrow();
});
test('proof requires actual UI, precise whitelisted POST, independent read-only PostgreSQL readback',()=>{
  expect(script).toContain("chromium.launch({headless:true})");
  expect(script).toContain("viewport:{width:1440,height:900}");
  expect(script).toContain("const row=page.locator('tr[data-product-ref=");
  expect(script).toContain('[data-catalog-quick-field="name"]');
  expect(script).toContain('[data-catalog-quick-field="description"]');
  expect(script).toContain("route.abort('blockedbyclient')");
  expect(script).toContain("await client.query('BEGIN READ ONLY')");
  expect(script).toContain("signed_french_overrides");
  expect(script).toContain('publication_unchanged:true');
  expect(script).not.toContain('route.fulfill(');
  expect(script).not.toMatch(/(?:UPDATE products|INSERT INTO products|DELETE FROM products)/);
  expect(workflow).toContain('default_transaction_read_only=on');
  expect(workflow).toContain('resolve-staging-deploy-pin.js');
  expect(workflow).toContain('github.actor == github.repository_owner');
});
