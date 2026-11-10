'use strict';
/** @test-kind unit @test-runner jest @test-requires none
 * @brief G2 real browser supplier-receipt harness never connects to shared staging and never forges 13-step GO.
 */
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const get=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('isolated Chromium workflow uses only disposable PG16/localhost; no staging secrets',()=>{
  const y=get('.github/workflows/hub-v1-isolated-chromium-receipt.yml');
  expect(y).toContain('image: postgres:16');
  expect(y).toContain('postgresql://komerce:komerce@localhost:5432/komerce_test');
  expect(y).toContain('E2E_CLICKS_BASE_URL: http://localhost:3917');
  expect(y).toContain('E2E_CLICKS_ALLOW_LOCAL:');
  expect(y).toContain("E2E_CLICKS_ALLOW_DISTRIBUTION: '0'");
  expect(y).toContain("github.event.issue.user.login == github.repository_owner");
  expect(y).not.toContain('secrets.RAILWAY_DATABASE_URL');
  expect(y).not.toContain('allow-remote-staging');
  expect(y).not.toContain('komerce-backend-production.up.railway.app');
  expect(y).toContain("--grep 'Hub : reception fournisseur'");
  expect(y).toContain('hub-v1-local-chromium-readback.js');
  expect(y).toContain('if: always()');
  expect(y).toContain('G2 staging 13/13 triple proof remains NOT_PROVEN');
});

test('test-only scripts parse, check ephemeral target before any writes or network',()=>{
  for(const p of [
    'scripts/recette/hub-v1-local-chromium-prepare.js',
    'scripts/recette/hub-v1-local-chromium-readback.js',
  ]){
    const src=get(p).replace(/^#![^\n]*\n/,'');
    expect(()=>new Function(src)).not.toThrow();
    expect(src.indexOf('assertEphemeralTarget(process.env.DATABASE_URL,[])')).toBeGreaterThan(0);
    expect(src).not.toContain('--allow-remote-staging');
  }
});

test('fixture is a fresh dry-run plus first seven canonical service steps, not SQL state seeding',()=>{
  const src=get('scripts/recette/hub-v1-local-chromium-prepare.js');
  expect(src).toContain("dry.verdict!=='DRY_RUN_NO_WRITES'");
  expect(src).toContain("'--stop-after=7'");
  expect(src).toContain("'PARTIAL_STOP_AFTER_STEP_PASS'");
  expect(src).toContain('zero_external_effects!==true');
  expect(src).toContain('GITHUB_ENV');
  expect(src).toContain("account_activation_required=FALSE");
  expect(src).toContain("staging_go:false,chromium_proven:false");
  expect(src).not.toMatch(/UPDATE orders SET|TRUNCATE|DELETE FROM orders/);
});

test('result requires a real UI receipt, independent authenticated API and PG UUID readback',()=>{
  const src=get('scripts/recette/hub-v1-local-chromium-readback.js');
  expect(src).toContain("x.key?.startsWith('hub:receive:')");
  expect(src).toContain("x.verdict==='CLICK_PASS'");
  expect(src).toContain("'/api/purchasing/po/'");
  expect(src).toContain('v_purchase_line_progress');
  expect(src).toContain('cash_collections');
  expect(src).toContain('supplier_execution_payments');
  expect(src).toContain("'PASS_LOCAL_CHROMIUM_HTTP_PG_RECEIPT_ONLY'");
  expect(src).toContain("scope:'LOCAL_DISPOSABLE_PG16_ONLY',staging_go:false");
  expect(src).not.toContain('PASS_STAGING_TRANSACTION_13_STEPS');
});
