/**
 * @e2e   relais-live-cockpit.spec.js
 * @feature dashboard (cockpit Live Relais)
 * @brief Navigation et rendu du cockpit Relais : Suivi → liste → colis, retours contextuels,
 *        Back/Forward, lecture seule, responsive. API simulée : aucun serveur ni base requis.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';
const CSS = ['base', 'canonical-theme-v2', 'canonical-shell-v4', 'canonical-legacy-theme-v1', 'cockpit-legacy-v1', 'import-runtime', 'live-kit'];

const order = (n, over = {}) => ({
  id:`r-${n}`, reference:`KMC-0${100 + n}`, status:'available', client_nom:`Client ${n}`, relais_nom:'Relais Mitsamiouli', ile:'Grande Comore',
  heures_attente:80, age_jours:4, urgence:'haute', nb_items:2, cash_pending:true, payment_status:'pending', incidents_ouverts:0, ...over,
});
const dashboard = { kpi:{ en_transit:4, disponibles:9, cash_a_encaisser:3, montant_cash_pending:45000, collectes_aujourd_hui:2, collectes_7j:14, en_attente_72h:2, total_actives:20, incidents_ouverts:1 }, alertes:[] };
const detail = (n) => ({ order:{ id:`r-${n}`, reference:`KMC-0${100 + n}`, status:'available', heures_attente:80, age_jours:4 }, client:{ nom:`Client ${n}` },
  relais:{ nom:'Relais Mitsamiouli', ile:'Grande Comore' }, paiement:{ cash_pending:true, total_kmf:12000 }, items:[{ produit:'Coque', quantity:1, prix_kmf:12000 }], timeline:[], incidents:[] });

async function mountRelay(page, search = '') {
  const state = { calls:[], writes:[] };
  await page.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') state.writes.push(`${req.method()} ${url.pathname}`);
    if (url.pathname === '/admin/relais-live') {
      const links = CSS.map((n) => `<link rel="stylesheet" href="/dashboards/canonical/css/${n}.css">`).join('');
      return route.fulfill({ contentType:'text/html', body:`<!doctype html><html lang="fr"><head><meta charset="utf-8">${links}</head>
        <body class="kmc-shell-v4"><main id="root"></main><script src="/dashboards/canonical/js/live-kit.js"></script><script src="/dashboards/canonical/js/relay-live.js"></script></body></html>` });
    }
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path:file }) : route.fulfill({ status:404, body:'' });
    }
    if (url.pathname === '/api/relay/dashboard') { state.calls.push('dashboard'); return route.fulfill({ contentType:'application/json', body:JSON.stringify(dashboard) }); }
    if (url.pathname === '/api/relay/orders') {
      const status = url.searchParams.get('status');
      const offset = Number(url.searchParams.get('offset') || 0);
      state.calls.push(`orders:${status || 'all'}:${offset}`);
      const limit = Number(url.searchParams.get('limit') || 25);
      const length = limit === 25 && offset > 0 ? 3 : limit;
      const rows = Array.from({ length }, (_, i) => order(i + 1 + offset));
      return route.fulfill({ contentType:'application/json', body:JSON.stringify({ total:rows.length, orders:rows }) });
    }
    const m = url.pathname.match(/^\/api\/relay\/orders\/r-(\d+)$/);
    if (m) { state.calls.push(`order:r-${m[1]}`); return route.fulfill({ contentType:'application/json', body:JSON.stringify(detail(Number(m[1]))) }); }
    return route.fulfill({ status:404, body:'{}' });
  });
  await page.setViewportSize({ width:1672, height:941 });
  await page.goto(`${ORIGIN}/admin/relais-live${search}`);
  await page.evaluate(() => window.KomerceCanonicalRelayLive.mount({ root:document.getElementById('root') }));
  return state;
}

const crumb = (page) => page.locator('.kir-breadcrumb').innerText().then((s) => s.replace(/\s*›\s*/g, ' > ').replace(/\s+/g, ' ').trim());

