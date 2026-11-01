/**
 * @e2e   market-context-explicit.spec.js
 * @feature dashboard (L1 — contexte marché explicite sur les 7 surfaces marché)
 * @brief Aucun marché n'est choisi implicitement depuis Global ; aucune requête marché avant le choix ;
 *        ?market=XX non autorisé -> invite ; le choix explicite survit au rechargement ; shell = surface ;
 *        délégation mono-marché sélectionnée automatiquement. API simulée : aucun serveur, aucune base.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';
const MARKET_API = /\/api\/(?:admin\/workspaces\/[a-z-]+\/market\/|market-delegation\/markets\/|admin\/dashboard\/[a-z-]+\/market\/)([A-Z]{2})/;

const GLOBAL_CTX = { actor: { id: 'hq', role: 'admin' }, access: { mode: 'global', allowedMarkets: ['CG', 'CM', 'KM'], defaultMarket: null, capabilities: ['dashboard.global.read'] } };
const MONO_CTX = { actor: { id: 'op', role: 'market_operator' }, access: { mode: 'market', allowedMarkets: ['CM'], defaultMarket: 'CM', capabilities: ['dashboard.market.read'] } };

// Charge utile minimale du Workspace Operations (même forme que hub-live-execution.spec.js) :
// permet de prouver la synchronisation de l'URL après un choix sur les surfaces Hub.
const OPS_WORKSPACE = {
  scope: { code: 'KM', name: 'Comores' },
  summary: { hub_to_order: 0, hub_unassigned: 0, hub_to_ship: 0, relay_cash_pending: 0, relay_to_receive: 0, relay_to_collect: 0, inventory_to_assign: 0 },
  queues: { hub: { to_order: [], to_ship: [] }, relay: { cash_pending: [], to_receive: [], to_collect: [] } },
  distribution: { unassigned: [] },
  inventory: { items: [], open_parcels: [] },
};
const OPS_SURFACES = new Set(['Hub live · Exécution']);

const SHELL_SURFACES = [
  ['Prix & économie', '/admin/workspaces/pricing'],
  ['Expéditions & Douane', '/admin/workspaces/shipping-customs'],
  ['Comptabilité', '/admin/workspaces/accounting'],
  ['Hub live · Exécution', '/admin/hub-live?view=execute'],
];
const STANDALONE_SURFACES = [
  ['Autonomie marché', '/dashboards/canonical/market-autonomy.html'],
  ['Catalogue pays', '/dashboards/canonical/market-catalog.html'],
];

async function mount(page, ctx) {
  const marketCalls = [];
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (url.pathname.startsWith('/admin/')) return route.fulfill({ contentType: 'text/html', path: path.join(CANONICAL, 'index.html') });
    if (url.pathname === '/api/auth/me') return json({ id: ctx.actor.id, role: ctx.actor.role, email: 'x@komerce.test' });
    if (url.pathname === '/api/admin/dashboard/context') return json(ctx);
    if (MARKET_API.test(url.pathname)) {
      marketCalls.push(url.pathname);
      if (/\/api\/admin\/workspaces\/operations\/market\/[A-Z]{2}$/.test(url.pathname)) return json(OPS_WORKSPACE);
    }
    return route.fulfill({ status: 404, body: '{}', contentType: 'application/json' });
  });
  return marketCalls;
}

const go = (page, target, query = '') => {
  const [p, q] = target.split('?');
  const params = [q, query].filter(Boolean).join('&');
  return page.goto(`${ORIGIN}${p}${params ? `?${params}` : ''}`);
};

test.describe('L1 — surfaces à shell marché (5)', () => {
  for (const [label, target] of SHELL_SURFACES) {
    test(`${label} : Global -> invite, aucun appel marché, sélecteur sans marché`, async ({ page }) => {
      const calls = await mount(page, GLOBAL_CTX);
      await go(page, target);
      await expect(page.locator('[data-market-prompt="prompt"]')).toBeVisible();
      await expect(page.locator('.kmc-admin-market-select')).toHaveValue('');
      await expect(page.locator('.kmc-admin-market-select option').first()).toHaveText('Choisir un marché…');
      await page.waitForTimeout(400);
      expect(calls).toEqual([]);
    });

    test(`${label} : ?market=XX -> « non autorisé », aucun appel marché`, async ({ page }) => {
      const calls = await mount(page, GLOBAL_CTX);
      await go(page, target, 'market=XX');
      await expect(page.locator('[data-market-prompt="unauthorized"]')).toContainText('XX');
      await page.waitForTimeout(400);
      expect(calls).toEqual([]);
    });

    test(`${label} : choix explicite KM -> chargement KM uniquement, shell = surface`, async ({ page }) => {
      const calls = await mount(page, GLOBAL_CTX);
      await go(page, target);
      await page.locator('.kmc-admin-market-select').selectOption('KM');
      await expect.poll(() => calls.length).toBeGreaterThan(0);
      expect(calls.every((c) => /\/KM(\/|$)/.test(c))).toBe(true);
      if (OPS_SURFACES.has(label)) {
        await expect.poll(() => new URL(page.url()).searchParams.get('market')).toBe('KM');
        await expect(page.locator('[data-market-prompt]')).toHaveCount(0);
        await expect(page.locator('.kmc-admin-market-select')).toHaveValue('KM');
        await page.reload();
        await expect(page.locator('.kmc-admin-market-select')).toHaveValue('KM');
      }
    });

    test(`${label} : ?market=KM explicite -> KM affiché, survit au rechargement`, async ({ page }) => {
      const calls = await mount(page, GLOBAL_CTX);
      await go(page, target, 'market=KM');
      await expect(page.locator('[data-market-prompt]')).toHaveCount(0);
      await expect(page.locator('.kmc-admin-market-select')).toHaveValue('KM');
      await page.reload();
      await expect(page.locator('.kmc-admin-market-select')).toHaveValue('KM');
      await expect.poll(() => calls.length).toBeGreaterThan(0);
      expect(calls.every((c) => /\/KM(\/|$)/.test(c))).toBe(true);
    });

    test(`${label} : délégation mono-marché -> sélection automatique CM`, async ({ page }) => {
      const calls = await mount(page, MONO_CTX);
      await go(page, target);
      await expect(page.locator('[data-market-prompt]')).toHaveCount(0);
      await expect(page.locator('.kmc-admin-market-select')).toHaveValue('CM');
      await expect.poll(() => calls.length).toBeGreaterThan(0);
      expect(calls.every((c) => /\/CM(\/|$)/.test(c))).toBe(true);
    });
  }
});

test.describe('L1 — pages autonomes (Autonomie marché, Catalogue pays)', () => {
  for (const [label, target] of STANDALONE_SURFACES) {
    test(`${label} : Global -> invite + sélecteur du shell vide, aucun appel marché`, async ({ page }) => {
      const calls = await mount(page, GLOBAL_CTX);
      await go(page, target);
      await expect(page.locator('[data-market-prompt="prompt"]')).toBeVisible();
      await expect(page.locator('.kmc-admin-market-select')).toHaveValue('');
      await page.waitForTimeout(400);
      expect(calls).toEqual([]);
    });

    test(`${label} : ?market=XX -> « non autorisé », aucun appel marché`, async ({ page }) => {
      const calls = await mount(page, GLOBAL_CTX);
      await go(page, target, 'market=XX');
      await expect(page.locator('[data-market-prompt="unauthorized"]')).toContainText('XX');
      await page.waitForTimeout(400);
      expect(calls).toEqual([]);
    });

    test(`${label} : choix KM -> URL ?market=KM, appels KM uniquement, survit au rechargement`, async ({ page }) => {
      const calls = await mount(page, GLOBAL_CTX);
      await go(page, target);
      await page.locator('.kmc-admin-market-select').selectOption('KM');
      await expect.poll(() => new URL(page.url()).searchParams.get('market')).toBe('KM');
      await expect.poll(() => calls.length).toBeGreaterThan(0);
      await page.reload();
      await expect(page.locator('[data-market-prompt]')).toHaveCount(0);
      expect(calls.every((c) => /\/KM(\/|$)/.test(c))).toBe(true);
    });

    test(`${label} : délégation mono-marché -> CM automatique`, async ({ page }) => {
      const calls = await mount(page, MONO_CTX);
      await go(page, target);
      await expect(page.locator('[data-market-prompt]')).toHaveCount(0);
      await expect.poll(() => calls.length).toBeGreaterThan(0);
      expect(calls.every((c) => /\/CM(\/|$)/.test(c))).toBe(true);
    });
  }
});
