/**
 * @e2e   hub-live-cockpit.spec.js
 * @feature dashboard (cockpit Live Hub)
 * @brief Navigation et rendu du cockpit Hub : Suivi → file → commande, retours contextuels,
 *        Back/Forward, responsive. API simulée : aucun serveur ni base requis.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';
const CSS = ['base', 'canonical-theme-v2', 'canonical-shell-v4', 'canonical-legacy-theme-v1', 'cockpit-legacy-v1', 'import-runtime', 'live-kit'];

const order = (n, over = {}) => ({
  id:`o-${n}`, reference:`KMC-000${n}`, status:'confirmed', client_name:`Client ${n}`, relais_name:'Relais Moroni', destination_island:'Grande Comore',
  payment_mode:'cash_relais', payment_status:'pending', age_hours:60, items_count:3, items_assigned:1, completeness:'partial',
  parcels_count:1, open_incidents:0, ...over,
});
const dashboard = { orders:{ to_prepare:7, in_preparation:2, shipped_total:11, shipped_today:3, urgent:2, cash_pending:4 }, parcels:{ at_relay:5 }, incidents:{ open:3, critical:1 } };
const detail = (n) => ({ ...order(n), status:'preparation', total_kmf:15000, meta:{ age_hours:60, items_assigned:1, items_count:3, parcels_count:1 },
  items:[{ product_name:'Coque', quantity:2, stock_status:'ok' }], parcels:[{ reference:'P-1', status:'draft', items:[{}], shipped_at:null }],
  timeline:[{ step:'prep_start', scanned_by_name:'Agent', created_at:new Date().toISOString() }], incidents:[] });

async function mountHub(page, search = '') {
  const state = { calls:[], writes:[] };
  await page.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') state.writes.push(`${req.method()} ${url.pathname}`);
    if (url.pathname === '/admin/hub-live') {
      const links = CSS.map((n) => `<link rel="stylesheet" href="/dashboards/canonical/css/${n}.css">`).join('');
      return route.fulfill({ contentType:'text/html', body:`<!doctype html><html lang="fr"><head><meta charset="utf-8">${links}</head>
        <body class="kmc-shell-v4"><main id="root"></main><script src="/dashboards/canonical/js/live-kit.js"></script><script src="/dashboards/canonical/js/hub-live.js"></script></body></html>` });
    }
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path:file }) : route.fulfill({ status:404, body:'' });
    }
    if (url.pathname === '/api/hub-dash/dashboard') { state.calls.push('dashboard'); return route.fulfill({ contentType:'application/json', body:JSON.stringify(dashboard) }); }
    if (url.pathname === '/api/hub-dash/queue') {
      const tab = url.searchParams.get('tab');
      state.calls.push(`queue:${tab}`);
      const limit = Number(url.searchParams.get('limit') || 25);
      const rows = tab === 'blocked' ? [order(8, { open_incidents:1 }), order(9, { open_incidents:2 })] : [order(1), order(2), order(3, { status:'preparation', age_hours:5 })];
      return route.fulfill({ contentType:'application/json', body:JSON.stringify({ data:rows.slice(0, limit), pagination:{ page:Number(url.searchParams.get('page') || 1), pages:2, total:tab === 'blocked' ? 2 : 40 }, tab }) });
    }
    const m = url.pathname.match(/^\/api\/hub-dash\/orders\/o-(\d+)$/);
    if (m) { state.calls.push(`order:o-${m[1]}`); return route.fulfill({ contentType:'application/json', body:JSON.stringify(detail(m[1])) }); }
    return route.fulfill({ status:404, body:'{}' });
  });
  await page.setViewportSize({ width:1672, height:941 });
  await page.goto(`${ORIGIN}/admin/hub-live${search}`);
  await page.evaluate(() => window.KomerceCanonicalHubLive.mount({ root:document.getElementById('root') }));
  return state;
}

const crumb = (page) => page.locator('.kir-breadcrumb').innerText().then((s) => s.replace(/\s*›\s*/g, ' > ').replace(/\s+/g, ' ').trim());

