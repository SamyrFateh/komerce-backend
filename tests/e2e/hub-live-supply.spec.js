/**
 * @e2e   hub-live-supply.spec.js
 * @feature dashboard (Hub live · Exécution · Approvisionnement)
 * @brief Poste de travail Hub P0 en desktop 1440 : KPI, « À traiter », PO avec étape dérivée (un bon émis n'est pas un envoi),
 *        réception partielle visible, cartons, rattachement à une expédition, filiation. API simulée : aucun serveur ni base requis.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pricing-atelier-km.json'), 'utf8'));
const ORIGIN = 'http://komerce.test';
const API = '/api/admin/workspaces/operations/market/KM';
const PO = '11111111-1111-4111-8111-111111111111';
const BOX = '22222222-2222-4222-8222-222222222222';

const WORKSPACE = {
  scope: { code: 'KM', name: 'Comores' },
  summary: { hub_to_order: 0, hub_unassigned: 0, hub_to_ship: 0, relay_cash_pending: 0, relay_to_receive: 0, relay_to_collect: 0, inventory_to_assign: 0 },
  queues: { hub: { to_order: [], to_ship: [] }, relay: { cash_pending: [], to_receive: [], to_collect: [] } },
  distribution: { unassigned: [] },
  inventory: { items: [], open_parcels: [] },
};

const DOSSIER = {
  market: { id: 'm1', code: 'KM', name: 'Comores' },
  generated_at: '2026-11-01T10:00:00Z',
  kpis: { orders_waiting: 2, lines_open: 1, po_draft: 0, po_issued_not_sent: 1, po_sent_unconfirmed: 0, qty_missing: 1, qty_anomaly: 0, boxes_open: 2, boxes_unshipped: 1 },
  needs: [{ line_id: 'l9', order_ref: 'K-C3', product_name: 'Câble USB', supplier_name: 'Fournisseur A', quantity: 2 }],
  purchase_orders: [{
    id: PO, status: 'notified', stage: 'issued_not_sent', supplier_name: 'Fournisseur A', sent_at: null, sent_channel: null,
    totals: { effective: 6, received: 5, missing: 1, anomaly: 0 },
    lines: [{ line_id: 'l1', order_ref: 'K-C2', ordered: 3, confirmed: 3, received: 2, missing: 1, anomaly: 0 }],
  }],
  receipts: [{ id: 'u1', reference: 'COLIS-1', external_ref: 'EXT-1', state: 'ALLOCATED', received_at: '2026-11-01T09:00:00Z', qty: 4 }],
  boxes: [
    { unit_id: BOX, reference: 'BOX-1', state: 'PACKED', shipment_ref: null, shipment_stage: null, contents: [{ order_ref: 'K-C1', line_id: 'l2', qty: 3 }] },
    { unit_id: 'b2', reference: 'BOX-2', state: 'PACKED', shipment_ref: 'SHIP-1', shipment_stage: 'hub_ready', contents: [{ order_ref: 'K-C2', line_id: 'l1', qty: 2 }] },
  ],
  open_shipments: [{ reference: 'SHIP-2', forwarder_name: 'Transitaire X', transport_mode: 'sea', box_count: 0 }],
  to_handle: [{ kind: 'PO_MISSING_QTY', po_id: PO, supplier_name: 'Fournisseur A', reason: '1 unité(s) confirmée(s) non reçue(s)' }],
};

const TRACE = { chain: [{
  order_ref: 'K-C2', product: 'Câble USB', ordered: 3, purchase_order: { id: PO, status: 'notified' },
  placements: [
    { quantity: 2, active: false, unit: { reference: 'COLIS-1', type: 'SUPPLIER_PACKAGE', state: 'ALLOCATED' }, shipment: null },
    { quantity: 2, active: true, unit: { reference: 'BOX-2', type: 'MARKET_PARCEL', state: 'PACKED' }, shipment: { reference: 'SHIP-1', stage: 'hub_ready' } },
  ],
}] };

test.use({ viewport: { width: 1440, height: 900 } });

async function mount(page, posts) {
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
      return json({ unit_id: BOX, shipment_reference: 'SHIP-2', already_attached: false, result: { reference: 'SHIP-NEW' } }, 201);
    }
    if (url.pathname === '/api/auth/me') return json(FX.auth_me);
    if (url.pathname === '/api/admin/dashboard/context') return json(FX.context);
    if (url.pathname === API) return json(WORKSPACE);
    if (url.pathname === '/api/scans/hub/receivable') return json({ purchase_orders: [] });
    if (url.pathname === `${API}/supply`) return json(DOSSIER);
    if (url.pathname === `${API}/supply/trace`) return json(TRACE);
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${ORIGIN}/admin/hub-live?view=execute`);
  await page.locator('select').first().selectOption({ label: 'KM · Comores' });
  await expect(page.locator('h1')).toHaveText('Exécuter les opérations Hub');
  await page.locator('[data-workspace-view="supply"]').click();
}

test.describe('Hub live · Approvisionnement — desktop 1440', () => {
  test('un bon émis n’est pas un envoi ; la réception partielle et le manquant sont visibles', async ({ page }) => {
    await mount(page, []);
    const pos = page.locator('[data-supply-pos]');
    await expect(pos).toContainText('Bon émis, envoi non prouvé');
    await expect(pos).not.toContainText('Envoyée');
    await expect(pos).toContainText('5 / 6');
    await expect(page.locator('[data-supply-to-handle]')).toContainText('1 unité(s) confirmée(s) non reçue(s)');
    await expect(page.getByText('Quantités manquantes')).toBeVisible();
    await page.screenshot({ path: 'test-results/hub-live-supply-1440.png', fullPage: true });
  });

  test('filiation : commande → PO → colis → carton → expédition, en lecture seule', async ({ page }) => {
    const posts = [];
    await mount(page, posts);
    await page.locator('[data-supply-pos] [data-workspace-action="show-trace"]').click();
    const trace = page.locator('[data-supply-trace]');
    await expect(trace).toContainText('COLIS-1');
    await expect(trace).toContainText('BOX-2');
    await expect(trace).toContainText('SHIP-1');
    expect(posts).toHaveLength(0);
  });

  test('rattachement d’un carton à l’expédition choisie : sans ressaisie, une mutation, seulement si non rattaché', async ({ page }) => {
    const posts = [];
    await mount(page, posts);
    const boxes = page.locator('[data-supply-boxes]');
    const button = boxes.locator('[data-workspace-action="attach-box-shipment"]');
    await expect(button).toHaveCount(1);
    await expect(button).toBeDisabled();
    await boxes.locator('[data-supply-shipment-bar] select').first().selectOption('SHIP-2');
    await expect(button).toBeEnabled();
    await button.click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({ path: `${API}/boxes/${BOX}/shipment`, body: { shipment_reference: 'SHIP-2' } });
  });

  test('création d’une expédition depuis les cartons cochés : un seul appel, ids des cartons', async ({ page }) => {
    const posts = [];
    await mount(page, posts);
    const boxes = page.locator('[data-supply-boxes]');
    const create = boxes.locator('[data-workspace-action="create-shipment-from-boxes"]');
    await expect(create).toBeDisabled();
    await boxes.getByLabel('Inclure BOX-1').check();
    await boxes.getByLabel('Référence de la nouvelle expédition').fill('SHIP-NEW');
    await boxes.getByLabel('Transitaire', { exact: true }).fill('Transitaire X');
    await boxes.getByLabel('Preuve de création').fill('BL-123');
    await expect(create).toBeEnabled();
    await create.click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({ path: `${API}/boxes/shipment`, body: {
      reference: 'SHIP-NEW', forwarder_name: 'Transitaire X', transport_mode: 'sea', proof_ref: 'BL-123', hub_unit_ids: [BOX] } });
    await expect(boxes.getByLabel('Inclure BOX-2')).toHaveCount(0);
  });
});
