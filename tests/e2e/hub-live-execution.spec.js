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
const RECEIVABLE = '/api/scans/hub/receivable';
const RECEIVE = '/api/scans/hub/receive';
const PO_ID = '6748895a-89bf-4236-9fb0-737fcf1e59ca';
const SKU_ID = '0b9d2f4e-1111-4222-8333-444455556666';
const RECEIVABLE_PAYLOAD = {
  generated_at: '2026-10-18T10:00:00Z',
  purchase_orders: [{
    purchase_order_id: PO_ID, shape: 'grouped', po_status: 'shipped', supplier: { id: 's1', name: 'CJ Dropshipping' }, supplier_order_ref: 'CJ-GOLDEN-1',
    lines: [
      { product_sku_id: SKU_ID, product_name: 'Coque téléphone', expected_quantity: 5, received_quantity: 2, remaining_quantity: 3, reception_state: 'PARTIAL' },
      { product_sku_id: null, product_name: 'Câble USB', expected_quantity: 1, received_quantity: 0, remaining_quantity: 1, reception_state: 'NOT_RECEIVED' },
    ],
  }],
};

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

async function mount(page, { posts = [], failShip = false, receiveReply = null, receivable = RECEIVABLE_PAYLOAD, view = '', emptyDistribution = false, pilot = false } = {}) {
  page.on('dialog', (dialog) => dialog.accept());
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/admin/hub-live' || url.pathname === '/admin/workspaces/operations') return route.fulfill({ contentType: 'text/html', path: path.join(CANONICAL, 'index.html') });
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (route.request().method() === 'POST' && url.pathname === RECEIVE) {
      posts.push({ path: url.pathname, body: route.request().postDataJSON() });
      await new Promise((resolve) => setTimeout(resolve, 150));
      const reply = receiveReply || { status: 201, body: { quarantined: false, unit: { id: 'u1', reference: 'x' } } };
      return json(reply.body, reply.status);
    }
    if (route.request().method() === 'POST') {
      posts.push({ path: url.pathname, body: route.request().postDataJSON() });
      if (failShip && url.pathname.endsWith('/ship')) return json({ error: 'Colis non expédiable' }, 409);
      await new Promise((resolve) => setTimeout(resolve, 150));
      return json({ ok: true });
    }
    if (url.pathname === '/api/auth/me') return json(FX.auth_me);
    if (url.pathname === '/api/admin/dashboard/context') return json(FX.context);
    if (url.pathname === API) return json(emptyDistribution ? { ...WORKSPACE, distribution: { unassigned: [] } } : WORKSPACE);
    if (url.pathname === RECEIVABLE) return receivable === 'forbidden' ? json({ error: 'Accès refusé' }, 403) : json(receivable);
    return route.fulfill({ status: 404, body: '' });
  });
  if (pilot) {
    await page.goto(`${ORIGIN}/admin/workspaces/operations?market=KM`);
    await expect(page.locator('[data-workspace-view="hub"]')).toBeVisible();
    if (view) await page.locator(`[data-workspace-view="${view}"]`).click();
    return;
  }
  await page.goto(`${ORIGIN}/admin/hub-live?view=execute`);
  await page.locator('select').first().selectOption({ label: 'KM · Comores' });
  await expect(page.locator('h1')).toHaveText('Exécuter les opérations Hub');
  if (view) await page.locator(`[data-workspace-view="${view}"]`).click();
}

