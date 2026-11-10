'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @brief G3 real Chromium UI + HTTP/PG on disposable localhost never degrades Railway staging guards.
 */
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const PREP='scripts/recette/g3-local-chromium-prepare.js';
const READ='scripts/recette/g3-local-chromium-readback.js';
const WORK='.github/workflows/g3-isolated-local-chromium-relay.yml';
const CONF='playwright.g3-isolated-local.config.js';
const NATIVE='tests/staging-clicks/local-stock-native-clicks.spec.js';

test('real browser workflow is owner-only, disposable PG16, localhost, never Railway',()=>{
  const w=read(WORK);
  expect(w).toContain('image: postgres:16');
  expect(w).toContain('postgresql://komerce:komerce@localhost:5432/komerce_test');
  expect(w).toContain('G3_ISOLATED_LOCAL:');
  expect(w).toContain('E2E_CLICKS_BASE_URL: http://localhost:3917');
  expect(w).toContain("github.event.issue.user.login == github.repository_owner");
  expect(w).toContain("github.event.issue.title == '[cert-op] g3-isolated-local-chromium-relay'");
  expect(w).toContain('npm ci');
  expect(w).toContain('docs/db/railway-live-schema.sql');
  expect(w).toContain('g3-local-chromium-prepare.js');
  expect(w).toContain('playwright.g3-isolated-local.config.js');
  expect(w).toContain('g3-local-chromium-readback.js');
  expect(w).toContain('if: always()');
  expect(w).not.toContain('secrets.RAILWAY_DATABASE_URL');
  expect(w).not.toContain('allow-remote-staging');
  expect(w).not.toContain('komerce-backend-production.up.railway.app');
  expect(w).toContain('G3 on Railway staging is NOT_PROVEN');
});

test('local-only JS scripts parse and protect database before any write',()=>{
  for(const p of [PREP,READ]){
    const src=read(p).replace(/^#![^\n]*\n/,'');
    expect(()=>new Function(src)).not.toThrow();
    expect(src).toContain('assertEphemeralTarget(process.env.DATABASE_URL,[])');
    expect(src).toContain("process.env.KOMERCE_ENV!=='test'");
    expect(src).not.toContain('--allow-remote-staging');
    expect(src).not.toMatch(/session_replication_role|UPDATE orders SET|DELETE FROM orders|TRUNCATE/);
  }
});

test('fixture uses canonical checkout and simulated payment, never directly sets business statuses',()=>{
  const p=read(PREP);
  expect(p).toContain("'--stop-after=2'");
  expect(p).toContain("dry.verdict!=='DRY_RUN_NO_WRITES'");
  expect(p).toContain("proof.verdict!=='PARTIAL_STOP_AFTER_STEP_PASS'");
  expect(p).toContain("zero_external_effects!==true");
  expect(p).toContain("assess(before,'before')");
  expect(p).toContain("actor.role!=='agent_relais'");
  expect(p).toContain('String(scope.relais_id)!==String(before.order.relais_id)');
  expect(p).toContain('::add-mask::');
  expect(p).toContain('GITHUB_ENV');
  expect(p).toContain("chromium_proven:false");
  expect(p).not.toContain("'--stop-after=7'");
});

test('disposable relay actor is marked using the official E2E identity writer only',()=>{
  const p=read(PREP);
  expect(p).toContain("runner.assertEphemeralTarget(process.env.DATABASE_URL,[])");
  expect(p).toContain("actor.role!=='agent_relais'");
  expect(p).toContain("String(scope.relais_id)!==String(before.order.relais_id)");
  expect(p).toContain("require('./staging-e2e-provision')");
  expect(p).toContain("await markE2eTestAccount(markerClient,");
  expect(p).toContain("userId:actor.id,actorId:proof.fixture.users.admin.id");
  expect(p).toContain("await isE2eTestAccount(actor.id)");
  expect(p).not.toContain('INSERT INTO e2e_test_accounts');
  expect(p).not.toContain('UPDATE orders SET');
});

test('local config rejects missing target proof and preserves staging-only Playwright config',()=>{
  const config=read(CONF), official=read('playwright.staging-relay-local-native.config.js');
  expect(()=>new Function(config)).not.toThrow();
  expect(config).toContain('assertEphemeralTarget(process.env.DATABASE_URL,[])');
  expect(config).toContain("G3_ISOLATED_LOCAL!=='1'");
  expect(config).toContain("G3_LOCAL_CHROMIUM_DISPOSABLE_TARGET_ONLY");
  expect(config).toContain("browserName:'chromium'");
  expect(config).toContain('local-stock-native-clicks.spec.js');
  expect(official).toContain("if(process.env.E2E_STAGING_BASE_URL!==BASE)");
  expect(official).toContain("const BASE='https://komerce-backend-production.up.railway.app'");
  const native=read(NATIVE);
  expect(native).toContain("ISOLATED_LOCAL = process.env.G3_ISOLATED_LOCAL === '1'");
  expect(native).toContain('assertEphemeralTarget(process.env.DATABASE_URL, [])');
  expect(native).toContain('receipt-double-click-single-post');
  expect(native).toContain('receipt-no-request-without-physical-proof');
  expect(native).toContain('receipt-no-request-without-observation');
  expect(native).toContain('receipt-single-post-after-pickup');
  expect(native).toContain("if(ISOLATED_LOCAL){record.blockedWrites.push('EXTERNAL '");
});

test('local verdict must combine the same real UI, authenticated GET and independent SQL',()=>{
  const p=read(READ);
  expect(p).toContain("proof.verdict==='LOCAL_STOCK_RELAIS_LIVE_CLICK_PASS'");
  expect(p).toContain("proof.target_mode==='DISPOSABLE_LOCAL_PG16'");
  expect(p).toContain('MUST_PASS.every');
  expect(p).toContain("'/api/auth/login'");
  expect(p).toContain("'/api/admin/workspaces/operations/market/KM'");
  expect(p).toContain("assess(dbState,'collected')");
  expect(p).toContain('Number(dbState.counts.cash_collections)===0');
  expect(p).toContain("PASS_G3_ISOLATED_CHROMIUM_HTTP_PG16");
  expect(p).toContain('staging_go:false');
  expect(p).not.toContain('PASS_STAGING_TRANSACTION');
});
