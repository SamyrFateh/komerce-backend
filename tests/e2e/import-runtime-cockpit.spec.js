/**
 * @e2e   import-runtime-cockpit.spec.js
 * @feature sourcing, dashboard (cockpit live imports)
 * @brief Conformité visuelle du cockpit imports au mock noir 1672×941 : ordre des zones,
 *        lisibilité (contraste), absence de débordement, drill-downs cliquables.
 *        API simulée : aucun serveur ni base requis.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';
const CSS = ['base', 'canonical-theme-v2', 'canonical-shell-v4', 'canonical-legacy-theme-v1', 'cockpit-legacy-v1', 'import-runtime'];

const now = Date.now();
const iso = (minutesAgo) => new Date(now - minutesAgo * 60000).toISOString();

const payload = {
  source_controls: [{
    source_ref: 'api:aliexpress', label: 'AliExpress', autopilot_enabled: true, autopilot_ready: true,
    activation_ready: true, blocker: null, preparation_required: [], last_capture_at: iso(3),
  }],
  lots: [{ run_ref: 'KIR-000009', provider: 'AliExpress', source_total: 712, business_status: 'RUNNING' }],
  selected: {
    run_ref: 'KIR-000009', provider: 'AliExpress', status: 'RUNNING', started_at: iso(12), progress_pct: 64,
    accounting: {
      source_total: 712, accepted: 456, duplicates: 23, rejected: 4, quarantined: 2, deferred: 0,
      certification_blocked: 0, refined: 300, taxonomized: 120, certified: 0, catalogued: 0, awaiting_catalogue_promotion: 0,
    },
    business: { run_ref: 'KIR-000009', business_status: 'RUNNING', promoted_products: 0,
      decisions: { catalogue: 0, commercial: 0, exceptions: 0 }, closure: { eligible: false, remaining_products: 0 }, products: [] },
    stages: [
      { key: 'SOURCE_CONNECTED', status: 'COMPLETED', processed: 1, total: 1, started_at: iso(12), finished_at: iso(11) },
      { key: 'RAW_IMPORT', status: 'COMPLETED', processed: 712, total: 712, started_at: iso(11), finished_at: iso(5) },
      { key: 'REFINERY', status: 'RUNNING', processed: 300, total: 456, started_at: iso(5), finished_at: null },
      { key: 'TAXONOMY', status: 'PENDING', processed: 0, total: 0 },
      { key: 'CERTIFICATION', status: 'PENDING', processed: 0, total: 0 },
      { key: 'CATALOGUE', status: 'PENDING', processed: 0, total: 0 },
    ],
    events: [
      { at: iso(1), stage: 'REFINERY', kind: 'STAGE_STARTED' },
      { at: iso(5), stage: 'RAW_IMPORT', kind: 'STAGE_FINISHED' },
    ],
    current_item: { product_ref: 'P-1', product_name: 'Tefal OptiGrill+ XL', supplier_product_id: 'AMZ-784512', stage: 'REFINERY', state: 'en cours', komerce_category: 'Cuisine > Grill', updated_at: iso(0) },
    recent_items: [
      { product_ref: 'P-1', product_name: 'Tefal OptiGrill+ XL', supplier_product_id: 'AMZ-784512', stage: 'REFINERY', state: 'en cours', komerce_category: 'Cuisine', updated_at: iso(0) },
      { product_ref: 'P-2', product_name: 'Krups EA8', supplier_product_id: 'AMZ-1', stage: 'REFINERY', state: 'OK', komerce_category: 'Cuisine', updated_at: iso(1) },
    ],
  },
};

async function mountCockpit(page) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/admin/import-runtime') {
      const links = CSS.map((n) => `<link rel="stylesheet" href="/dashboards/canonical/css/${n}.css">`).join('');
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="fr"><head><meta charset="utf-8">${links}</head>
          <body class="kmc-shell-v4"><main id="canonical-admin-root"></main>
          <script src="/dashboards/canonical/js/import-runtime.js"></script></body></html>`,
      });
    }
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file)
        ? route.fulfill({ path: file })
        : route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto(`${ORIGIN}/admin/import-runtime?run=KIR-000009`);
  await page.evaluate((data) => {
    const root = document.getElementById('canonical-admin-root');
    window.KomerceCanonicalImportRuntime.render(root, data);
  }, payload);
}

test.describe('Cockpit imports — conformité au mock noir', () => {
  test.beforeEach(async ({ page }) => { await mountCockpit(page); });

  test('les zones suivent l’ordre du mock, activité live visible sans scroller loin', async ({ page }) => {
    const tops = await page.evaluate(() => {
      const y = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? null;
      return {
        hero: y('.kir-hero'), flow: y('.kir-run-flow'), truth: y('.kir-run-truth'), progress: y('.kir-run-progress'),
        activity: y('.kir-live-activity'), current: y('.kir-current-item'),
        recent: y('.kir-recent-items'), secondary: y('.kir-secondary'),
      };
    });
    expect(tops.hero).toBeLessThan(tops.flow);
    expect(tops.flow).toBeLessThan(tops.truth);
    expect(tops.truth).toBeLessThan(tops.progress);
    expect(tops.progress).toBeLessThan(tops.activity);
    expect(Math.abs(tops.activity - tops.current)).toBeLessThan(4);
    expect(tops.activity).toBeLessThan(tops.recent);
    expect(tops.recent).toBeLessThan(tops.secondary);
    expect(tops.activity).toBeLessThan(941);
  });

  test('fond noir de bout en bout, titre lisible, pas de carte blanche', async ({ page }) => {
    const info = await page.evaluate(() => {
      const bg = (el) => getComputedStyle(el).backgroundColor;
      const page = document.querySelector('.kir-page');
      const h1 = document.querySelector('.kir-hero h1');
      return { pageBg: bg(page), bodyBg: bg(document.body), h1Color: getComputedStyle(h1).color };
    });
    expect(info.pageBg).toBe('rgba(0, 0, 0, 0)');
    expect(info.bodyBg).toBe('rgb(7, 17, 31)');
    const [r, g, b] = info.h1Color.match(/\d+/g).map(Number);
    expect((r + g + b) / 3).toBeGreaterThan(200);
  });

  test('rail de progression et étapes en attente restent sombres (pas de règle claire résiduelle)', async ({ page }) => {
    const colors = await page.evaluate(() => ({
      track: getComputedStyle(document.querySelector('.kir-run-progress-track')).backgroundColor,
      pending: getComputedStyle(document.querySelector('.kir-run-flow-step.is-pending .kir-run-flow-marker')).backgroundColor,
    }));
    expect(colors.track).toBe('rgb(23, 38, 58)');
    expect(colors.pending).toBe('rgb(12, 25, 40)');
  });

  test('LIVE à côté du titre, progression globale avec le ratio réel de l’étape active', async ({ page }) => {
    await expect(page.locator('.kir-live-titlerow .kir-live-badge')).toHaveText('LIVE');
    await expect(page.locator('.kir-run-progress')).toContainText('64 %');
    await expect(page.locator('.kir-run-progress')).toContainText('Raffinerie · 300 / 456');
    await expect(page.locator('.kir-run-progress')).not.toContainText('produits traités');
  });

  test('activité : phrases métier avec durées réelles, aucun libellé technique', async ({ page }) => {
    const text = await page.locator('.kir-live-activity').innerText();
    expect(text).not.toMatch(/STAGE_|REFINERY|RAW_IMPORT/);
    expect(text).toContain('23 doublon(s)');
    expect(text).toMatch(/\d+ min \d{2} s|\d+ s/);
    await expect(page.locator('.kir-current-item')).toContainText('Dernier produit mis à jour');
  });

  test('zone secondaire : contrôle Sourcing et synthèse restent lisibles sur fond sombre', async ({ page }) => {
    const c = await page.evaluate(() => {
      const cs = (sel) => getComputedStyle(document.querySelector(sel));
      return {
        controlBg: cs('.kir-secondary .kir-source-control').backgroundColor,
        titleColor: cs('.kir-source-control-title strong').color,
        closure: cs('.kir-lot-summary > div:nth-child(4) strong').color,
      };
    });
    expect(c.controlBg).toBe('rgb(10, 22, 37)');
    for (const color of [c.titleColor, c.closure]) {
      const [r, g, b] = color.match(/\d+/g).map(Number);
      expect((r + g + b) / 3).toBeGreaterThan(200);
    }
  });

  test('cinq KPI réels, une seule étape courante, aucun débordement horizontal', async ({ page }) => {
    await expect(page.locator('.kir-run-truth-grid > a')).toHaveCount(5);
    await expect(page.locator('.kir-run-flow-step.is-current')).toHaveCount(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('pipeline, KPI, événements et produit courant ouvrent un drill-down du même lot', async ({ page }) => {
    const hrefs = await page.$$eval(
      '.kir-run-flow-step, .kir-run-truth-grid > a, .kir-live-event',
      (els) => els.map((el) => el.getAttribute('href')),
    );
    expect(hrefs.length).toBeGreaterThanOrEqual(13);
    for (const href of hrefs) expect(href).toContain('run=KIR-000009');
  });

  test('capture de revue 1672×941', async ({ page }, testInfo) => {
    await page.screenshot({ path: testInfo.outputPath('import-runtime-cockpit.png') });
  });
});
