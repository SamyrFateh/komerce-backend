/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires none
 * @komerce-arch-lite
 * @role g6-fiab-cockpit-stability-offline-chromium
 * @domain dashboard
 * @layer e2e
 * @purpose P1 FIAB : saisies/focus conservés au rerender, file direction sans décalage,
 *          signaux data-render-epoch / data-hlc-ready. Chromium réel, réseau refusé, aucune écriture.
 * @impact-areas hub, dashboard, test-only
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const JS = (f) => fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js', f), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/css/hub-live-cockpit.css'), 'utf8');
const COCKPIT = JS('hub-live-cockpit.js');
const WORKSTATION = JS('hub-workstation.js');
const PO_ID = '00000000-0000-4000-8000-000000000042';
const LINE_ID = '00000000-0000-4000-8000-000000000043';

async function setup(page, { step, status, commitment, director = true, queueDelay = 0 }) {
  await page.route('**/*', (route) => route.abort('blockedbyclient'));
  await page.goto('about:blank');
  await page.setContent('<!doctype html><html lang="fr"><body><main id="top"><div id="queue"></div><div id="workplace"></div></main></body></html>');
  await page.addStyleTag({ content: CSS });
  await page.addScriptTag({ content: COCKPIT });
  await page.addScriptTag({ content: WORKSTATION });
  await page.evaluate(({ step, status, commitment, director, queueDelay, poId, lineId }) => {
    const po = {
      id: poId, ref: 'PO-FIAB', supplier_name: 'Fournisseur fictif',
      status, status_view: { label: status, tone: 'wait' },
      step: { key: step, index: ['draft', 'validation', 'engaged', 'sent', 'received'].indexOf(step) + 1, partial: false },
      lines: [{ line_id: lineId, order_id: 'O', order_ref: 'FIAB', product: 'Produit', ordered: 2, confirmed: 2, received: 0, missing: 2, fifo_rank: 1, fifo_next: true }],
      order_ids: [], totals: { effective: 2, received: 0, missing: 2 },
      authorizations: { commitment, payment: false }, amount: { derived: true, amount: 2000, currency: 'KMF' },
    };
    const dossier = { market: { code: 'KM' }, orders: [], purchase_orders: [po], bags_open: [], bags_ready: [], boxes: [], open_shipments: [],
      cockpit: { viewer: { role: 'agent_hub', can_authorize_commitment: director, can_authorize_payment: director }, todo: [], physical: [], unit_legend: [], po_steps: ['draft', 'validation', 'engaged', 'sent', 'received'], need_batches: [] } };
    const w = window.__fiab = { calls: [], state: {} };
    const ctx = {
      document, dossier, state: w.state, marketCode: 'KM', isReadOnly: false,
      endpoint: (p) => '/api/x/' + p,
      act: async (_, a) => { w.calls.push({ route: a.url, body: a.body }); await new Promise((r) => setTimeout(r, 30)); return null; },
      feedback() {}, async reload() {}, openPhysical() {}, openSourcing() {}, renderReception() { return null; },
    };
    w.render = () => window.KomerceHubLiveCockpit.render(document.getElementById('workplace'), ctx);
    const tasks = Array.from({ length: 8 }, (_, i) => ({ kind: 'T' + i, missing: 'Tâche ' + i, why: 'x', market: { code: 'KM' }, age_hours: 5 }));
    const fetchFn = () => new Promise((r) => setTimeout(() => r({ ok: true, status: 200, json: async () => ({ scope: 'ALL_MARKETS', tasks, overdue_count: 0 }), text: async () => '' }), queueDelay));
    w.queue = window.KomerceCanonicalHubWorkstation.renderDirectorQueue(document.getElementById('queue'), { document, fetch: fetchFn, user: { role: 'admin' } });
    w.render();
  }, { step, status, commitment, director, queueDelay, poId: PO_ID, lineId: LINE_ID });
}

const ready = (page) => page.waitForSelector('[data-hub-cockpit][data-hlc-ready="true"]');

test('file direction retardée : le cockpit ne bouge pas à son arrivée', async ({ page }) => {
  await setup(page, { step: 'draft', status: 'draft', commitment: false, queueDelay: 400 });
  await ready(page);
  const top = () => page.locator('[data-hub-cockpit]').evaluate((e) => Math.round(e.getBoundingClientRect().top));
  const before = await top();
  await expect(page.locator('[data-hub-director-todo][data-hub-director-state="ready"]')).toBeVisible();
  expect(await top()).toBe(before);
});

test('epoch incrémenté à chaque rendu, ready true au repos', async ({ page }) => {
  await setup(page, { step: 'draft', status: 'draft', commitment: false });
  await ready(page);
  const e1 = Number(await page.locator('[data-hub-cockpit]').getAttribute('data-render-epoch'));
  await page.evaluate(() => window.__fiab.render());
  const e2 = Number(await page.locator('[data-hub-cockpit]').getAttribute('data-render-epoch'));
  expect(e2).toBeGreaterThan(e1);
});

