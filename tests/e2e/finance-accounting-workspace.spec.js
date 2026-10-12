/**
 * @e2e finance-accounting-workspace.spec.js
 * @feature S7 — Finance / Comptabilité L3
 * @brief Navigateur réel, API simulée : rôles autorisés + états vide/erreur/nominal.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';
const PAGE = '/admin/workspaces/accounting';
const API = '/api/admin/workspaces/accounting/market/KM';

const emptyPayload = {
  scope: { code: 'KM', name: 'Comores' },
  filters: { from: '2026-10-01', to: '2026-10-12', hours: 48 },
  summary: { expected_kmf: 0, collected_kmf: 0, held_kmf: 0, closed_kmf: 0, transfers_to_act: 0, holders_over_ceiling: 0, holders_overdue: 0, legacy_to_regularize_kmf: 0, pending_deposits: 0, uncollected_kmf: 0 },
  reconciliation: { expected_kmf: 0, collected_kmf: 0, transferred_kmf: 0, closed_kmf: 0, lost_kmf: 0, held_kmf: 0, gap_collection_kmf: 0, gap_closure_kmf: 0 },
  custody: { limits: {}, holders: [], recipients: [], destinations: [], transfers: [], legacy_to_regularize: [] },
  deposits: [], uncollected: [], collections: [], invoices: [],
};
const nominalPayload = {
  ...emptyPayload,
  summary: { ...emptyPayload.summary, expected_kmf: 100000, collected_kmf: 100000, held_kmf: 40000, closed_kmf: 60000, transfers_to_act: 1 },
  reconciliation: { ...emptyPayload.reconciliation, expected_kmf: 100000, collected_kmf: 100000, transferred_kmf: 60000, closed_kmf: 60000, held_kmf: 40000, gap_collection_kmf: 0, gap_closure_kmf: 40000 },
  custody: { ...emptyPayload.custody, holders: [{ holder_id: 'holder-1', full_name: 'Agent Relais', balance_kmf: 40000, held_days: 1, ceiling_kmf: 100000, over_ceiling: false, overdue: false }], recipients: [{ user_id: 'finance-1', full_name: 'Finance', role: 'finance', holding_limit_kmf: 100000 }] },
};

async function mount(page, { role, payload = emptyPayload, apiStatus = 200 }) {
  await page.route(ORIGIN + '/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === PAGE) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="fr"><body><main id="root"></main><script src="/dashboards/canonical/js/primitives.js"></script><script src="/dashboards/canonical/js/admin-context.js"></script><script src="/dashboards/canonical/js/finance-accounting-workspace.js"></script></body></html>' });
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (url.pathname === API) return route.fulfill({ status: apiStatus, contentType: 'application/json', body: JSON.stringify(apiStatus === 200 ? payload : { error: 'Finance indisponible' }) });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(ORIGIN + PAGE);
  return page.evaluate(async ({ role: r }) => {
    const root = document.getElementById('root');
    const adminContext = { actor: { id: r + '-1', role: r }, access: { mode: 'market', allowedMarkets: ['KM'], defaultMarket: 'KM', capabilities: [] } };
    try {
      await window.KomerceCanonicalFinanceAccountingWorkspace.mount({ root, document, ui: window.KomerceCanonicalUI, fetch: window.fetch.bind(window), contextContract: window.KomerceAdminContext, adminContext, requestedMarket: 'KM', user: { id: r + '-1', role: r } });
      return { ok: true };
    } catch (error) {
      window.KomerceCanonicalUI.UIState.render(root, 'error', error.message);
      return { ok: false, message: error.message };
    }
  }, { role });
}

test.describe('S7 Finance / Comptabilité — L3', () => {
  for (const role of ['admin', 'market_operator', 'finance']) {
    test(role + ' ouvre la Comptabilité et voit la vérité nominale', async ({ page }) => {
      const result = await mount(page, { role, payload: nominalPayload });
      expect(result.ok).toBe(true);
      await expect(page.locator('h1')).toContainText('Cash & dépôts');
      await expect(page.locator('body')).toContainText('100 000 KMF');
      await expect(page.locator('body')).toContainText('40 000 KMF');
      await expect(page.locator('#accounting-custody')).toContainText('Agent Relais');
    });
  }

  test('état vide reste exploitable sans faux montant ni action inventée', async ({ page }) => {
    const result = await mount(page, { role: 'finance', payload: emptyPayload });
    expect(result.ok).toBe(true);
    await expect(page.locator('#accounting-custody')).toContainText('Personne ne détient d’espèces non clôturées.');
    await expect(page.locator('#accounting-uncollected')).toContainText('Aucune commande cash en anomalie.');
    await expect(page.locator('[data-workspace-action="decide-custody-loss"]')).toHaveCount(0);
  });

  test('erreur serveur est explicite et ne fabrique jamais un dashboard nominal', async ({ page }) => {
    const result = await mount(page, { role: 'finance', apiStatus: 503 });
    expect(result.ok).toBe(false);
    await expect(page.locator('[data-ui-state="error"]')).toContainText('Finance indisponible');
    await expect(page.locator('.kmc-workspace-metrics')).toHaveCount(0);
  });

  test('agent_hub ne reçoit pas la destination Comptabilité dans la navigation canonique', async ({ page }) => {
    await page.route(ORIGIN + '/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === PAGE) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><body><main id="canonical-admin-root"></main><script>window.KOMERCE_CANONICAL_AUTH_USER={role:"agent_hub"}</script><script src="/dashboards/canonical/js/navigation-policy-v4.js"></script></body></html>' });
      if (url.pathname.startsWith('/dashboards/canonical/')) { const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', '')); return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' }); }
      return route.fulfill({ status: 404, body: '' });
    });
    await page.goto(ORIGIN + PAGE);
    await expect(page.locator('#canonical-admin-navigation')).toHaveCount(1);
    const ids = await page.$eval('.kmc-admin-primary-link', links => links.map(link => link.getAttribute('data-dashboard')));
    expect(ids).not.toContain('workspace-accounting');
  });
});
