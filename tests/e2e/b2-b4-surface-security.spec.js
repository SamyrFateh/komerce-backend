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

test('B2 — Hub legacy queue and detail render hostile client HTML as inert text', async ({ page }) => {
  const order = {
    id: 'order-b2', reference: 'KOM-B2', status: 'confirmed',
    created_at: now, age_hours: 1, items_qty: 1, completeness: 'complete',
    client_name: BAD_NAME, client_phone: BAD_NAME,
    destination_island: 'Anjouan', relais_name: 'Relais B2',
    payment_status: 'paid', open_incidents: 0,
  };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const reply = value => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(value),
    });
    if (pathname === '/hub/' || pathname === '/hub/index.html') {
      return route.fulfill({
        status: 200, contentType: 'text/html',
        body: fs.readFileSync(path.join(PUBLIC, 'hub/index.html'), 'utf8'),
      });
    }
    if (pathname === '/hub/js/hub.js') {
      return route.fulfill({
        status: 200, contentType: 'application/javascript',
        body: fs.readFileSync(path.join(PUBLIC, 'hub/js/hub.js'), 'utf8'),
      });
    }
    if (pathname === '/api/auth/me') return reply({ id: 'admin-b2', full_name: 'Agent' });
    if (pathname === '/api/carriers') return reply({ data: [] });
    if (pathname === '/api/hub-dash/queue') return reply({ data: [order] });
    if (pathname === '/api/hub-dash/dashboard') return reply({});
    if (pathname === '/api/hub/stats/week') return reply({ summary: {} });
    if (pathname === '/api/hub-dash/orders/order-b2') {
      return reply({ order, items: [{ id: 'item-b2', quantity: 1, product_name: BAD_NAME }], parcels: [], incidents: [] });
    }
    return route.abort();
  });
  await page.goto('http://komerce.test/hub/', { waitUntil: 'domcontentloaded' });
  const card = page.locator('.order-card').first();
  await expect(card).toContainText(BAD_NAME);
  await expect(card.locator('img')).toHaveCount(0);
  await card.click();
  await expect(page.locator('#detail-body')).toContainText(BAD_NAME);
  await expect(page.locator('#detail-body img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__komerceXss || 0)).toBe(0);
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