test('authorize-commitment : rerender forcé pendant le clic et la saisie, valeur et focus conservés', async ({ page }) => {
  await setup(page, { step: 'draft', status: 'draft', commitment: false, queueDelay: 150 });
  await ready(page);
  await page.locator('[data-hlc-po]').click();
  // rerender forcé pendant le clic : un seul au pointerdown (le clic est perdu), puis geste relocalisé
  await page.evaluate(() => {
    let once = true;
    document.addEventListener('pointerdown', (e) => {
      if (once && e.target.closest && e.target.closest('[data-hlc-action="authorize-commitment"]')) { once = false; window.__fiab.render(); }
    }, true);
  });
  const input = page.locator('form[data-hlc-form="commitment"] input[name=proof_ref]');
  await expect(async () => {
    await page.locator('[data-hlc-action="authorize-commitment"]').click({ timeout: 1000 });
    await expect(input).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 8000 });
  await input.focus();
  // rerenders forcés pendant la saisie (finis, espacés)
  await page.evaluate(() => { let n = 0; window.__tick = setInterval(() => { window.__fiab.render(); if (++n >= 12) clearInterval(window.__tick); }, 40); });
  await page.keyboard.type('PROOF-FIAB-123', { delay: 15 });
  await page.waitForTimeout(600);
  await page.evaluate(() => clearInterval(window.__tick));
  await expect(page.locator('form[data-hlc-form="commitment"] input[name=proof_ref]')).toHaveValue('PROOF-FIAB-123');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.name)).toBe('proof_ref');
  await page.locator('[data-hlc-action="submit-commitment"]').click();
  await expect.poll(() => page.evaluate(() => window.__fiab.calls.length)).toBe(1);
  const calls = await page.evaluate(() => window.__fiab.calls);
  expect(calls[0].route).toBe('/api/purchasing/po/' + PO_ID + '/authorize-commitment');
  expect(calls[0].body).toMatchObject({ proof_ref: 'PROOF-FIAB-123' });
});

test('submit-commitment : rerender forcé juste avant le submit, une seule requête', async ({ page }) => {
  await setup(page, { step: 'draft', status: 'draft', commitment: false });
  await ready(page);
  await page.locator('[data-hlc-po]').click();
  await page.locator('[data-hlc-action="authorize-commitment"]').click();
  await page.locator('form[data-hlc-form="commitment"] input[name=proof_ref]').fill('PROOF-2');
  await page.evaluate(() => window.__fiab.render());
  await ready(page);
  await page.locator('[data-hlc-action="submit-commitment"]').click();
  await expect.poll(() => page.evaluate(() => window.__fiab.calls.length)).toBe(1);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__fiab.calls.length)).toBe(1);
  await expect(page.locator('[data-hub-cockpit]')).toHaveAttribute('data-hlc-ready', 'true');
});

test('centre de la carte sélectionne le PO et seule la puce sélectionne la commande', async ({ page }) => {
  await setup(page, { step: 'draft', status: 'draft', commitment: false });
  const card = page.locator('[data-hlc-po]');
  await card.click();
  await expect(card).toHaveClass(/is-selected/);
  await card.locator('[data-hlc-goto-order]').click();
  await expect(card).not.toHaveClass(/is-selected/);
});

test('expédition : repeindre pendant la saisie conserve tâche, valeur et curseur', async ({ page }) => {
  await page.setContent('<main></main>');
  await page.addScriptTag({ content: JS('international-journey-panel.js') });
  await page.evaluate(() => {
    const panel = window.KomerceInternationalJourneyPanel;
    const root = document.querySelector('main');
    const row = {reference: 'INT-TEST', stage: 'arrived'};
    const ctx = {user: {role: 'admin'}, marketCode: 'CM', journeyRef: row.reference, journeyTab: 'arrival'};
    window.repaint = () => {
      const saved = panel.capture(root, document);
      root.replaceChildren();
      panel.restore(panel.render(document,root,ctx,[row]),saved);
    };
    window.repaint();
  });
  const task = page.locator('details').filter({hasText:'Lier le dossier douane existant'});
  await task.locator('summary').click();
  const input = task.locator('[name=proof_ref]');
  await input.fill('PREUVE');
  await input.press('ArrowLeft');
  await page.evaluate(() => window.repaint());
  await expect(task).toHaveJSProperty('open',true);
  await expect(input).toBeFocused();
  await page.keyboard.type('-1');
  await expect(input).toHaveValue('PREUV-1E');
  await expect(page.locator('[data-international-journey]')).toHaveAttribute('data-render-epoch','2');
  await expect(page.locator('[data-international-journey]')).toHaveAttribute('data-ready','true');
});
