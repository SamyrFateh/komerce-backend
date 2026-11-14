/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 * B2/B4 #3721: real Chromium DOM injection regression + actual CSP enforcement.
 * Mocked same-origin responses avoid relying on credentials or staging data.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { buildHelmetOptions } = require('../../bootstrap/security');
const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const BAD_NAME = '<img src=x onerror=window.__komerceXss=1>';
const now = new Date().toISOString();

test.describe('B2 / HB-09 — écran Hub historique fermé', () => {
  for (const entry of ['/hub/', '/hub/index.html']) {
    test(entry + ' redirige vers /admin/hub sans charger l’ancien writer ni du HTML client hostile', async ({ page }) => {
      const requested = [];
      await page.route('**/*', async route => {
        const pathname = new URL(route.request().url()).pathname;
        requested.push(pathname);
        if (pathname === '/hub/' || pathname === '/hub/index.html') {
          return route.fulfill({
            status: 200, contentType: 'text/html',
            body: fs.readFileSync(path.join(PUBLIC, 'hub/index.html'), 'utf8'),
          });
        }
        if (pathname === '/admin/hub') {
          return route.fulfill({
            status: 200, contentType: 'text/html',
            body: '<!doctype html><html><body><main id="canonical-hub">Hub canonique</main></body></html>',
          });
        }
        return route.abort();
      });

      await page.goto('http://komerce.test' + entry, { waitUntil: 'load' });
      await expect(page).toHaveURL('http://komerce.test/admin/hub');
      await expect(page.locator('#canonical-hub')).toContainText('Hub canonique');
      expect(requested).not.toContain('/hub/js/hub.js');
      expect(requested.filter(p => p.startsWith('/api/hub-dash/'))).toEqual([]);
      expect(await page.evaluate(() => window.__komerceXss || 0)).toBe(0);
    });
  }
});

test('B2 — HubRelais admin renders hostile names without executable image nodes', async ({ page }) => {
  await page.setContent('<main id="root"></main>');
  await page.evaluate(({ bad, at }) => {
    const order = {
      reference: 'KOM-B2', status: 'pending', client_name: bad,
      nb_items: 1, total_kmf: 12500, created_at: at,
      payment_mode: 'cash_relais', payment_status: 'pending', relais_island: 'Anjouan',
    };
    const parcel = {
      reference: 'BOX-B2', status: 'available', recipient_name: bad,
      main_order_ref: 'KOM-B2', destination_island: 'Anjouan',
      nb_items: 1, total_kmf: 12500, created_at: at,
    };
    window.KmcApi = {
      getPipeline: async () => ({ pipeline: {
        pending: { orders: [order] }, confirmed: { orders: [] }, ordered: { orders: [] },
      } }),
      getParcels: async () => ({ parcels: [parcel] }),
      getDistribution: async () => ({ parcels: [], unassigned: [], saturated: [] }),
    };
  }, { bad: BAD_NAME, at: now });
  await page.addScriptTag({
    path: path.join(PUBLIC, 'dashboards/admin/js/views/HubRelaisView.js'),
  });
  await page.evaluate(() => window.HubRelaisView.render(document.getElementById('root')));
  await expect(page.locator('.forecast-content')).toContainText(BAD_NAME);
  await expect(page.locator('#root img')).toHaveCount(0);
  await page.locator('.hr-mode-btn[data-mode="relais"]').click();
  await expect(page.locator('.hr-relais-wrapper')).toContainText(BAD_NAME);
  await expect(page.locator('#root img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__komerceXss || 0)).toBe(0);
});

test('B4 — real Chromium loads bundled Chart.js, blocks HTTP images and jsDelivr scripts', async ({ page }) => {
  const d = buildHelmetOptions().contentSecurityPolicy.directives;
  const policy = [
    'default-src ' + d.defaultSrc.join(' '),
    'img-src ' + d.imgSrc.join(' '),
    'script-src ' + d.scriptSrc.join(' '),
    'connect-src ' + d.connectSrc.join(' '),
  ].join('; ');
  await page.addInitScript(() => {
    window.__cspBlocked = [];
    document.addEventListener('securitypolicyviolation', event => {
      window.__cspBlocked.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
    });
  });
  await page.route('http://komerce.test/csp-check', route => route.fulfill({
    status: 200, contentType: 'text/html',
    headers: { 'Content-Security-Policy': policy },
    body: '<!doctype html><html><body><script src="/chart.umd.min.js"></script></body></html>',
  }));
  await page.route('http://komerce.test/chart.umd.min.js', route => route.fulfill({
    status: 200, contentType: 'application/javascript',
    body: fs.readFileSync(path.join(PUBLIC, 'chart.umd.min.js'), 'utf8'),
  }));
  await page.goto('http://komerce.test/csp-check', { waitUntil: 'load' });
  expect(await page.evaluate(() => typeof window.Chart)).toBe('function');
  await page.evaluate(() => {
    const image = document.createElement('img');
    image.src = 'http://insecure.example.invalid/a.png';
    document.body.appendChild(image);
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/evil.js';
    document.body.appendChild(script);
  });
  await expect.poll(() => page.evaluate(
    () => window.__cspBlocked.some(v => v.directive === 'img-src' && v.blocked.startsWith('http:'))
  )).toBe(true);
  await expect.poll(() => page.evaluate(
    () => window.__cspBlocked.some(v => v.directive.startsWith('script-src') && v.blocked.includes('cdn.jsdelivr.net'))
  )).toBe(true);
});
