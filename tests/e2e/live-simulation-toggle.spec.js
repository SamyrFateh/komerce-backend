/**
 * @e2e   live-simulation-toggle.spec.js
 * @feature dashboard (Relais live / Hub live — « Afficher la recette »)
 * @brief Filtre recette désactivé par défaut, visible pour admin seulement ; activé : lignes RECETTE
 *        marquées avec leur scope, include_simulation transmis, compteurs inchangés.
 *        API simulée : aucun serveur ni base requis.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';
const CSS = ['base', 'canonical-theme-v2', 'canonical-shell-v4', 'canonical-legacy-theme-v1', 'cockpit-legacy-v1', 'import-runtime', 'live-kit'];
const SCOPE = 'E2E-HUB-V1';

const relayRow = (n, scope) => ({ id: `r-${n}`, reference: scope ? `E2E-HUB-V1-X-KOM-10${n}` : `KMC-0${n}`, status: 'collected', client_nom: `C${n}`,
  relais_nom: 'Relais', ile: 'Moroni', heures_attente: 1, age_jours: 1, urgence: 'normale', nb_items: 1, payment_status: 'paid', incidents_ouverts: 0, simulation_scope: scope || null });
const hubRow = (n, scope) => ({ id: `h-${n}`, reference: scope ? `E2E-HUB-V1-X-KOM-10${n}` : `KMC-0${n}`, status: 'ordered', client_name: `C${n}`, relais_name: 'Relais',
  age_hours: 5, items_assigned: 0, items_count: 1, completeness: 'unassigned', parcels_count: 0, payment_mode: 'cash_relais', payment_status: 'paid', open_incidents: 0, simulation_scope: scope || null });
const dashboard = { kpi: { en_transit: 1, disponibles: 2, collectes_aujourd_hui: 0, collectes_7j: 0, en_attente_72h: 0, total_actives: 3, incidents_ouverts: 0 } };

async function mount(page, { screen, role, search = '' }) {
  const state = { calls: [], writes: [] };
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') state.writes.push(url.pathname);
    const json = (b) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(b) });
    if (url.pathname === `/admin/${screen}-live`) {
      const links = CSS.map((n) => `<link rel="stylesheet" href="/dashboards/canonical/css/${n}.css">`).join('');
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8">${links}</head><body class="kmc-shell-v4"><main id="root"></main><script src="/dashboards/canonical/js/live-kit.js"></script><script src="/dashboards/canonical/js/${screen === 'relais' ? 'relay' : 'hub'}-live.js"></script></body></html>` });
    }
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    const sim = url.searchParams.get('include_simulation') === '1';
    if (url.pathname === '/api/relay/dashboard') return json(dashboard);
    if (url.pathname === '/api/relay/orders') {
      state.calls.push(`relay:${sim}`);
      const rows = [relayRow(1), ...(sim && role === 'admin' ? [relayRow(2, SCOPE)] : [])];
      return json({ total: rows.length, orders: rows });
    }
    if (url.pathname === '/api/hub-dash/dashboard') return json({ orders: { to_prepare: 1, in_preparation: 0, shipped_total: 0, shipped_today: 0, urgent: 0, cash_pending: 0, total_active: 1 }, parcels: {}, incidents: {}, stock: {} });
    if (url.pathname === '/api/hub-dash/queue') {
      state.calls.push(`hub:${sim}`);
      const rows = [hubRow(1), ...(sim && role === 'admin' ? [hubRow(2, SCOPE)] : [])];
      return json({ data: rows, pagination: { page: 1, limit: 50, total: rows.length, pages: 1 }, tab: 'to_prepare' });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${ORIGIN}/admin/${screen}-live${search}`);
  const api = screen === 'relais' ? 'KomerceCanonicalRelayLive' : 'KomerceCanonicalHubLive';
  await page.evaluate(([name, r]) => window[name].mount({ root: document.getElementById('root'), user: { role: r } }), [api, role]);
  return state;
}

for (const [screen, search, key] of [['relais', '?view=orders&list=all', 'relay'], ['hub', '?view=queue&tab=to_prepare', 'hub']]) {
  test.describe(`${screen} live — Afficher la recette`, () => {
    test('admin : désactivé par défaut, aucune ligne recette, include_simulation non envoyé', async ({ page }) => {
      const state = await mount(page, { screen, role: 'admin', search });
      const toggle = page.locator('[data-sim-toggle]');
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(page.locator('.lk-sim-badge')).toHaveCount(0);
      expect(state.calls).toContain(`${key}:false`);
      expect(state.calls).not.toContain(`${key}:true`);
    });

    test('admin : activé → ligne RECETTE avec scope, paramètre transmis, toggle réversible', async ({ page }) => {
      const state = await mount(page, { screen, role: 'admin', search: `${search}&sim=1` });
      await expect(page.locator('[data-sim-toggle]')).toHaveAttribute('aria-checked', 'true');
      const badge = page.locator('.lk-sim-badge');
      await expect(badge).toHaveCount(1);
      await expect(badge).toContainText(`RECETTE · ${SCOPE}`);
      expect(state.calls).toContain(`${key}:true`);
      await page.screenshot({ path: `test-results/live-sim-${screen}.png` });
      await page.locator('[data-sim-toggle]').click();
      await expect(page.locator('.lk-sim-badge')).toHaveCount(0);
      expect(state.writes).toEqual([]);
    });

    test('autres rôles : pas de toggle, ?sim=1 sans effet', async ({ page }) => {
      for (const role of ['agent_hub', 'agent_relais', 'market_operator']) {
        const state = await mount(page, { screen, role, search: `${search}&sim=1` });
        await expect(page.locator('[data-sim-toggle]')).toHaveCount(0);
        await expect(page.locator('.lk-sim-badge')).toHaveCount(0);
        expect(state.calls).not.toContain(`${key}:true`);
        await page.unroute(`${ORIGIN}/**`);
      }
    });
  });
}
