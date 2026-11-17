#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch-lite
 * @role g6-a-order360-staging-browser
 * @domain orders
 * @layer tooling
 * @owner backend-core
 * @purpose Verify staged Order 360 through Chromium UI and independent read-only PostgreSQL.
 * @db-read orders, markets
 * @db-write none (browser login only; all business mutations blocked)
 */
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { confirmTarget } = require('./target-guard');
const BASE = 'https://komerce-backend-production.up.railway.app';
const REFERENCES = ['K76SW4C', 'K7CZ3GI', 'KUKAOMC'];
const OUT = path.resolve('test-results/g6-a-order360');

async function main() {
  assert.equal(process.env.KOMERCE_ENV, 'staging');
  assert.equal(process.env.KOMERCE_TARGET_ENV, 'staging');
  assert.equal(process.env.STAGING_BASE_URL, BASE);
  const missing = ['E2E_ADMIN_EMAIL', 'E2E_ADMIN_PASSWORD', 'E2E_AGENT_RELAIS_EMAIL', 'E2E_AGENT_RELAIS_PASSWORD', 'E2E_EXPECTED_DEPLOY_SHA']
    .filter(name => !process.env[name]);
  if (missing.length) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ verdict: 'BLOCKED_AT_LOGIN', missing_names: missing }));
    process.stderr.write(`Missing required configuration names: ${missing.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  const db = require('../../db');
  let browser;
  const report = { run_id: process.env.GITHUB_RUN_ID || null, verdict: 'NOT_PROVEN', orders: [], blocked_mutations: [] };
  fs.mkdirSync(OUT, { recursive: true });
  const save = () => fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const runtime = async () => {
    const response = await fetch(`${BASE}/health/version`);
    assert.equal(response.status, 200);
    const version = await response.json();
    assert.equal(version.commit, process.env.E2E_EXPECTED_DEPLOY_SHA, 'Staging SHA drift');
    return version.commit;
  };
  const snapshot = async () => {
    const client = await db.getClient();
    try {
      await client.query('BEGIN READ ONLY');
      const { rows } = await client.query(`
        SELECT o.reference,o.status::text,o.payment_status::text,o.total_kmf::text,
          o.display_total_amount::text,o.display_currency,o.simulation_scope,m.code AS market
        FROM orders o JOIN markets m ON m.id=o.market_id
        WHERE o.reference=ANY($1::text[]) ORDER BY m.code`, [REFERENCES]);
      await client.query('ROLLBACK');
      return rows;
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  };
  try {
    const target = await confirmTarget({ db });
    assert.equal(target.confirmed, true, 'Staging database target not confirmed');
    report.fingerprint = target.fingerprint;
    report.runtime_sha = await runtime();
    // Read role metadata independently before UI login. Do not read the login
    // response body after its automatic cross-document navigation (CDP may
    // already have discarded that response resource).
    report.account_bindings = {};
    for (const [prefix, role] of [['E2E_ADMIN', 'admin'], ['E2E_AGENT_RELAIS', 'agent_relais']]) {
      const { rows } = await db.query('SELECT role::text AS role FROM users WHERE lower(email)=lower($1)', [process.env[`${prefix}_EMAIL`]]);
      assert.equal(rows.length, 1, `Existing ${prefix} account required`);
      assert.equal(rows[0].role, role, `Expected ${prefix} role`);
      report.account_bindings[role] = { present: true, role };
    }
    save();
    const before = await snapshot();
    assert.equal(before.length, 3, 'Three existing recipe orders required');
    assert.deepEqual(before.map(row => row.market).sort(), ['CG', 'CM', 'KM']);
    assert.ok(before.every(row => row.simulation_scope), 'Only marked simulation orders allowed');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    const page = await context.newPage();
    let loginAllowed = true;
    await page.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
      if (loginAllowed && request.method() === 'POST' && url.origin === BASE && url.pathname === '/api/auth/login') {
        loginAllowed = false;
        return route.continue();
      }
      report.blocked_mutations.push({ method: request.method(), path: url.pathname });
      return route.abort();
    });
    await page.goto(`${BASE}/login.html`, { waitUntil: 'domcontentloaded' });
    await page.locator('#email').fill(process.env.E2E_ADMIN_EMAIL);
    await page.locator('#password').fill(process.env.E2E_ADMIN_PASSWORD);
    const loginResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST');
    await page.locator('#btn-submit').click();
    const login = await loginResponse;
    assert.equal(login.status(), 200, 'Admin login through UI failed');
    await page.waitForURL(url => !url.pathname.startsWith('/login'));
    report.admin_login_ui = true;
    // The separately provisioned relay identity must also work through the real login screen.
    const relayContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    const relayPage = await relayContext.newPage();
    let relayLoginAllowed = true;
    await relayPage.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
      if (relayLoginAllowed && request.method() === 'POST' && url.origin === BASE && url.pathname === '/api/auth/login') {
        relayLoginAllowed = false;
        return route.continue();
      }
      report.blocked_mutations.push({ method: request.method(), path: url.pathname });
      return route.abort();
    });
    await relayPage.goto(`${BASE}/login.html`, { waitUntil: 'domcontentloaded' });
    await relayPage.locator('#email').fill(process.env.E2E_AGENT_RELAIS_EMAIL);
    await relayPage.locator('#password').fill(process.env.E2E_AGENT_RELAIS_PASSWORD);
    const relayLoginResponse = relayPage.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST');
    await relayPage.locator('#btn-submit').click();
    const relayLogin = await relayLoginResponse;
    assert.equal(relayLogin.status(), 200, 'Relay login through UI failed');
    await relayPage.waitForURL(url => !url.pathname.startsWith('/login'));
    report.relay_login_ui = true;
    await relayContext.close();
    save();
    for (const row of before) {
      const endpoint = `/api/admin/entities/orders/${row.reference}`;
      const apiResponse = page.waitForResponse(response => new URL(response.url()).pathname === endpoint);
      await page.goto(`${BASE}/admin/orders/${row.reference}`, { waitUntil: 'domcontentloaded' });
      const response = await apiResponse;
      assert.equal(response.status(), 200, `Order 360 browser HTTP: ${row.reference}`);
      const payload = await response.json();
      const order = payload.order;
      assert.equal(order.reference, row.reference);
      assert.equal(order.market.code, row.market);
      assert.equal(order.payment.status, row.payment_status);
      const currency = row.market === 'KM' ? 'KMF' : 'XAF';
      const amount = currency === 'KMF' ? Number(row.total_kmf) : Number(row.display_total_amount);
      assert.ok(Number.isFinite(amount) && amount > 0, 'Persistent market amount missing');
      if (currency !== 'KMF') {
        assert.equal(row.display_currency, currency);
        assert.equal(order.payment.market_total_available, true);
        assert.equal(order.payment.market_currency, currency);
        assert.equal(Number(order.payment.market_total), amount);
      } else assert.equal(Number(order.payment.total_kmf), amount);
      await page.getByRole('heading', { name: row.reference, exact: true }).waitFor();
      const metric = page.getByText('Total client', { exact: true }).locator('..');
      const rendered = await metric.innerText();
      const expected = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(amount);
      const normalize = value => value.replace(/[\s\u00a0\u202f]/g, '');
      assert.ok(normalize(rendered).includes(normalize(`${expected} ${currency}`)), 'Displayed total differs from PostgreSQL');
      // Crop to the financial metric; never publish customer details or authentication state.
      await metric.screenshot({ path: path.join(OUT, `${row.market}-total.png`) });
      report.orders.push({ reference: row.reference, market: row.market, amount, currency, status: row.status, payment_status: row.payment_status, http_status: response.status(), verdict: 'ORDER360_READONLY_UI_HTTP_PG_PASS' });
      save();
    }
    assert.deepEqual(await snapshot(), before, 'Business state changed during read-only check');
    await runtime();
    assert.equal(report.blocked_mutations.length, 0, 'Unexpected business mutation attempted');
    report.verdict = 'ORDER360_READONLY_UI_HTTP_PG_PASS_NOT_PAYMENT_OR_PICKUP_GO';
  } catch (error) {
    // Assertion messages contain only fixed check labels/references, never responses or credentials.
    report.error = String(error.message).split('\n')[0];
    process.exitCode = 1;
  } finally {
    save();
    if (browser) await browser.close();
    await db.pool.end();
  }
}
if (require.main === module) main().catch(() => { process.stderr.write('Order 360 preflight failed; no business certification.\n'); process.exitCode = 1; });
