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
    run_ref: 'KIR-000009', provider: 'AliExpress', source_ref: 'api:aliexpress', status: 'RUNNING', started_at: iso(12), progress_pct: 64,
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
    await expect(page.locator('.kir-run-progress')).toContainText('Contrôle automatique · 300 / 456');
    await expect(page.locator('.kir-run-progress')).not.toContainText('produits traités');
  });

  test('activité : phrases métier avec durées réelles, aucun libellé technique', async ({ page }) => {
    const text = await page.locator('.kir-live-activity').innerText();
    expect(text).not.toMatch(/STAGE_|REFINERY|RAW_IMPORT|Raffinerie|Taxonomie|Certification/);
    expect(text).toContain('712 produits reçus');
    expect(text).toContain('23 doublons écartés');
    expect(text).toContain('Contrôle automatique démarré');
    await expect(page.locator('.kir-current-item')).toContainText('Dernier produit mis à jour');
  });

  test('barre de commandes : Mettre à jour (bleu, généreux) puis Arrêter (rouge sombre) quand la source est active', async ({ page }) => {
    const bar = await page.evaluate(() => {
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left, w: r.width, h: r.height, bg: getComputedStyle(el).backgroundColor, svg: Boolean(el.querySelector('svg')) };
      };
      return {
        update: box('.kir-cmd-update'), stop: box('.kir-cmd-stop'), restart: box('.kir-cmd-restart'),
        label: document.querySelector('.kir-cmd-update')?.textContent.trim(),
        state: document.querySelector('.kir-command-state')?.textContent,
        legacySwitch: Boolean(document.querySelector('[data-source-toggle]')),
      };
    });
    expect(bar.restart).toBeNull();
    expect(bar.legacySwitch).toBe(false);
    expect(bar.label).toBe('Mettre à jour maintenant');
    expect(bar.update.bg).toBe('rgb(29, 92, 214)');
    expect(bar.stop.bg).toBe('rgb(58, 18, 24)');
    for (const b of [bar.update, bar.stop]) { expect(b.h).toBeGreaterThanOrEqual(48); expect(b.svg).toBe(true); }
    expect(bar.update.w).toBeGreaterThan(bar.stop.w);
    expect(bar.update.x).toBeLessThan(bar.stop.x);
    expect(bar.state).toContain('Mise à jour en cours');
  });

  test('quatre résultats réels, une seule étape courante, aucun débordement horizontal', async ({ page }) => {
    await expect(page.locator('.kir-run-truth-grid > a')).toHaveCount(4);
    await expect(page.locator('.kir-run-flow-step.is-current')).toHaveCount(1);
    await expect(page.locator('.kir-run-flow-step.is-current')).toContainText('Contrôle automatique');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('pipeline, KPI, événements et produit courant ouvrent un drill-down du même lot', async ({ page }) => {
    const hrefs = await page.$$eval(
      '.kir-run-flow-step, .kir-run-truth-grid > a, .kir-live-event',
      (els) => els.map((el) => el.getAttribute('href')),
    );
    expect(hrefs.length).toBeGreaterThanOrEqual(10);
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
completedPayload.selected.accounting.certified = 12;
// Tout va bien : même run, sans alerte de source.
const calmPayload = JSON.parse(JSON.stringify(completedPayload));
calmPayload.selected.diagnostics = {};
calmPayload.selected.accounting = { ...calmPayload.selected.accounting, quarantined: 0, deferred: 0, certification_blocked: 0, unaccounted: 0, overflow: 0 };

test.describe('Cockpit imports — run terminé avec alerte et validation manuelle', () => {
  test.beforeEach(async ({ page }) => { await mountCockpit(page, completedPayload); });

  test('pipeline du mock : grands cercles numérotés, libellé centré dessous, trait entre les cercles', async ({ page }) => {
    const steps = await page.evaluate(() => [...document.querySelectorAll('.kir-run-flow-step')].map((step) => {
      const m = step.querySelector('.kir-run-flow-marker').getBoundingClientRect();
      const l = step.querySelector(':scope > div').getBoundingClientRect();
      return { size: m.width, sizeH: m.height, gap: l.top - m.bottom, dx: Math.abs((l.left + l.width / 2) - (m.left + m.width / 2)),
        text: step.querySelector('.kir-run-flow-marker').textContent.trim(), font: parseFloat(getComputedStyle(step.querySelector('strong')).fontSize) };
    }));
    expect(steps.length).toBe(4);
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
    expect(cards).toHaveLength(4);
    for (const c of cards) { expect(c.w).toBeGreaterThanOrEqual(60); expect(c.h).toBeGreaterThanOrEqual(60); expect(c.num).toBeGreaterThanOrEqual(30); }
    expect(new Set(cards.map((c) => c.bg)).size).toBeGreaterThanOrEqual(3);
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



test.describe('Cockpit imports — tout va bien', () => {
  test.beforeEach(async ({ page }) => { await mountCockpit(page, calmPayload); });

  test('écran calme : étapes vertes, remise propre au Catalogue, rien d’orange ni de rouge', async ({ page }) => {
    const info = await page.evaluate(() => {
      const color = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
      const h = document.querySelector('.kir-handoff');
      return {
        markers: [...document.querySelectorAll('.kir-run-flow-step .kir-run-flow-marker')].map((m) => getComputedStyle(m).backgroundColor),
        handoffText: h?.innerText.replace(/\s+/g, ' '),
        handoffBorder: h ? getComputedStyle(h).borderLeftColor : null,
        attention: document.querySelectorAll('.is-attention').length,
        failed: document.querySelectorAll('.is-failed').length,
        progress: Boolean(document.querySelector('.kir-run-progress')),
        text: document.body.innerText,
      };
    });
    expect(info.markers).toEqual(Array(4).fill('rgb(30, 215, 132)'));
    expect(info.handoffText).toContain('PASSAGE AU CATALOGUE');
    expect(info.handoffText).toContain('12 certifiés · 12 transmis · 0 écart');
    expect(info.handoffText).toContain('Terminé');
    expect(info.handoffBorder).toBe('rgb(30, 215, 132)');
    expect(info.attention).toBe(0);
    expect(info.failed).toBe(0);
    expect(info.progress).toBe(false);
    expect(info.text).toContain('12/12 produits comptabilisés'.replace('12/12', '712/712'));
    expect(info.text).not.toMatch(/Raffinerie|Taxonomie|Certification|USD|7[,.]65|Décisions commerciales|Prêts à vendre/);
  });
});

// Vrai problème : 3 produits prêts n'ont pas pu être certifiés → Komerce ne peut plus avancer seul.
const problemPayload = JSON.parse(JSON.stringify(completedPayload));
problemPayload.selected.accounting = { ...problemPayload.selected.accounting, certified: 9, awaiting_catalogue_promotion: 9 };
problemPayload.selected.stages = problemPayload.selected.stages.map((stage) => stage.key === 'CERTIFICATION'
  ? { ...stage, status: 'FAILED', processed: 9, total: 12 } : stage);
problemPayload.selected.diagnostics = {};

test.describe('Cockpit imports — vrai problème', () => {
  test.beforeEach(async ({ page }) => { await mountCockpit(page, problemPayload); });

  test('étape rouge, remise orange « 12 prêts · 9 transmis · 3 nécessitent une action »', async ({ page }) => {
    const info = await page.evaluate(() => {
      const steps = [...document.querySelectorAll('.kir-run-flow-step')].map((step) => ({
        cls: step.className, bg: getComputedStyle(step.querySelector('.kir-run-flow-marker')).backgroundColor,
      }));
      const h = document.querySelector('.kir-handoff');
      return { steps, handoff: h.innerText.replace(/\s+/g, ' '), border: getComputedStyle(h).borderLeftColor, action: h.querySelector('a')?.textContent };
    });
    expect(info.steps[2].cls).toContain('is-failed');
    expect(info.steps[2].bg).toBe('rgb(58, 21, 32)');
    expect(info.steps[3].cls).toContain('is-attention');
    expect(info.steps[3].bg).toBe('rgb(58, 38, 6)');
    expect(info.handoff).toContain('12 prêts · 9 transmis · 3 nécessitent une action');
    expect(info.border).toBe('rgb(245, 158, 11)');
    expect(info.action).toContain('Traiter');
  });
});

// Commandes réelles : mount() + API simulée. Aucune mécanique parallèle : import-now / deactivate / activate.
async function mountLive(page, data) {
  const state = { payload: JSON.parse(JSON.stringify(data)), calls: [] };
  await page.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === '/admin/import-runtime') {
      const links = CSS.map((n) => `<link rel="stylesheet" href="/dashboards/canonical/css/${n}.css">`).join('');
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8">${links}</head>
        <body class="kmc-shell-v4"><main id="root"></main><script src="/dashboards/canonical/js/import-runtime.js"></script></body></html>` });
    }
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (url.pathname.endsWith('/import-cockpit')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(state.payload) });
    if (req.method() === 'POST' && url.pathname.includes('/sources/')) {
      const action = url.pathname.split('/').pop();
      state.calls.push(action);
      if (action === 'import-now') { await new Promise((r) => setTimeout(r, 900)); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, result: {} }) }); }
      if (action === 'deactivate') { state.payload.source_controls[0].autopilot_enabled = false; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) }); }
      if (action === 'activate') { state.payload.source_controls[0].autopilot_enabled = true; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, result: {} }) }); }
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto(`${ORIGIN}/admin/import-runtime?run=KIR-000009`);
  await page.evaluate(() => window.KomerceCanonicalImportRuntime.mount({ root: document.getElementById('root') }));
  return state;
}

test.describe('Cockpit imports — commandes opérateur', () => {
  const calm = calmPayload;

  test('Mettre à jour maintenant : « Mise à jour… » pendant l’action, appelle import-now, boutons verrouillés', async ({ page }) => {
    const state = await mountLive(page, calm);
    const update = page.locator('.kir-cmd-update');
    await update.click();
    await expect(update).toContainText('Mise à jour…');
    await expect(update).toBeDisabled();
    await expect(page.locator('.kir-cmd-stop')).toBeDisabled();
    await expect(page.locator('.kir-cmd-update')).toContainText('Mettre à jour maintenant', { timeout: 6000 });
    expect(state.calls).toEqual(['import-now']);
  });

  test('Arrêter : « Arrêt… » puis la source arrêtée propose Redémarrer en premier', async ({ page }) => {
    const state = await mountLive(page, calm);
    await page.locator('.kir-cmd-stop').click();
    await expect(page.locator('.kir-command-state')).toContainText('Alimentation automatique arrêtée', { timeout: 6000 });
    expect(state.calls).toEqual(['deactivate']);
    const order = await page.$$eval('.kir-command-actions .kir-cmd', (els) => els.map((el) => el.dataset.sourceCommand));
    expect(order).toEqual(['restart', 'update']);
    const bg = await page.$eval('.kir-cmd-restart', (el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(15, 61, 42)');
  });

  test('Redémarrer : réutilise activate (même mécanique que l’interrupteur historique)', async ({ page }) => {
    const stopped = JSON.parse(JSON.stringify(calm));
    stopped.source_controls[0].autopilot_enabled = false;
    const state = await mountLive(page, stopped);
    await page.locator('.kir-cmd-restart').click();
    await expect.poll(() => state.calls.includes('activate')).toBe(true);
    await expect(page.locator('.kir-command-state')).toContainText('Alimentation automatique active', { timeout: 8000 });
  });

  test('capture de revue de la barre de commandes', async ({ page }) => {
    await mountLive(page, calm);
    await page.screenshot({ path: 'test-results/import-runtime-cockpit-commands.png' });
  });
});
