/**
 * @e2e   hub-live-execution.spec.js
 * @feature dashboard (Hub live · Exécution, /admin/hub-live?view=execute)
 * @brief Les opérations Hub (commander, répartir, expédier, affecter) sont exécutables depuis Hub live,
 *        via les routes canoniques du Workspace (une seule mutation par clic, marché conservé, aucune action Relais).
 *        API simulée : aucun serveur ni base requis, aucune donnée réelle modifiée.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pricing-atelier-km.json'), 'utf8'));
const ORIGIN = 'http://komerce.test';
const API = '/api/admin/workspaces/operations/market/KM';

const WORKSPACE = {
  scope: { code: 'KM', name: 'Comores' },
  summary: { hub_to_order: 1, hub_unassigned: 1, hub_to_ship: 1, relay_cash_pending: 1, relay_to_receive: 1, relay_to_collect: 1, inventory_to_assign: 1 },
  queues: {
    hub: {
      to_order: [{ reference: 'K-ORDER-1', client_name: 'Client A', relais_name: 'Relais Moroni', total_kmf: 25000 }],
      to_ship: [{ reference: 'PCL-KM-1', recipient_name: 'Client A', destination_island: 'Grande Comore' }],
    },
    relay: {
      cash_pending: [{ reference: 'K-CASH-1' }],
      to_receive: [{ reference: 'PCL-KM-2' }],
      to_collect: [{ reference: 'PCL-KM-3' }],
    },
  },
  distribution: { unassigned: [{ reference: 'K-DIST-1', client_name: 'Client B', item_count: 2, total_kmf: 12000 }] },
  inventory: {
    items: [{ item_id: 'item-1', order_ref: 'K-ORDER-1', product_name: 'Coque', status: 'received', destination_island: 'Grande Comore', received_at: '2026-10-17T10:00:00Z', proposed_parcel_ref: 'PCL-KM-1' }],
    open_parcels: [{ reference: 'PCL-KM-1', destination_island: 'Grande Comore', item_count: 1 }],
  },
};

async function mount(page, { posts = [], failShip = false } = {}) {
  page.on('dialog', (dialog) => dialog.accept());
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/admin/hub-live') return route.fulfill({ contentType: 'text/html', path: path.join(CANONICAL, 'index.html') });
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (route.request().method() === 'POST') {
      posts.push({ path: url.pathname, body: route.request().postDataJSON() });
      if (failShip && url.pathname.endsWith('/ship')) return json({ error: 'Colis non expédiable' }, 409);
      await new Promise((resolve) => setTimeout(resolve, 150));
      return json({ ok: true });
    }
    if (url.pathname === '/api/auth/me') return json(FX.auth_me);
    if (url.pathname === '/api/admin/dashboard/context') return json(FX.context);
    if (url.pathname === API) return json(WORKSPACE);
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${ORIGIN}/admin/hub-live?view=execute`);
  await page.locator('select').first().selectOption({ label: 'KM · Comores' });
  await expect(page.locator('h1')).toHaveText('Exécuter les opérations Hub');
}

for (const [name, viewport] of [['desktop', { width: 1536, height: 1024 }], ['mobile', { width: 390, height: 844 }]]) {
  test.describe(`Hub live · Exécution — ${name}`, () => {
    test.use({ viewport });

    test('actions Hub uniquement : aucun onglet ni bouton Relais', async ({ page }) => {
      await mount(page);
      await expect(page.locator('[data-workspace-view]')).toHaveText(['Hub', 'Stock à affecter']);
      await expect(page.locator('[data-workspace-action="mark-ordered"]')).toHaveCount(1);
      await expect(page.locator('[data-workspace-action="run-distribution"]')).toHaveCount(1);
      await expect(page.locator('[data-workspace-action="ship"]')).toHaveCount(1);
      await expect(page.locator('[data-workspace-action="confirm-cash"], [data-workspace-action="receive"], [data-workspace-action="collect"]')).toHaveCount(0);
    });

    test('commander, répartir, expédier : une mutation par clic, routes canoniques du marché', async ({ page }) => {
      const posts = [];
      await mount(page, { posts });
      await page.locator('[data-workspace-action="mark-ordered"]').click();
      await expect.poll(() => posts.length).toBe(1);
      await page.locator('[data-workspace-action="run-distribution"]').click();
      await expect.poll(() => posts.length).toBe(2);
      await page.locator('[data-workspace-action="ship"]').click();
      await expect.poll(() => posts.length).toBe(3);
      expect(posts.map((p) => p.path)).toEqual([
        `${API}/orders/K-ORDER-1/mark-ordered`,
        `${API}/distribution/run`,
        `${API}/parcels/PCL-KM-1/ship`,
      ]);
    });

    test('double clic : le bouton est neutralisé, une seule mutation', async ({ page }) => {
      const posts = [];
      await mount(page, { posts });
      const ship = page.locator('[data-workspace-action="ship"]');
      await ship.dblclick();
      await page.waitForTimeout(400);
      expect(posts.filter((p) => p.path.endsWith('/ship'))).toHaveLength(1);
    });

    test('affecter un article : colis choisi transmis, route du marché', async ({ page }) => {
      const posts = [];
      await mount(page, { posts });
      await page.locator('[data-workspace-view="inventory"]').click();
      await page.locator('[data-workspace-action="assign-inventory"]').click();
      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0]).toEqual({ path: `${API}/inventory/items/item-1/assign`, body: { parcel_ref: 'PCL-KM-1' } });
    });

    test('erreur serveur : message affiché, bouton réactivé, aucune relecture silencieuse', async ({ page }) => {
      const posts = [];
      await mount(page, { posts, failShip: true });
      await page.locator('[data-workspace-action="ship"]').click();
      await expect(page.locator('[data-workspace-feedback]')).toContainText('Colis non expédiable');
      await expect(page.locator('[data-workspace-action="ship"]')).toBeEnabled();
      expect(posts).toHaveLength(1);
    });

    test('aucun débordement horizontal, aucun texte parasite', async ({ page }) => {
      await mount(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      const body = await page.locator('body').innerText();
      expect(body).not.toMatch(/\bnull\b|\bundefined\b/);
    });
  });
}
