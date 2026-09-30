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

async function mountCockpit(page, data = payload) {
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
  }, data);
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

// État réel observé en production : run terminé, promotion Catalogue en attente,
// alerte de certification runtime. Les lignes du pipeline ne doivent pas barrer les libellés.
const done = { started_at: iso(20), finished_at: iso(19) };
const completedPayload = JSON.parse(JSON.stringify(payload));
Object.assign(completedPayload.selected, {
  status: 'COMPLETED', progress_pct: 100, finished_at: iso(1),
  diagnostics: { runtime_certified: false, pipeline_status: 'PARTIAL_BLOCKED' },
  stages: ['SOURCE_CONNECTED', 'RAW_IMPORT', 'REFINERY', 'TAXONOMY', 'CERTIFICATION', 'CATALOGUE'].map((key) => ({
    key, status: 'COMPLETED', processed: 12, total: 12, ...done,
    ...(key === 'CATALOGUE' ? { reason: 'awaiting_explicit_operator_promotion', processed: 0 } : {}),
  })),
  item_events: true,
  current_item_kind: 'last_processed',
  current_item: { product_ref: 'P-1', product_name: 'Produit récent', supplier_product_id: 'SP-1', stage: 'TAXONOMY', state: 'deferred',
    purchase_price: 7.65, currency: 'USD', duration_ms: 1200, change_kind: 'created', updated_at: iso(1) },
});
completedPayload.selected.accounting.awaiting_catalogue_promotion = 12;

test.describe('Cockpit imports — run terminé avec alerte et validation manuelle', () => {
  test.beforeEach(async ({ page }) => { await mountCockpit(page, completedPayload); });

  test('pipeline du mock : grands cercles numérotés, libellé centré dessous, trait entre les cercles', async ({ page }) => {
    const steps = await page.evaluate(() => [...document.querySelectorAll('.kir-run-flow-step')].map((step) => {
      const m = step.querySelector('.kir-run-flow-marker').getBoundingClientRect();
      const l = step.querySelector(':scope > div').getBoundingClientRect();
      return { size: m.width, sizeH: m.height, gap: l.top - m.bottom, dx: Math.abs((l.left + l.width / 2) - (m.left + m.width / 2)),
        text: step.querySelector('.kir-run-flow-marker').textContent.trim(), font: parseFloat(getComputedStyle(step.querySelector('strong')).fontSize) };
    }));
    expect(steps.length).toBe(6);
    steps.forEach((st, i) => {
      expect(st.size).toBeGreaterThanOrEqual(38);
      expect(st.sizeH).toBe(st.size);
      expect(st.gap).toBeGreaterThan(0);
      expect(st.dx).toBeLessThan(3);
      expect(st.text).toBe(String(i + 1));
      expect(st.font).toBeGreaterThanOrEqual(14);
    });
  });

  test('cartes KPI du mock : tuile d’icône colorée 64px et chiffre large', async ({ page }) => {
    const cards = await page.evaluate(() => [...document.querySelectorAll('.kir-run-truth-grid>a')].map((a) => {
      const icon = a.querySelector('.kir-ico');
      const r = icon.getBoundingClientRect();
      return { w: r.width, h: r.height, bg: getComputedStyle(icon).backgroundColor, num: parseFloat(getComputedStyle(a.querySelector('strong')).fontSize) };
    }));
    expect(cards).toHaveLength(5);
    for (const c of cards) { expect(c.w).toBeGreaterThanOrEqual(60); expect(c.h).toBeGreaterThanOrEqual(60); expect(c.num).toBeGreaterThanOrEqual(30); }
    expect(new Set(cards.map((c) => c.bg)).size).toBeGreaterThanOrEqual(4);
  });

  test('l’alerte de certification reste sombre et lisible', async ({ page }) => {
    const alert = page.locator('.kir-runtime-alert');
    await expect(alert).toBeVisible();
    const colors = await alert.evaluate((el) => ({
      bg: getComputedStyle(el).backgroundColor,
      title: getComputedStyle(el.querySelector('strong')).color,
      text: getComputedStyle(el.querySelector('span')).color,
    }));
    const lum = (c) => c.match(/\d+/g).slice(0, 3).map(Number).reduce((a, b) => a + b, 0) / 3;
    expect(lum(colors.bg)).toBeLessThan(80);
    expect(lum(colors.title)).toBeGreaterThan(140);
    expect(lum(colors.text)).toBeGreaterThan(140);
  });

  test('capture de revue du run terminé', async ({ page }) => {
    await page.screenshot({ path: 'test-results/import-runtime-cockpit-completed.png', fullPage: false });
  });
});

