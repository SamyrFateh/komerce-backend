/**
 * @e2e finance-journal-workspace.spec.js
 * @feature Lot 5 — Comptabilité sur le journal financier (finance-journal-workspace)
 * @brief Navigateur réel, API simulée : 4 onglets journal (Cash & dépôts vit dans Relais live), 1440 et 390, rôles.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';
const PAGE = '/admin/workspaces/accounting';
const API = '/api/admin/workspaces/accounting/market/KM';
const SHOTS = process.env.KMC_SHOTS_DIR;

const payloads = {
  summary: { cost_levels: [{ level: 'N1', label: 'N1 · Coût rendu relais', source_missing: false, states: [{ state: 'settled', state_label: 'Réglé', movements: 1, eur_total: 0, eur_unavailable: 1, native: [{ currency: 'USD', total: '80.0000' }] }], remaining_native: [] }, { level: 'N3', label: 'N3 · Charge de période', source_missing: true, states: [], remaining_native: [] }], journal_empty: false, eur_complete: false, eur_unavailable_movements: 1, supplier_remaining_native: [{ currency: 'USD', remaining_native: '120.00' }],
    lines: [{ label: 'Encaissement commande', state_label: 'Constaté', movements: 3, eur_total: 450, eur_unavailable: 0, native: [{ currency: 'KMF', total: '221000' }] },
      { label: 'Règlement fournisseur', state_label: 'Réglé', movements: 1, eur_total: 0, eur_unavailable: 1, native: [{ currency: 'USD', total: '80' }] }] },
  movements: { total: 1, rows: [{ occurred_at: '2026-10-03T10:00:00Z', label: 'Encaissement commande', reference: 'CMD-1', state_label: 'Constaté', amount_native: '75000', currency: 'KMF', amount_eur: '152.45', documents: 1 }] },
  reconciliation: { ok: false, checks: [{ name: 'a', label: 'Encaissements : journal ↔ commandes payées (KMF)', journal: '75000', source: '70000', ok: false }] },
  documents: { documents: [{ occurred_at: '2026-10-03T10:00:00Z', label: 'Règlement fournisseur', doc_kind: 'payment_proof', doc_ref: 'PRF-9', amount_native: '80', currency: 'USD' }],
    missing_documents: [{ occurred_at: '2026-10-04T10:00:00Z', label: 'Règlement fournisseur', reference: 'PO-4', amount_native: '40', currency: 'USD' }] },
};
const cash = { scope: { code: 'KM', name: 'Comores' }, filters: { from: '2026-10-01', to: '2026-10-12', hours: 48 },
  summary: { expected_kmf: 0, collected_kmf: 0, held_kmf: 0, closed_kmf: 0, transfers_to_act: 0, holders_over_ceiling: 0, holders_overdue: 0, legacy_to_regularize_kmf: 0, pending_deposits: 0, uncollected_kmf: 0 },
  reconciliation: { expected_kmf: 0, collected_kmf: 0, transferred_kmf: 0, closed_kmf: 0, lost_kmf: 0, held_kmf: 0, gap_collection_kmf: 0, gap_closure_kmf: 0 },
  custody: { limits: {}, holders: [], recipients: [], destinations: [], transfers: [], legacy_to_regularize: [] }, deposits: [], uncollected: [], collections: [], invoices: [] };

async function mount(page, role) {
  await page.route(ORIGIN + '/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === PAGE) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width">' + ['base','tokens','renderer','operations-workspace','canonical-theme-v2','canonical-shell-v4','canonical-finish-polish-v1','komerce-layout-canon-v1'].map(n => `<link rel="stylesheet" href="/dashboards/canonical/css/${n}.css">`).join('') + '</head><body><main id="root"></main>' + ['primitives', 'admin-context', 'finance-accounting-workspace', 'finance-journal-workspace'].map(n => `<script src="/dashboards/canonical/js/${n}.js"></script>`).join('') + '</body></html>' });
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    const m = url.pathname.match(/\/journal\/(\w+)$/);
    if (m && url.pathname.startsWith(API)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(payloads[m[1]]) });
    if (url.pathname === API) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(cash) });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(ORIGIN + PAGE);
  await page.evaluate(async r => {
    const adminContext = { actor: { id: r + '-1', role: r }, access: { mode: 'market', allowedMarkets: ['KM'], defaultMarket: 'KM', capabilities: [] } };
    await window.KomerceCanonicalFinanceJournalWorkspace.mount({ root: document.getElementById('root'), document, ui: window.KomerceCanonicalUI, fetch: window.fetch.bind(window), contextContract: window.KomerceAdminContext, adminContext, requestedMarket: 'KM', user: { id: r + '-1', role: r } });
  }, role);
}

for (const [label, size] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
  test.describe('Comptabilité journal ' + label, () => {
    test.use({ viewport: size });
    for (const role of ['admin', 'finance', 'market_operator']) {
      test(role + ' : onglets, EUR jamais estimé, écart visible', async ({ page }) => {
        await mount(page, role);
        await expect(page.locator('h1')).toContainText('Journal financier');
        await expect(page.locator('body')).toContainText('sans conversion EUR');
        await expect(page.locator('body')).toContainText('221');
        await expect(page.locator('body')).toContainText('pas une comptabilité en partie double');
        await expect(page.locator('body')).toContainText('N1 · Coût rendu relais');
        await expect(page.locator('body')).toContainText('Non alimenté');
        if (SHOTS && role === 'finance') await page.screenshot({ path: path.join(SHOTS, `journal-synthese-${label}.png`), fullPage: true });
        await page.locator('[data-journal-tab="movements"]').click();
        await expect(page.locator('body')).toContainText('CMD-1');
        await page.locator('[data-journal-tab="reconciliation"]').click();
        await expect(page.locator('body')).toContainText('ÉCART');
        if (SHOTS && role === 'finance') await page.screenshot({ path: path.join(SHOTS, `journal-rapprochements-${label}.png`), fullPage: true });
        await page.locator('[data-journal-tab="documents"]').click();
        await expect(page.locator('body')).toContainText('PRF-9');
        await expect(page.locator('body')).toContainText('PO-4');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        await expect(page.locator('[data-journal-tab="cash"]')).toHaveCount(0);
      });
    }
  });
}