for (const [name, viewport] of [['desktop', { width: 1536, height: 1024 }], ['mobile', { width: 390, height: 844 }]]) {
  test.describe(`Hub live · Exécution — ${name}`, () => {
    test.use({ viewport });

    test('actions Hub uniquement : aucun onglet ni bouton Relais', async ({ page }) => {
      await mount(page);
      await expect(page.locator('[data-workspace-view]')).toHaveText(['Hub', 'Réception fournisseur', 'Approvisionnement', 'Stock à affecter']);
      await expect(page.locator('[data-workspace-action="mark-ordered"]')).toHaveCount(1);
      await expect(page.locator('[data-workspace-action="run-distribution"]')).toHaveCount(1);
      await expect(page.locator('[data-workspace-action="ship"]')).toHaveCount(1);
      await expect(page.locator('[data-workspace-action="confirm-cash"], [data-workspace-action="receive"], [data-workspace-action="collect"]')).toHaveCount(0);
    });

    test('L9a : « Répartir ce marché » est masqué quand aucune commande n’est à répartir', async ({ page }) => {
      await mount(page, { emptyDistribution: true });
      await expect(page.locator('[data-workspace-action="run-distribution"]')).toHaveCount(0);
      await expect(page.getByText('Aucune commande à répartir.')).toBeVisible();
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

    test('réception : PO, statut SHIPPED informatif, aucune quantité préremplie, bouton inactif', async ({ page }) => {
      await mount(page, { view: 'reception' });
      const card = page.locator(`[data-receive-po="${PO_ID}"]`);
      await expect(card).toContainText('CJ Dropshipping');
      await expect(card).toContainText('statut fournisseur : shipped (information, pas une réception)');
      await expect(card).toContainText('Partiel');
      const values = await card.locator('.kmc-workspace-receive-qty').evaluateAll(nodes => nodes.map(n => n.value));
      expect(values).toEqual(['', '']);
      await expect(card.locator('[data-workspace-action="receive-supplier"]')).toBeDisabled();
    });

    test('réception partielle : contenu exact (PO, SKU, quantité) envoyé une seule fois avec une référence stable', async ({ page }) => {
      const posts = [];
      await mount(page, { posts, view: 'reception' });
      const card = page.locator(`[data-receive-po="${PO_ID}"]`);
      await card.locator('[data-receive-line="0"]').fill('2');
      const button = card.locator('[data-workspace-action="receive-supplier"]');
      await expect(button).toBeEnabled();
      await button.dblclick();
      await expect.poll(() => posts.length).toBe(1);
      await page.waitForTimeout(300);
      expect(posts).toHaveLength(1);
      expect(posts[0].path).toBe(RECEIVE);
      expect(posts[0].body.contents).toEqual([{ purchase_order_id: PO_ID, product_sku_id: SKU_ID, quantity: 2 }]);
      expect(posts[0].body.reference).toMatch(/^SUPPLIER_PACKAGE-/);
      await expect(page.locator('[data-workspace-feedback]')).toContainText('Réception enregistrée');
    });

    test('quantité supérieure au restant : refusée côté interface, aucune requête', async ({ page }) => {
      const posts = [];
      await mount(page, { posts, view: 'reception' });
      const card = page.locator(`[data-receive-po="${PO_ID}"]`);
      await card.locator('[data-receive-line="0"]').fill('4');
      await expect(card.locator('[data-workspace-action="receive-supplier"]')).toBeDisabled();
      await expect(card).toContainText('Quantité invalide');
      expect(posts).toHaveLength(0);
    });

    test('sur-réception : quarantaine annoncée clairement (202), stock non augmenté', async ({ page }) => {
      await mount(page, { view: 'reception', receiveReply: { status: 202, body: { quarantined: true, reason_code: 'HUB_ALLOCATION_OVERRECEIVED', unit: { id: 'u2' } } } });
      const card = page.locator(`[data-receive-po="${PO_ID}"]`);
      await card.locator('[data-receive-line="1"]').fill('1');
      await card.locator('[data-workspace-action="receive-supplier"]').click();
      await expect(page.locator('[data-workspace-feedback]')).toContainText('quarantaine');
      await expect(page.locator('[data-workspace-feedback]')).toContainText('HUB_ALLOCATION_OVERRECEIVED');
    });

    test('référence déjà traitée : message « déjà traitée », sans nouvelle mutation annoncée', async ({ page }) => {
      await mount(page, { view: 'reception', receiveReply: { status: 200, body: { idempotent_replay: true, quarantined: false, unit: { id: 'u1', reference: 'SUPPLIER_PACKAGE-abc' } } } });
      const card = page.locator(`[data-receive-po="${PO_ID}"]`);
      await card.locator('[data-receive-line="0"]').fill('1');
      await card.locator('[data-workspace-action="receive-supplier"]').click();
      await expect(page.locator('[data-workspace-feedback]')).toContainText('déjà traitée');
    });

    test('conflit de référence (409) : message contrôlé, bouton réactivé', async ({ page }) => {
      await mount(page, { view: 'reception', receiveReply: { status: 409, body: { error: 'Cette référence de réception a déjà été utilisée avec un contenu différent', code: 'HUB_RECEPTION_REFERENCE_CONFLICT' } } });
      const card = page.locator(`[data-receive-po="${PO_ID}"]`);
      await card.locator('[data-receive-line="0"]').fill('1');
      await card.locator('[data-workspace-action="receive-supplier"]').click();
      await expect(page.locator('[data-workspace-feedback]')).toContainText('contenu différent');
      await expect(card.locator('[data-workspace-action="receive-supplier"]')).toBeEnabled();
    });

    test('lecture refusée (403) : réception indisponible, aucun formulaire', async ({ page }) => {
      await mount(page, { view: 'reception', receivable: 'forbidden' });
      await expect(page.locator('body')).toContainText('Réception indisponible : Accès refusé');
      await expect(page.locator('[data-workspace-action="receive-supplier"]')).toHaveCount(0);
    });

    test('réception : aucun débordement horizontal', async ({ page }) => {
      await mount(page, { view: 'reception' });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
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

test.describe('L9c — parité Hub live / workspace Hub & Relais', () => {
  test.use({ viewport: { width: 1536, height: 1024 } });
  test('Hub live Exécution propose tous les gestes Hub ; le workspace les lit sans bouton et renvoie vers Hub live', async ({ page }) => {
    await mount(page);
    for (const action of ['mark-ordered', 'run-distribution', 'ship']) await expect(page.locator(`[data-workspace-action="${action}"]`)).toHaveCount(1);
    await page.locator('[data-workspace-view="inventory"]').click();
    await expect(page.locator('[data-workspace-action="assign-inventory"]')).toHaveCount(1);
    await page.locator('[data-workspace-view="reception"]').click();
    await expect(page.locator('[data-workspace-action="receive-supplier"]')).toHaveCount(1);
  });
  test('workspace : onglets Hub et Stock en lecture seule, lien Exécuter dans Hub live avec le marché, Relais inchangé', async ({ page }) => {
    await mount(page, { pilot: true });
    await expect(page.locator('[data-workspace-action="mark-ordered"], [data-workspace-action="run-distribution"], [data-workspace-action="ship"]')).toHaveCount(0);
    await expect(page.locator('[data-action="open-hub-live"]')).toHaveAttribute('href', '/admin/hub-live?view=execute&market=KM');
    await expect(page.getByText('K-ORDER-1')).toBeVisible();
    await page.locator('[data-workspace-view="inventory"]').click();
    await expect(page.locator('[data-workspace-action="assign-inventory"]')).toHaveCount(0);
    await expect(page.locator('[data-action="open-hub-live"]')).toHaveCount(1);
    await page.locator('[data-workspace-view="relay"]').click();
    for (const action of ['confirm-cash', 'receive', 'collect']) await expect(page.locator(`[data-workspace-action="${action}"]`)).toHaveCount(1);
    await expect(page.locator('[data-action="open-hub-live"]')).toHaveCount(0);
  });
});
