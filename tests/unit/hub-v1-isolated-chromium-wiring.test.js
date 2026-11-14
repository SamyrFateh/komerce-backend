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
  // #3740: shipping customs selects the market through the explicit URL.
  // An arbitrary form <select> must not be used as market authority.
  expect(src).toContain("const selectedUrl = url.startsWith('/admin/workspaces/shipping-customs')");
  expect(src).toContain("'market=' + MARKET_CODE");
  expect(src).toContain("await page.goto(selectedUrl, { waitUntil: 'domcontentloaded' })");
  const customsStart=src.indexOf("if (url.startsWith('/admin/workspaces/shipping-customs'))");
  const customsEnd=src.indexOf("  const sel = page.locator('select').first();",customsStart);
  const customs=src.slice(customsStart,customsEnd);
  const marketGuard="await expect(page).toHaveURL(new RegExp('(?:[?&])market='+MARKET_CODE+'(?:&|$)'))";
  const journeyGuard="page.locator('[data-international-journey]').first().waitFor";
  expect(customs).toContain(marketGuard);
  expect(customs.indexOf(marketGuard)).toBeLessThan(customs.indexOf(journeyGuard));
  expect(customs).not.toContain('selectOption(');
  expect(src).toContain('test.afterEach(async ({}, info) =>');
  expect(src).toContain("info.status !== 'passed'");
  expect(src).toContain("verdict: info.status === 'skipped' ? 'NOT_RUN' : 'CLICK_FAIL'");
  expect(src).toContain("key: 'full-suite:coverage'");
  expect((src.match(/^\s*test\('/gm)||[])).toHaveLength(10);
  expect(src).toContain("if (successfulTests !== 10)");
});
test('Relay LOCAL_STOCK flow uses the physical receipt lane, then the code-only handoff Kanban',()=>{
  const src=get('tests/staging-clicks/hub-v1-clicks.spec.js');
  expect(src).toContain("ws.locator('[data-relay-execution-jump=\"receive\"]')");
  expect(src).toContain("await jump.click()");
  expect(src).toContain("await expect(ws).toHaveAttribute('data-relay-active-operation', 'receive')");
  expect(src).toContain('[data-relay-direct-local-receipts]');
  expect(src).toContain('[data-relay-local-order="');
  expect(src).toContain('[data-local-physical-proof]');
  expect(src).toContain('[data-local-receipt-note]');
  expect(src).toContain("route: 'POST /api/orders/:id/local-relay-receipt'");
  expect(src).toContain("await activatePickupQueue(collectPage)");
  expect(src).toContain("key: 'local:collect'");
  expect(src).toContain("expect(Number(physical[0].qty_shipped), 'aucun expédié fictif').toBe(0)");
  expect(src).not.toContain("local:ship',");
  expect(src).not.toContain("local:receive',");
  expect(src).not.toContain('orders.simulation_scope exclu par queryParcels');
});

test('Full physical harness cannot silently run unrelated LOCAL_STOCK spec',()=>{
  const y=get('.github/workflows/hub-v1-isolated-chromium-receipt.yml');
  expect(y).not.toContain('local-stock-native-clicks.spec.js');
  const cmd="npx playwright test --config=playwright.hub-v1-clicks.config.js tests/staging-clicks/hub-v1-clicks.spec.js";
  expect(y.split(cmd)).toHaveLength(3);
});

test('disposable Chromium Admin receives an EXPLICIT global dashboard grant, other roles do not',()=>{
  const src=get('scripts/recette/hub-v1-local-chromium-prepare.js');
  const guard=src.indexOf('assertEphemeralTarget(process.env.DATABASE_URL,[])');
  const grant=src.indexOf('INSERT INTO dashboard_global_access_grants(user_id,reason)');
  expect(guard).toBeGreaterThan(0);
  expect(grant).toBeGreaterThan(guard);
  expect(src).toContain("WHERE u.id=$1 AND u.role='admin'");
  expect(src).toContain('ON CONFLICT (user_id) WHERE revoked_at IS NULL DO NOTHING');
  expect(src).toContain('HUB_LOCAL_CHROMIUM_UNEXPECTED_NONADMIN_GLOBAL_GRANT');
  expect(src).toContain('admin_dashboard_global_grant:true');
  expect(src).not.toContain('UPDATE dashboard_global_access_grants SET revoked_at=NULL');
});
test('independent API readback requires a persisted global grant, not an admin role alone',()=>{
  const src=get('scripts/recette/hub-v1-local-chromium-readback.js');
  expect(src).toContain("fetch(origin+'/api/admin/dashboard/context'");
  expect(src).toContain("dashboard.status===200");
  expect(src).toContain(".mode==='global'");
  expect(src).toContain("market_KM_allowed===true");
  expect(src).toContain('&&report.admin_dashboard_authority_verified');
  expect(src).not.toContain('secrets.RAILWAY_DATABASE_URL');
});

test('G2 disposable Relay gets exactly canonical execution grants and simulated parcels are visible only to registered fixture actors',()=>{
  const src=get('scripts/recette/hub-v1-local-chromium-prepare.js');
  expect(src).toContain('assertEphemeralTarget(process.env.DATABASE_URL,[])');
  expect(src).toContain("require('./staging-e2e-provision')");
  expect(src).toContain("assignments.resolveOrCreateAssignment(grantClient,{");
  expect(src).toContain('marketId:proof.fixture.market_id,marketCode:\'KM\'');
  expect(src).toContain('provision.RELAY_AGENT_CAPABILITIES.slice().sort()');
  expect(src).toContain('assignment_capability_ceiling');
  expect(src).toContain('await provision.ensureRelayAgentMembership(grantClient,{delegation},{');
  expect(src).toContain("userId:relayActor.id,marketCode:'KM',actorId:fixtureAdmin.id");
  expect(src).toContain("for(const key of ['admin','hub_agent','relay_agent'])");
  expect(src).toContain('await provision.markE2eTestAccount(grantClient,{');
  expect(src).toContain('await isE2eTestAccount(proof.fixture.users[key].id)');
  expect(src).toContain('HUB_LOCAL_CHROMIUM_RELAY_MEMBERSHIP_NOT_PROVEN');
  const runner=get('scripts/recette/hub-v1-certification-runner.js');
  expect(runner).toContain('relay_id: m.relay');
  expect(src).toContain('!proof.fixture.relay_id');
  expect(src).not.toContain('!proof.fixture.relay)');
  expect(src).toContain('String(actualRelay.relais_id)!==String(proof.fixture.relay_id)');
  expect(src).toContain('String(actualRelay.market_id)!==String(proof.fixture.market_id)');
  expect(src).toContain('HUB_LOCAL_CHROMIUM_RELAY_BINDING_MISMATCH');
  expect(src).toContain('HUB_LOCAL_CHROMIUM_UNRELATED_FORWARDER_MARKED');
  expect(src).toContain("operations_simulation_visibility:'EXPLICIT_E2E_IDENTITIES_ONLY'");
  expect(src).toContain("await grantClient.query('BEGIN')");
  expect(src).toContain("await grantClient.query('COMMIT')");
  expect(src).toContain("await grantClient.query('ROLLBACK')");
  expect(src).not.toContain('INSERT INTO e2e_test_accounts');
  expect(src).not.toContain('INSERT INTO assignment_memberships');
  expect(src).not.toContain('UPDATE orders SET');
  expect(src).not.toContain('session_replication_role');
});
