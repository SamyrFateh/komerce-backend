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
  expect(y).toContain("E2E_CLICKS_ALLOW_DISTRIBUTION: ${{ github.event_name == 'issues'");
  expect(y).toContain("github.event.issue.title == '[cert-op] hub-v1-isolated-chromium-physical'");
  expect(y).toContain("test \"$TRIGGER_TITLE\" = '[cert-op] hub-v1-isolated-chromium-physical'");
  expect(y).toContain("test \"$E2E_CLICKS_ALLOW_DISTRIBUTION\" = '0'");
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


test('physical mode is owner-issue-only on localhost, receipt-only remains the default',()=>{
  const y=get('.github/workflows/hub-v1-isolated-chromium-receipt.yml');
  expect(y).toContain("github.event.issue.user.login == github.repository_owner");
  expect(y).toContain("github.event.issue.title == '[cert-op] hub-v1-isolated-chromium-receipt'");
  expect(y).toContain("github.event.issue.title == '[cert-op] hub-v1-isolated-chromium-physical'");
  expect(y).toContain("test \"$GITHUB_EVENT_NAME\" = 'issues'");
  expect(y).toContain("npx playwright test --config=playwright.hub-v1-clicks.config.js tests/staging-clicks/hub-v1-clicks.spec.js\n");
  expect(y).toContain("--grep 'Hub : reception fournisseur'");
  expect(y).toContain('HUB_LOCAL_CHROMIUM_NO_PREPARED_FIXTURE');
  expect(y).not.toContain('secrets.RAILWAY_DATABASE_URL');
});

test('Customs page requires its actual international journey component, not unrelated operations select',()=>{
  const src=get('tests/staging-clicks/hub-v1-clicks.spec.js');
  expect(src).toContain("url.startsWith('/admin/workspaces/shipping-customs')");
  expect(src).toContain("await expect(page).toHaveURL(/\\/admin\\/workspaces\\/shipping-customs");
  expect(src).toContain("page.locator('[data-international-journey]').first().waitFor");
  expect(src).toContain("if (await marketOption.count()) await select.selectOption");
  const customsStart=src.indexOf("if (url.startsWith('/admin/workspaces/shipping-customs'))");
  const customsEnd=src.indexOf("  const sel = page.locator('select').first();",customsStart);
  const customs=src.slice(customsStart,customsEnd);
  expect(customs.indexOf("await select.selectOption")).toBeLessThan(customs.indexOf("page.locator('[data-international-journey]').first().waitFor"));
  expect(customs).not.toContain("selectOption({ label: MARKET_LABEL }).catch");
  expect(src).toContain('test.afterEach(async ({}, info) =>');
  expect(src).toContain("info.status !== 'passed'");
  expect(src).toContain("verdict: info.status === 'skipped' ? 'NOT_RUN' : 'CLICK_FAIL'");
  expect(src).toContain("key: 'full-suite:coverage'");
  expect((src.match(/^\s*test\('/gm)||[])).toHaveLength(10);
  expect(src).toContain("if (successfulTests !== 10)");
});
test('Full physical harness cannot silently run unrelated LOCAL_STOCK spec',()=>{
  const y=get('.github/workflows/hub-v1-isolated-chromium-receipt.yml');
  expect(y).not.toContain('local-stock-native-clicks.spec.js');
  const cmd="npx playwright test --config=playwright.hub-v1-clicks.config.js tests/staging-clicks/hub-v1-clicks.spec.js";
  expect(y.split(cmd)).toHaveLength(3);
});

test('local Chromium Admin receives an explicit REAL dashboard grant, never implicit admin-role privilege',()=>{
  const source=get('scripts/recette/hub-v1-local-chromium-prepare.js');
  // The target is checked BEFORE grants or credentials are created.
  expect(source.indexOf('assertEphemeralTarget(process.env.DATABASE_URL,[])'))
    .toBeLessThan(source.indexOf('INSERT INTO dashboard_global_access_grants'));
  expect(source.indexOf('GITHUB_ENV_REQUIRED'))
    .toBeLessThan(source.indexOf('INSERT INTO dashboard_global_access_grants'));
  expect(source).toContain("admin.role!=='admin'");
  expect(source).toContain('G2_ISOLATED_ADMIN_IDENTITY_MISMATCH');
  expect(source).toContain("existing?.n!==0");
  expect(source).toContain('G2_ISOLATED_ADMIN_GRANT_ALREADY_EXISTS');
  expect(source).toContain("INSERT INTO dashboard_global_access_grants(user_id,reason)");
  expect(source).toContain("'-ISOLATED-CHROMIUM-EXPLICIT-DASHBOARD'");
  expect(source).toContain('hasDashboardGlobalAuthority(admin.id)');
  expect(source).toContain("context.access.mode!=='global'");
  expect(source).toContain("context.access.allowedMarkets.includes('KM')");
  expect(source).toContain("for(const other of ['hub_agent','relay_agent','forwarder'])");
  expect(source).toContain('G2_ISOLATED_NONADMIN_GLOBAL_GRANT_FORBIDDEN');
  expect(source).not.toMatch(/UPDATE\\s+dashboard_global_access_grants\\s+SET\\s+revoked_at\\s*=\\s*NULL/i);
  expect(source).not.toContain('session_replication_role');
  expect(source).not.toContain('secrets.RAILWAY_DATABASE_URL');
});

test('dashboard resolver still requires a real scoped or explicit central grant',()=>{
  const resolver=get('services/dashboard-admin-context.js');
  expect(resolver).toContain('hasDashboardGlobalAuthority(user.id)');
  expect(resolver).toContain('throw new DashboardAccessDeniedError()');
  const middleware=get('middleware/require-dashboard-global-authority.js');
  expect(middleware).toContain('FROM dashboard_global_access_grants');
  expect(middleware).toContain('revoked_at IS NULL');
});
