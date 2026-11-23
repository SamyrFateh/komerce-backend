'use strict';
/**
 * @komerce-arch-lite
 * @role          staging-economic-result-readonly-proof
 * @domain        economic-engine
 * @layer         test
 * @owner         backend-core
 * @purpose       Compare the real market decision API, independent PG scope, and rendered Chromium economic KPI.
 * @impact-areas  staging-only, economic-engine, admin-dashboard
 * No business writes. This is a UI/API/scope proof, NOT an audited full-ledger profit certification.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const BASE = 'https://komerce-backend-production.up.railway.app';
const MARKETS = Object.freeze(['KM', 'CM', 'CG']);
const OUT = path.resolve('test-results/economic-result-readonly');
const n = value => value == null || (typeof value === 'string' && value.trim() === '')
  || !Number.isFinite(Number(value)) ? null : Number(value);
const fmt = value => value == null ? '—' :
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value) + ' KMF';
const rounded = value => Math.round((value + Number.EPSILON) * 100) / 100;
function assess(decision) {
  const flow = decision?.flow_break_even || {};
  const state = flow.economic_state || {};
  if (flow.status !== 'READY') {
    return { ready: false, expectedDisplay: '—', result: null, reason: flow.reason || 'NOT_DECISIONAL' };
  }
  const contribution = n(state.period_contribution_kmf);
  const structure = n(state.period_structural_charges_kmf ?? state.period_n3_kmf);
  const result = n(state.period_result_kmf);
  if (contribution === null || structure === null || result === null) {
    return { ready: false, expectedDisplay: '—', result: null, reason: 'ECONOMIC_INPUT_UNPROVEN' };
  }
  assert.ok(Math.abs(result - rounded(contribution - structure)) <= 0.011,
    'SERVER_CONTRIBUTION_MINUS_STRUCTURE_MISMATCH');
  const numerator = n(decision?.coverage?.numerator_contribution_kmf);
  const denominator = n(decision?.coverage?.structural_charges_kmf ?? decision?.coverage?.denominator_n3_kmf);
  if (numerator !== null) assert.ok(Math.abs(numerator - contribution) <= 0.011, 'CONTRIBUTION_POOL_MISMATCH');
  if (denominator !== null) assert.ok(Math.abs(denominator - structure) <= 0.011, 'STRUCTURE_POOL_MISMATCH');
  const alias = n(state.period_n3_kmf);
  if (alias !== null) assert.ok(Math.abs(alias - structure) <= 0.011, 'STRUCTURAL_ALIAS_MISMATCH');
  const mix = n(flow?.observed_mix?.reconciled_contribution_kmf);
  if (mix !== null) assert.ok(Math.abs(mix - contribution) <= 0.011, 'RECONCILED_MIX_MISMATCH');
  return { ready: true, expectedDisplay: fmt(result), result, contribution, structure,
    reason: 'SERVER_PERIOD_IDENTITY_MATCHES' };
}
function verifyEnvironment(env) {
  assert.equal(env.STAGING_BASE_URL, BASE, 'STAGING_ORIGIN_MISMATCH');
  assert.equal(env.KOMERCE_ENV, 'staging', 'STAGING_ONLY');
  assert.equal(env.EXPECTED_RAILWAY_ENVIRONMENT, 'staging', 'RAILWAY_ENV_ONLY');
  assert.ok(String(env.PGOPTIONS || '').includes('default_transaction_read_only=on'), 'PG_READ_ONLY_REQUIRED');
  assert.match(String(env.E2E_EXPECTED_DEPLOY_SHA || ''), /^[a-f0-9]{40}$/i, 'DEPLOY_SHA_PIN_REQUIRED');
  assert.ok(env.DATABASE_URL, 'DATABASE_CONNECTION_MISSING');
  assert.ok(env.E2E_ADMIN_EMAIL && env.E2E_ADMIN_PASSWORD, 'ADMIN_IDENTITY_MISSING');
}
const save = report => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
};
async function certify() {
  verifyEnvironment(process.env);
  const db = require('../../db');
  const { confirmTarget } = require('./target-guard');
  const report = { run_id: process.env.GITHUB_RUN_ID || null, staging_sha: null,
    database_identity: 'UNVERIFIED', business_writes: 0, markets: {},
    verdict: 'NOT_PROVEN', limitations: [
      'This run compares read-only API, PG market scope and Chromium presentation; it does not independently recalculate cost ledger allocations or statutory earnings.',
      'A market with non-decisional economic inputs remains NOT_PROVEN even if the UI correctly displays an em dash.'
    ]};
  let browser;
  try {
    const target = await confirmTarget({ db, env: process.env });
    assert.ok(target.confirmed, 'STAGING_DB_IDENTITY_NOT_CONFIRMED');
    report.database_identity = 'CONFIRMED_SAME_STAGING_TARGET';
    const pgMode = await db.query('SHOW default_transaction_read_only');
    assert.equal(pgMode.rows[0]?.default_transaction_read_only, 'on', 'PG_NOT_READ_ONLY');
    const response = await fetch(BASE + '/health/version', { redirect: 'error' });
    assert.equal(response.status, 200, 'STAGING_VERSION_NOT_200');
    const served = String((await response.json()).commit || '');
    assert.equal(served, process.env.E2E_EXPECTED_DEPLOY_SHA, 'STAGING_SHA_DRIFT');
    report.staging_sha = served;
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', baseURL: BASE });
    const login = await ctx.request.post('/api/auth/login', { data: {
      email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD
    }});
    assert.equal(login.status(), 200, 'ADMIN_LOGIN_FAILED');
    const auth = await ctx.request.get('/api/auth/me');
    assert.equal(auth.status(), 200, 'ADMIN_AUTH_ME_FAILED');
    assert.equal((await auth.json()).role, 'admin', 'ACTOR_NOT_ADMIN');
    const blocked = [];
    await ctx.route('**/*', route => {
      const req = route.request();
      const url = new URL(req.url());
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return route.continue();
      blocked.push({ method: req.method(), path: url.pathname });
      return route.abort('blockedbyclient');
    });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e.message).slice(0, 160)));
    for (const market of MARKETS) {
      const entry = report.markets[market] = { pg: 'PENDING', api: 'PENDING', ui: 'PENDING', economic: 'NOT_PROVEN' };
      const rows = await db.query('SELECT id,code FROM markets WHERE code=$1', [market]);
      assert.equal(rows.rows.length, 1, 'PG_MARKET_NOT_UNIQUE_' + market);
      assert.equal(rows.rows[0].code, market, 'PG_MARKET_SCOPE_MISMATCH_' + market);
      const stock = await db.query(
        "SELECT COUNT(*)::int AS count FROM economic_structure_cost_events WHERE (market_id=$1 OR scope_kind='GROUP')",
        [rows.rows[0].id]);
      entry.pg = 'MARKET_IDENTIFIED_AND_STRUCTURE_EVENTS_READ';
      entry.structure_event_rows_in_scope = Number(stock.rows[0]?.count || 0);
      const api = await ctx.request.get('/api/admin/workspaces/pricing/market/' + market + '/decision');
      entry.api_http = api.status();
      assert.equal(api.status(), 200, 'MARKET_DECISION_HTTP_' + market);
      const decision = await api.json();
      entry.coverage_status = decision?.coverage?.coverage_status || 'MISSING';
      entry.flow_status = decision?.flow_break_even?.status || 'MISSING';
      const a = assess(decision);
      entry.api = 'MARKET_DECISION_READ_AND_IDENTITY_CHECKED';
      entry.economic = a.ready ? 'SERVER_IDENTITY_PROVEN_NOT_INDEPENDENT_LEDGER' : a.reason;
      entry.expected_display = a.expectedDisplay;
      entry.contribution_kmf = a.contribution ?? null;
      entry.structural_charges_kmf = a.structure ?? null;
      entry.period_result_kmf = a.result;
      await page.goto('/admin/workspaces/pricing?market=' + market, { waitUntil: 'domcontentloaded' });
      const panel = page.locator('[data-pricing-flow-equilibrium]');
      await panel.waitFor({ state: 'visible', timeout: 35000 });
      const matching = panel.locator('.kmc-flow-equilibrium-metric').filter({
        has: page.locator('.kmc-flow-equilibrium-label', { hasText: 'Résultat après charges fixes' })
      });
      assert.equal(await matching.count(), 1, 'ECONOMIC_RESULT_KPI_MISSING_' + market);
      const textValue = (await matching.locator('.kmc-flow-equilibrium-value').innerText()).trim();
      assert.equal(textValue.replace(/[\u00A0\u202F]/g, ' '),
        a.expectedDisplay.replace(/[\u00A0\u202F]/g, ' '), 'UI_API_RESULT_MISMATCH_' + market);
      await page.screenshot({ path: path.join(OUT, 'atelier-' + market + '.png'), fullPage: true });
      entry.ui = 'ACTUAL_CHROMIUM_MATCHES_AUTHORITATIVE_API';
      save(report);
    }
    assert.deepEqual(blocked, [], 'UNEXPECTED_BROWSER_BUSINESS_WRITE');
    assert.deepEqual(pageErrors, [], 'CHROMIUM_PAGE_ERRORS');
    const after = await fetch(BASE + '/health/version', { redirect: 'error' });
    assert.equal(after.status, 200, 'VERSION_RECHECK_FAILED');
    assert.equal((await after.json()).commit, report.staging_sha, 'SHA_CHANGED_DURING_CERTIFICATION');
    report.verdict = 'READ_ONLY_API_PG_SCOPE_CHROMIUM_MATCH';
    report.all_markets_economically_decisional = MARKETS.every(m =>
      report.markets[m].economic === 'SERVER_IDENTITY_PROVEN_NOT_INDEPENDENT_LEDGER');
    await ctx.close();
  } catch (e) {
    report.error = String(e.message).slice(0, 350);
    report.verdict = 'BLOCKED';
    process.exitCode = 2;
  } finally {
    if (browser) await browser.close();
    await db.pool.end();
    save(report);
    console.log(JSON.stringify({ verdict: report.verdict, staging_sha: report.staging_sha,
      database_identity: report.database_identity, all_markets_economically_decisional:
        report.all_markets_economically_decisional === true,
      markets: Object.fromEntries(Object.entries(report.markets).map(([k,v]) =>
        [k, {api_http:v.api_http, pg:v.pg, ui:v.ui, economic:v.economic}])), error:report.error || null }));
  }
}
if (require.main === module) certify();
module.exports = { assess, verifyEnvironment, fmt };
