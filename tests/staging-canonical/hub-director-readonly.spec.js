/**
 * @komerce-arch-lite
 * @role staging-hub-director-distinct-grants-readonly-proof
 * @domain dashboard
 * @layer e2e
 * @owner backend-core
 * @purpose Two isolated real Chromium sessions prove Hub Director purchase/payment
 *          grants versus ordinary Hub agent, with no business writes.
 * @impact-areas dashboard, hub, authorization, staging-only
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const ORIGIN = 'https://komerce-backend-production.up.railway.app';
const OUTPUT = path.resolve('test-results/staging-chromium/evidence/hub-director-readonly.json');

// This test must never archive user screens, traces or cookie-bearing contexts.
test.use({ screenshot: 'off', trace: 'off', video: 'off' });

test('Hub Director has two distinct grants; ordinary agent_hub has neither', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'admin-desktop', 'The dedicated director proof runs once via admin project');
  test.skip(process.env.E2E_AUDIT_QUICK === '1',
    'QUICK_READONLY proves navigation; direct Hub grants require their dedicated/full proof');

  expect(new URL(process.env.E2E_STAGING_BASE_URL || ORIGIN).origin).toBe(ORIGIN);
  const expectedSHA = process.env.E2E_EXPECTED_DEPLOY_SHA;
  expect(expectedSHA).toMatch(/^[a-f0-9]{40}$/i);

  const proof = {
    status: 'FAIL',
    changed: false,
    sha: null,
    stable_sha: false,
    director: null,
    ordinary_agent: null,
    total_blocked_writes: 0,
    total_browser_errors: 0,
  };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const save = () => fs.writeFileSync(OUTPUT, JSON.stringify(proof, null, 2) + '\n');

  async function deployedSHA() {
    const r = await request.get(ORIGIN + '/health/version', { timeout: 20000 });
    expect(r.status()).toBe(200);
    const body = await r.json();
    return String(body.commit || body.sha || '');
  }

  // Fresh browser context per identity; never reuse the previous user's cookie.
  async function auditIdentity(prefix, expectedGrants) {
    const email = process.env[prefix + 'EMAIL'];
    const password = process.env[prefix + 'PASSWORD'];
    expect(Boolean(email && password), 'Required GitHub Actions secret names must be configured').toBe(true);

    const context = await browser.newContext({ baseURL: ORIGIN, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    let blocked = 0;
    let browserErrors = 0;
    try {
      await page.route('**/*', route => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.origin !== ORIGIN || ['GET', 'HEAD', 'OPTIONS'].includes(req.method()) ||
          (req.method() === 'POST' && url.pathname === '/api/auth/login')) return route.continue();
        blocked++;
        return route.abort('blockedbyclient');
      });
      page.on('pageerror', () => { browserErrors++; });

      await page.goto('/login.html?next=' + encodeURIComponent('/admin/hub?branch=administrative'),
        { waitUntil: 'domcontentloaded' });
      await page.locator('#email').fill(email);
      await page.locator('#password').fill(password);
      const loginResponse = page.waitForResponse(r =>
        new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST',
      { timeout: 20000 });
      await page.locator('#btn-submit').click();
      const login = await loginResponse;
      expect(login.status()).toBe(200);
      await page.waitForURL(u => u.pathname !== '/login.html', { timeout: 15000 });

      const identity = await page.request.get('/api/auth/me');
      expect(identity.status()).toBe(200);
      expect((await identity.json()).role).toBe('agent_hub');

      const administration = await page.request.get('/api/hub/administration');
      expect(administration.status()).toBe(200);
      const adminData = await administration.json();
      expect(adminData.scope).toBe('HUB_ADMINISTRATION_GLOBAL');
      expect(adminData.viewer_grants).toEqual(expectedGrants);

      const board = await page.request.get('/api/hub/board');
      expect(board.status()).toBe(200);
      expect((await board.json()).scope).toBe('HUB_GLOBAL');

      // Hub permissions do not confer central administration privileges.
      const central = await page.request.get('/api/market-delegation/central/team-matrix');
      expect(central.status()).toBe(403);

      await page.goto('/admin/hub?branch=administrative', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-hub-active-branch="administrative"]'))
        .toBeVisible({ timeout: 18000 });
      expect(blocked).toBe(0);
      expect(browserErrors).toBe(0);
      return {
        login: true,
        role_agent_hub: true,
        administration_http: administration.status(),
        board_http: board.status(),
        central_admin_denied: central.status() === 403,
        purchase_commitment: adminData.viewer_grants.purchase_commitment,
        supplier_payment: adminData.viewer_grants.supplier_payment,
        browser_navigation: true,
      };
    } finally {
      proof.total_blocked_writes += blocked;
      proof.total_browser_errors += browserErrors;
      await context.close();
    }
  }

  try {
    proof.sha = await deployedSHA();
    expect(proof.sha).toBe(expectedSHA);
    proof.director = await auditIdentity('E2E_HUB_DIRECTOR_', {
      purchase_commitment: true, supplier_payment: true,
    });
    proof.ordinary_agent = await auditIdentity('E2E_AGENT_HUB_', {
      purchase_commitment: false, supplier_payment: false,
    });
    proof.stable_sha = (await deployedSHA()) === expectedSHA;
    expect(proof.stable_sha).toBe(true);
    expect(proof.total_blocked_writes).toBe(0);
    expect(proof.total_browser_errors).toBe(0);
    proof.status = 'PASS';
  } finally {
    // Only booleans, HTTP codes and the deploy SHA. No identity, PO, customer,
    // cookies, passwords or screenshots are written to the published artifact.
    save();
    console.log('[hub-director-readonly] ' + JSON.stringify(proof));
  }
});
