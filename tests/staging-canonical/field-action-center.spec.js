/**
 * @komerce-arch-lite
 * @role live-staging-agent-action-center-nav-proof
 * @domain dashboard
 * @layer e2e
 * @owner backend-core
 * @purpose Certifier la vraie navigation À traiter des rôles terrain sans écriture métier.
 * @impact-areas dashboard, staging-only, authorization
 */
'use strict';

const { test, expect } = require('@playwright/test');

const FIELD_ROLES = new Set(['agent_hub', 'agent_relais', 'agent_transitaire']);
const BASE = 'https://komerce-backend-production.up.railway.app';

test('field Action Center navigation is reachable without Dashboard authority', async ({ page }, info) => {
  const role = info.project.name.replace(/-(mobile|desktop)$/, '');
  test.skip(!FIELD_ROLES.has(role), 'Only dedicated field identities may run this proof');

  expect(new URL(process.env.E2E_STAGING_BASE_URL || BASE).origin).toBe(BASE);
  const expectedSha = process.env.E2E_EXPECTED_DEPLOY_SHA;
  expect(expectedSha).toMatch(/^[a-f0-9]{40}$/i);
  const versionResponse = await page.request.get('/health/version');
  expect(versionResponse.ok()).toBe(true);
  const version = await versionResponse.json();
  expect(String(version.commit || version.sha)).toBe(expectedSha);

  const prefix = 'E2E_' + role.toUpperCase() + '_';
  const email = process.env[prefix + 'EMAIL'];
  const password = process.env[prefix + 'PASSWORD'];
  expect(email).toBeTruthy();
  expect(password).toBeTruthy();

  // No business writes; login POST is the only allowed mutation-shaped request.
  const blocked = [];
  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== BASE || ['GET', 'HEAD', 'OPTIONS'].includes(request.method())
      || (request.method() === 'POST' && url.pathname === '/api/auth/login')) {
      return route.continue();
    }
    blocked.push(request.method() + ' ' + url.pathname);
    return route.abort('blockedbyclient');
  });

  const apiErrors = [];
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === BASE && url.pathname.startsWith('/api/') && response.status() >= 500) {
      apiErrors.push(url.pathname + ': ' + response.status());
    }
  });

  await page.goto('/login.html?next=' + encodeURIComponent('/admin/hub'), { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  const loginResponse = page.waitForResponse(r =>
    new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST');
  await page.locator('#btn-submit').click();
  expect((await loginResponse).status()).toBe(200);
  await page.waitForURL(url => url.pathname !== '/login.html', { timeout: 15000 });

  await page.goto('/admin/hub', { waitUntil: 'domcontentloaded' });
  const actionLink = page.locator('a[href="/admin/action-center"]').first();
  await expect(actionLink).toBeVisible({ timeout: 18000 });
  await actionLink.click();
  await expect(page).toHaveURL(/\/admin\/action-center(?:[?#]|$)/, { timeout: 12000 });
  await expect(page.locator('#canonical-admin-root.kmc-action-center[data-action-center-mode="agent"]'))
    .toBeVisible({ timeout: 18000 });

  // Direct URL and clicking its visible link must follow the same role boundary.
  await page.goto('/admin/action-center', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#canonical-admin-root.kmc-action-center[data-action-center-mode="agent"]'))
    .toBeVisible({ timeout: 18000 });
  await expect(page).toHaveURL(/\/admin\/action-center(?:[?#]|$)/);

  const matrix = await page.request.get('/api/market-delegation/central/team-matrix');
  expect(matrix.status()).toBe(403);
  expect(blocked).toEqual([]);
  expect(apiErrors).toEqual([]);
});