test.describe('Cockpit Relais — navigation canonique', () => {
  test('Suivi : flux, chiffres, signaux, colis à retirer en premier', async ({ page }) => {
    await mountRelay(page);
    await expect(page.locator('.kir-hero h1')).toContainText('Suivi des Relais');
    await expect(page.locator('.kir-domain-nav .is-active')).toHaveText('Suivi');
    await expect(page.locator('.lk-pb-stage')).toHaveCount(3);
    await expect(page.locator('.kir-run-truth-grid > *')).toHaveCount(4);
    await expect(page.locator('.lk-signals')).toContainText('14 retirés sur 7 jours');
    await expect(page.locator('.lk-block tbody tr')).toHaveCount(5);
    await page.screenshot({ path:'test-results/relais-live-cockpit-suivi.png' });
  });

  test('Suivi → Disponibles → colis → Retour à la liste → Retour au suivi', async ({ page }) => {
    const state = await mountRelay(page);
    await page.locator('.kir-run-truth-grid > a', { hasText:'Disponibles' }).click();
    await expect(page).toHaveURL(/view=orders.*list=available/);
    expect(await crumb(page)).toBe('Relais > Suivi > Disponibles au retrait');
    await expect(page.locator('.kir-back')).toHaveText('← Retour au suivi');
    await page.locator('.lk-table a', { hasText:/^KMC-0101$/ }).click();
    await expect(page.locator('.kir-drill-head h2')).toHaveText('KMC-0101');
    expect(await crumb(page)).toBe('Relais > Suivi > Disponibles au retrait > KMC-0101');
    await expect(page.locator('.kir-back')).toHaveText('← Retour à Disponibles au retrait');
    await page.locator('.kir-back').click();
    await expect(page).toHaveURL(/view=orders.*list=available/);
    await page.locator('.kir-back').click();
    await expect(page.locator('.kir-hero h1')).toContainText('Suivi des Relais');
    expect(state.writes).toEqual([]);
  });

  test('Back / Forward : Suivi → liste → colis → Back → Back → Forward', async ({ page }) => {
    await mountRelay(page);
    await page.locator('.kir-run-truth-grid > a', { hasText:'En transit' }).click();
    await page.locator('.lk-table a').first().click();
    await expect(page.locator('.kir-drill-head h2')).toContainText('KMC-');
    await page.goBack();
    await expect(page).toHaveURL(/list=in_transit/);
    await page.goBack();
    await expect(page.locator('.kir-hero h1')).toContainText('Suivi des Relais');
    await page.goForward();
    await expect(page).toHaveURL(/list=in_transit/);
  });

  test('Colis : onglet de 1er niveau sans retour ; le colis revient à Colis', async ({ page }) => {
    await mountRelay(page);
    await page.locator('.kir-domain-nav a', { hasText:'Colis' }).click();
    await expect(page.locator('.kir-domain-nav .is-active')).toHaveText('Colis');
    await expect(page.locator('.kir-back')).toHaveCount(0);
    await page.locator('.lk-table a').first().click();
    await expect(page.locator('.kir-back')).toHaveText('← Retour à Colis');
    await expect(page.locator('.kir-domain-nav .is-active')).toHaveText('Colis');
    await page.locator('.kir-back').click();
    await page.locator('.kir-domain-nav a', { hasText:'Suivi' }).click();
    await expect(page.locator('.kir-hero')).toHaveCount(1);
  });

  test('pagination : plus anciens avance le décalage, plus récents revient', async ({ page }) => {
    await mountRelay(page, '?view=orders&list=available');
    await page.getByText('Plus anciens →').click();
    await expect(page).toHaveURL(/offset=25/);
    await page.getByText('← Plus récents').click();
    await expect(page).not.toHaveURL(/offset=25/);
  });

  test('lecture seule : aucune requête d’écriture, aucun bouton', async ({ page }) => {
    const state = await mountRelay(page, '?view=order&order=r-1&from=available');
    await expect(page.locator('.kir-drill-head h2')).toHaveText('KMC-0101');
    await expect(page.locator('.kir-main button')).toHaveCount(0);
    expect(state.writes).toEqual([]);
  });

  for (const [name, width, height] of [['1280', 1280, 800], ['1024', 1024, 768], ['mobile', 390, 844]]) {
    test(`responsive ${name} : aucun débordement`, async ({ page }) => {
      await mountRelay(page);
      await page.setViewportSize({ width, height });
      await expect(page.locator('.lk-pb-stage')).toHaveCount(3);
      const geo = await page.evaluate(() => ({ scroll:document.documentElement.scrollWidth, inner:window.innerWidth }));
      expect(geo.scroll).toBeLessThanOrEqual(geo.inner);
    });
  }
});