test.describe('Cockpit Hub — navigation canonique', () => {
  test('Suivi : flux, chiffres, signaux, file à traiter en premier', async ({ page }) => {
    await mountHub(page);
    await expect(page.locator('.kir-hero h1')).toContainText('Suivi du Hub');
    await expect(page.locator('.kir-domain-nav .is-active')).toHaveText('Suivi');
    await expect(page.locator('.lk-pb-stage')).toHaveCount(4);
    await expect(page.locator('.kir-run-truth-grid > *')).toHaveCount(4);
    await expect(page.locator('.lk-signals')).toContainText('4 cash à sécuriser');
    await expect(page.locator('.lk-block tbody tr')).toHaveCount(3);
    await page.screenshot({ path:'test-results/hub-live-cockpit-suivi.png' });
  });

  test('Suivi → À préparer → commande → Retour à la file → Retour au suivi', async ({ page }) => {
    const state = await mountHub(page);
    await page.locator('.kir-run-truth-grid > a', { hasText:'À préparer' }).click();
    await expect(page).toHaveURL(/view=queue.*tab=to_prepare/);
    expect(await crumb(page)).toBe('Hub > Suivi > Commandes à préparer');
    await expect(page.locator('.kir-back')).toHaveText('← Retour au suivi');
    await expect(page.locator('.kir-domain-nav .is-active')).toHaveText('Suivi');
    await page.locator('.lk-table a', { hasText:'KMC-0001' }).click();
    await expect(page.locator('.kir-drill-head h2')).toHaveText('KMC-0001');
    expect(await crumb(page)).toBe('Hub > Suivi > Commandes à préparer > KMC-0001');
    await expect(page.locator('.kir-back')).toHaveText('← Retour à Commandes à préparer');
    await expect(page.locator('.kir-main')).toContainText('Coque');
    await page.locator('.kir-back').click();
    await expect(page).toHaveURL(/view=queue.*tab=to_prepare/);
    await page.locator('.kir-back').click();
    await expect(page.locator('.kir-hero h1')).toContainText('Suivi du Hub');
    expect(state.writes).toEqual([]);
  });

  test('Back / Forward : Suivi → file → commande → Back → Back → Forward', async ({ page }) => {
    await mountHub(page);
    await page.locator('.kir-run-truth-grid > a', { hasText:'En préparation' }).click();
    await page.locator('.lk-table a').first().click();
    await expect(page.locator('.kir-drill-head h2')).toContainText('KMC-');
    await page.goBack();
    await expect(page).toHaveURL(/view=queue.*tab=preparation/);
    await page.goBack();
    await expect(page.locator('.kir-hero h1')).toContainText('Suivi du Hub');
    await page.goForward();
    await expect(page).toHaveURL(/view=queue.*tab=preparation/);
  });

  test('Commandes : onglet de 1er niveau sans bouton retour, commande revient à Commandes', async ({ page }) => {
    await mountHub(page);
    await page.locator('.kir-domain-nav a', { hasText:'Commandes' }).click();
    await expect(page.locator('.kir-domain-nav .is-active')).toHaveText('Commandes');
    await expect(page.locator('.kir-back')).toHaveCount(0);
    await page.locator('.lk-table a').first().click();
    await expect(page.locator('.kir-domain-nav .is-active')).toHaveText('Commandes');
    await expect(page.locator('.kir-back')).toHaveText('← Retour à Commandes');
    await page.locator('.kir-back').click();
    await expect(page.locator('.kir-domain-nav .is-active')).toHaveText('Commandes');
    await page.locator('.kir-domain-nav a', { hasText:'Suivi' }).click();
    await expect(page.locator('.kir-hero')).toHaveCount(1);
  });

  test('pagination : plus anciens garde la file', async ({ page }) => {
    await mountHub(page, '?view=queue&tab=ready');
    await page.getByText('Plus anciens →').click();
    await expect(page).toHaveURL(/tab=ready.*page=2/);
    await expect(page.locator('.kir-passage-pagination')).toContainText('Page 2 / 2');
  });

  test('lecture seule : aucune requête d’écriture, jamais de bouton d’action', async ({ page }) => {
    const state = await mountHub(page, '?view=order&order=o-1&from=to_prepare');
    await expect(page.locator('.kir-drill-head h2')).toHaveText('KMC-0001');
    await expect(page.locator('.kir-main button')).toHaveCount(0);
    expect(state.writes).toEqual([]);
  });

  for (const [name, width, height] of [['1280', 1280, 800], ['1024', 1024, 768], ['mobile', 390, 844]]) {
    test(`responsive ${name} : aucun débordement`, async ({ page }) => {
      await mountHub(page);
      await page.setViewportSize({ width, height });
      await expect(page.locator('.lk-pb-stage')).toHaveCount(4);
      const geo = await page.evaluate(() => ({ scroll:document.documentElement.scrollWidth, inner:window.innerWidth,
        blocks:[...document.querySelectorAll('.kir-run-flow, .kir-run-truth, .lk-block')].map((el) => Math.round(el.getBoundingClientRect().right)) }));
      expect(geo.scroll).toBeLessThanOrEqual(geo.inner);
      for (const right of geo.blocks) expect(right).toBeLessThanOrEqual(geo.inner);
    });
  }
});
