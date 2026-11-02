/**
 * @e2e   relais-live-execution.spec.js
 * @feature dashboard (Relais live · Exécution, /admin/relais-live?view=execute)
 * @brief Les opérations Relais (encaisser, réceptionner, remettre) sont exécutables depuis Relais live,
 *        via les routes canoniques du Workspace (une seule mutation par clic, marché conservé, aucune action Hub).
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
const CASH_API = '/api/admin/workspaces/accounting/market/KM';
const CASH = {
  scope: { code: 'KM', name: 'Comores' },
  filters: { from: '2026-10-01', to: '2026-10-12', hours: 48 },
  summary: { expected_kmf: 0, collected_kmf: 0, held_kmf: 0, closed_kmf: 0, transfers_to_act: 0, holders_over_ceiling: 0, holders_overdue: 0, legacy_to_regularize_kmf: 0, pending_deposits: 0, uncollected_kmf: 0 },
  reconciliation: { expected_kmf: 0, collected_kmf: 0, transferred_kmf: 0, closed_kmf: 0, lost_kmf: 0, held_kmf: 0, gap_collection_kmf: 0, gap_closure_kmf: 0 },
  custody: { limits: {}, holders: [], recipients: [], destinations: [], transfers: [], legacy_to_regularize: [] },
  deposits: [], uncollected: [], collections: [], invoices: [],
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


const ITEM_A = '11111111-1111-4111-8111-111111111111';
const ITEM_B = '22222222-2222-4222-8222-222222222222';
const RELAY_SHIPMENTS = {
  market: { code: 'KM' },
  shipments: [{
    reference: 'SHIP-KM-1', stage: 'local_delivery', receivable: true,
    boxes: [{
      unit_id: 'box-1', reference: 'BOX-KM-1', state: 'DISPATCHED',
      orders: [{ order_id: 'o1', reference: 'K-ORDER-1', items: [
        { order_item_id: ITEM_A, product: 'Coque', ordered: 4, expected: 3, shipped: 3, missing: 1, received: null, received_gap: null, incident_id: null, handed: 0 },
        { order_item_id: ITEM_B, product: 'Câble', ordered: 2, expected: 2, shipped: 2, missing: 0, received: 2, received_gap: 0, incident_id: null, handed: 1 },
      ] }],
    }],
  }],
};

async function mount(page, posts = []) {
  page.on('dialog', (dialog) => dialog.accept());
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.pathname === '/admin/relais-live') return route.fulfill({ contentType: 'text/html', path: path.join(CANONICAL, 'index.html') });
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (route.request().method() === 'POST') {
      posts.push({ path: url.pathname, body: route.request().postDataJSON() });
      await new Promise((resolve) => setTimeout(resolve, 150));
      return json({ ok: true, result: { receipts: [{ incident_id: 'inc-1' }] } });
    }
    if (url.pathname === '/api/auth/me') return json(FX.auth_me);
    if (url.pathname === '/api/admin/dashboard/context') return json(FX.context);
    if (url.pathname === API) return json(WORKSPACE);
    if (url.pathname === `${API}/relay-shipments`) return json(RELAY_SHIPMENTS);
    if (url.pathname === CASH_API) return json(CASH);
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${ORIGIN}/admin/relais-live?view=execute`);
  await page.locator('select').first().selectOption({ label: 'KM · Comores' });
  await expect(page.locator('h1')).toHaveText('Exécuter les opérations Relais');
}

for (const [name, viewport] of [['desktop', { width: 1536, height: 1024 }], ['mobile', { width: 390, height: 844 }]]) {
  test.describe(`Relais live · Exécution — ${name}`, () => {
    test.use({ viewport });

    test('actions Relais uniquement : aucune action Hub', async ({ page }) => {
      await mount(page);
      await expect(page.locator('[data-workspace-action="confirm-cash"]')).toHaveCount(1);
      await expect(page.locator('[data-workspace-action="receive"]')).toHaveCount(1);
      await expect(page.locator('[data-workspace-action="collect"]')).toHaveCount(1);
      await expect(page.locator('[data-workspace-action="mark-ordered"], [data-workspace-action="ship"], [data-workspace-action="run-distribution"]')).toHaveCount(0);
    });

    test('encaisser, réceptionner, remettre : une mutation par clic sur les routes du marché', async ({ page }) => {
      const posts = [];
      await mount(page, posts);
      await page.locator('[data-workspace-action="confirm-cash"]').click();
      await expect.poll(() => posts.length).toBe(1);
      await page.locator('[data-workspace-action="receive"]').click();
      await expect.poll(() => posts.length).toBe(2);
      await page.locator('[data-workspace-action="collect"]').click();
      await expect.poll(() => posts.length).toBe(3);
      expect(posts.map((p) => p.path)).toEqual([
        `${API}/orders/K-CASH-1/confirm-cash`,
        `${API}/parcels/PCL-KM-2/receive`,
        `${API}/parcels/PCL-KM-3/collect`,
      ]);
    });

    test('contenu réellement expédié : expédition → KOM-BOX → commande → article ; le reçu n\'est jamais prérempli et l\'attestation part du relais', async ({ page }) => {
      const posts = [];
      await mount(page, posts);
      const shipment = page.locator('[data-relay-shipment="SHIP-KM-1"]');
      await expect(shipment).toContainText('KOM-BOX BOX-KM-1');
      await expect(shipment).toContainText('Commande K-ORDER-1');
      const coque = shipment.locator(`[data-relay-item="${ITEM_A}"]`);
      await expect(coque.locator('td').nth(1)).toHaveText('3');   // attendu
      await expect(coque.locator('td').nth(3)).toHaveText('1');   // manquant / reliquat
      await expect(coque.locator('input[data-relay-received]')).toHaveValue('');
      await expect(shipment.locator(`[data-relay-item="${ITEM_B}"]`)).toContainText('2'); // déjà attesté
      await expect(shipment.locator(`[data-relay-item="${ITEM_B}"] input`)).toHaveCount(0);
      await coque.locator('input[data-relay-received]').fill('2');
      await page.locator('[data-relay-proof]').fill('BORD-1');
      await page.locator('[data-workspace-action="relay-shipment-receive"]').click();
      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0].path).toBe(`${API}/relay-shipments/SHIP-KM-1/receive`);
      expect(posts[0].body).toEqual({ proof_ref: 'BORD-1', lines: [{ order_item_id: ITEM_A, received_qty: 2 }] });
      await expect(page.locator('[data-workspace-feedback]')).toContainText('écart enregistré en incident');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });

    test('Cash & dépôts est hébergé dans Relais live (module canonique, même route marché)', async ({ page }) => {
      await mount(page);
      await page.locator('[data-workspace-view="cash"]').click();
      await expect(page.locator('[data-relay-cash-host]').getByText('Cash & dépôts').first()).toBeVisible();
    });

    test('double clic : une seule mutation', async ({ page }) => {
      const posts = [];
      await mount(page, posts);
      await page.locator('[data-workspace-action="collect"]').dblclick();
      await page.waitForTimeout(400);
      expect(posts.filter((p) => p.path.endsWith('/collect'))).toHaveLength(1);
    });
  });
}
