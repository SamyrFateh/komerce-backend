#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch-lite
 * @role g6-a-existing-client-connection-guard
 * @domain auth-identity
 * @layer tooling
 * @owner backend-core
 * @purpose Observe the existing G6 client's missing-OTP guard through the staging UI; never provision or verify a code.
 * @db-read orders, markets, users, e2e_test_accounts, otp_codes
 * @db-write none
 */
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { confirmTarget } = require('./target-guard');
const BASE = 'https://komerce-backend-production.up.railway.app';
const OUT = path.resolve('test-results/g6-a-client-probe');

async function main() {
  assert.equal(process.env.KOMERCE_ENV, 'staging');
  assert.equal(process.env.KOMERCE_TARGET_ENV, 'staging');
  assert.equal(process.env.STAGING_BASE_URL, BASE);
  assert.match(process.env.E2E_EXPECTED_DEPLOY_SHA || '', /^[a-f0-9]{40}$/);
  const db = require('../../db');
  const report = { run_id: process.env.GITHUB_RUN_ID || null, verdict: 'NOT_PROVEN', blocked_mutations: [] };
  fs.mkdirSync(OUT, { recursive: true });
  const save = () => fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  let browser;
  const read = async (sql, params = []) => {
    const client = await db.getClient();
    try {
      await client.query('BEGIN READ ONLY');
      return await client.query(sql, params);
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  };
  const runtime = async () => {
    const response = await fetch(`${BASE}/health/version`);
    assert.equal(response.status, 200);
    const version = await response.json();
    assert.equal(version.commit, process.env.E2E_EXPECTED_DEPLOY_SHA, 'Staging SHA drift');
    return version.commit;
  };
  try {
    const target = await confirmTarget({ db });
    assert.equal(target.confirmed, true);
    report.fingerprint = target.fingerprint;
    report.runtime_sha = await runtime();
    // Private identity values are used only to fill the actual browser fields.
    // Never export them, credential material, hashes, or a pickup code.
    const { rows } = await read(`
      SELECT o.id,o.reference,m.code AS market,u.phone
      FROM orders o JOIN users u ON u.id=o.user_id JOIN markets m ON m.id=o.market_id
      WHERE o.simulation_scope='G6-BUYER' AND u.role::text='client'
        AND u.email ~* '^g6-e2e-[a-f0-9]{8}@komerce\\.test$'
        AND EXISTS(SELECT 1 FROM e2e_test_accounts e WHERE e.user_id=u.id)
        AND m.code IN ('CM','CG','KM') AND o.status::text='pending'
        AND o.payment_status::text='pending'
        AND NOT EXISTS(SELECT 1 FROM otp_codes otp WHERE otp.phone IN (u.phone,u.whatsapp_phone)
          AND otp.purpose='login' AND otp.verified=FALSE AND otp.expires_at>NOW() AND otp.attempts<5)
      ORDER BY (m.code='CM') DESC,o.reference LIMIT 1`);
    assert.equal(rows.length, 1, 'No existing marked G6 fixture for this read-only connection probe');
    const fixture = rows[0];
    report.reference = fixture.reference;
    report.market = fixture.market;
    const prefix = { CM: '+237', CG: '+242', KM: '+269' }[fixture.market];
    assert.ok(String(fixture.phone).startsWith(prefix), 'Unexpected fixture phone format');
    const snapshot = async () => {
      const result = await read(`SELECT o.status::text,o.payment_status::text,
        (SELECT COUNT(*)::int FROM otp_codes otp JOIN users u ON u.id=o.user_id
          WHERE otp.phone IN (u.phone,u.whatsapp_phone)) AS otp_rows
        FROM orders o WHERE o.id=$1`, [fixture.id]);
      return result.rows;
    };
    const before = await snapshot();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    const page = await context.newPage();
    let requestAllowed = true;
    await page.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
      if (requestAllowed && request.method() === 'POST' && url.origin === BASE && url.pathname === '/api/auth/otp/request') {
        const body = request.postDataJSON();
        if (body.phone === fixture.phone && (!body.purpose || body.purpose === 'login')) {
          requestAllowed = false;
          return route.continue();
        }
      }
      if (!(url.origin === 'https://m.stripe.com' && url.pathname === '/6')) {
        report.blocked_mutations.push({ method: request.method(), path: url.pathname });
      }
      return route.abort();
    });
    await page.goto(`${BASE}/${fixture.market}`, { waitUntil: 'domcontentloaded' });
    await page.locator('#k-header-komerce-btn').click();
    await page.locator('#k-kmc-identify').click();
    await page.locator('#k-id-phone-country').selectOption(prefix);
    await page.locator('#k-id-name').fill('Recette');
    await page.locator('#k-id-lastname').fill('G6');
    await page.locator('#k-id-phone').fill(fixture.phone.slice(prefix.length));
    const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/otp/request' && response.request().method() === 'POST');
    await page.locator('#k-id-phone-cta').click();
    const response = await responsePromise;
    const body = await response.json();
    report.request_status = response.status();
    report.guard = body.code === 'G6_OTP_FIXTURE_MISSING' ? body.code : 'UNEXPECTED_RESPONSE';
    assert.equal(response.status(), 409, 'Expected missing prepared fixture OTP guard');
    assert.equal(report.guard, 'G6_OTP_FIXTURE_MISSING');
    const error = page.locator('#k-id-err-phone');
    await page.getByText('Code de recette absent ou expiré', { exact: true }).waitFor();
    await error.screenshot({ path: path.join(OUT, 'client-otp-guard.png') });
    assert.deepEqual(await snapshot(), before, 'Fixture/OTP row counts changed');
    assert.equal(report.blocked_mutations.length, 0, 'Unexpected mutation attempted');
    await runtime();
    report.ui_guard_visible = true;
    report.verdict = 'BLOCKED_CLIENT_G6_OTP_FIXTURE_MISSING_OBSERVED_IN_CHROMIUM';
    report.no_code_verified = true;
    report.no_order_or_payment_action = true;
  } catch (error) {
    report.error = String(error.message).split('\n')[0];
    process.exitCode = 1;
  } finally {
    save();
    if (browser) await browser.close();
    await db.pool.end();
  }
}
if (require.main === module) main().catch(() => { process.stderr.write('Existing client probe preflight failed.\n'); process.exitCode = 1; });
