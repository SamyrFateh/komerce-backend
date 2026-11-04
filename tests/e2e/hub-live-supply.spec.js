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
const { shapeDossier } = require('./fixtures/hub-cockpit-shape');

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
  orders: [{ id: '4def6c00-67b9-4584-85ed-00d2b8a24292', reference: 'K-C2', status: 'ordered',
    items: [{ id: 'aa03f8af-6229-4252-b8a7-aac02e1c7701', product: 'Câble USB', ordered: 3, fulfillment_source: 'IMPORT' }] }],
  client_parcels: [{ id: 'client-1', order_id: '4def6c00-67b9-4584-85ed-00d2b8a24292', reference: 'PCL-C2',
    status: 'preparation', contents: [{ order_item_id: 'aa03f8af-6229-4252-b8a7-aac02e1c7701', quantity: 2, allocated: 2, packed: 1, shipped: 0 }] }],
  needs: [{ line_id: 'l9', order_ref: 'K-C3', product_name: 'Câble USB', supplier_name: 'Fournisseur A', quantity: 2 }],
  purchase_orders: [{
    id: PO, status: 'notified', stage: 'issued_not_sent', supplier_name: 'Fournisseur A', sent_at: null, sent_channel: null,
    totals: { effective: 6, received: 5, missing: 1, anomaly: 0 },
    lines: [{ line_id: 'l1', order_id: '4def6c00-67b9-4584-85ed-00d2b8a24292', order_item_id: 'aa03f8af-6229-4252-b8a7-aac02e1c7701', order_ref: 'K-C2', product: 'Câble USB', ordered: 3, confirmed: 3, received: 2, missing: 1, anomaly: 0 }],
  }],
  receipts: [{ id: 'u1', reference: 'COLIS-1', external_ref: 'EXT-1', state: 'ALLOCATED', received_at: '2026-11-01T09:00:00Z', qty: 4 }],
  boxes: [
    { unit_id: BOX, reference: 'BOX-1', state: 'PACKED', shipment_ref: null, shipment_stage: null, contents: [{ order_ref: 'K-C1', line_id: 'l2', qty: 3 }] },
    { unit_id: 'b2', reference: 'BOX-2', state: 'PACKED', shipment_ref: 'SHIP-1', shipment_stage: 'hub_ready', contents: [{ order_id: '4def6c00-67b9-4584-85ed-00d2b8a24292', order_ref: 'K-C2', line_id: 'l1', qty: 2 }] },
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

async function mount(page, posts, openPhysical = true) {
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
    if (url.pathname === `${API}/supply`) return json(shapeDossier(DOSSIER));
    if (url.pathname === `${API}/supply/trace`) return json(TRACE);
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${ORIGIN}/admin/hub-live?view=execute`);
  await page.locator('select').first().selectOption({ label: 'KM · Comores' });
  await expect(page.locator('h1')).toHaveText('Hub live · Dossiers');
  await page.locator('[data-workspace-view="supply"]').click();
  if (openPhysical) await page.locator('[data-hub-physical-details] > summary').click();
}

test.describe('Hub live · Approvisionnement — desktop 1440', () => {
  test('cockpit : PO non envoyée, réception partielle, reliquat et rattachement distinct', async ({ page }) => {
    await mount(page, [], false);
    const pos = page.locator('[data-supply-pos]');
    const card = page.locator('[data-hlc-order="4def6c00-67b9-4584-85ed-00d2b8a24292"]');
    await expect(pos).not.toContainText('Envoyée');
    await expect(card.locator('.hlc-nums')).toContainText('2 reçu');
    await expect(card.locator('.hlc-nums')).toContainText('1 reste à livrer');
    await expect(card).not.toContainText('remboursé');
    await expect(page.locator('[data-hlc-po]')).toHaveCount(1);
    await expect(page.locator('[data-hlc-po] [data-hlc-steps] [data-step]')).toHaveCount(5);
    await expect(page.locator('.kmc-hub-board')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/hub-live-supply-1440.png', fullPage: true });
  });

  test('navigation bidirectionnelle commande ↔ PO, sans mutation', async ({ page }) => {
    const posts = [];
    await mount(page, posts, false);
    await page.locator('[data-hlc-order="4def6c00-67b9-4584-85ed-00d2b8a24292"]').click();
    await expect(page.locator(`[data-hlc-po="${PO}"]`)).toHaveClass(/is-related/);
    await expect(page.locator(`[data-hlc-po="${PO}"] [data-hlc-po-line].is-highlight`)).toHaveCount(1);
    await page.locator(`[data-hlc-po="${PO}"]`).click();
    await expect(page.locator('[data-hlc-order="4def6c00-67b9-4584-85ed-00d2b8a24292"]')).toHaveClass(/is-related/);
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
    await expect(create).toBeEnabled();
    await create.click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({ path: `${API}/boxes/shipment`, body: {
      reference: 'SHIP-NEW', hub_unit_ids: [BOX] } });
    await expect(boxes.getByLabel('Inclure BOX-2')).toHaveCount(0);
  });
  test('ouvrir un dossier vide sans transitaire ni preuve', async ({ page }) => {
    const posts = [];
    await mount(page, posts);
    const boxes = page.locator('[data-supply-boxes]');
    const button = boxes.locator('[data-workspace-action="create-shipment-from-boxes"]');
    await boxes.getByLabel('Référence de la nouvelle expédition').fill('SHIP-EMPTY');
    await expect(button).toBeEnabled();
    await expect(boxes.getByLabel('Transitaire', {exact:true})).toHaveCount(0);
    await expect(boxes.getByLabel('Preuve de création')).toHaveCount(0);
    await button.click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({path:`${API}/boxes/shipment`,body:{reference:'SHIP-EMPTY',hub_unit_ids:[]}});
  });
  test('un carton rattaché reste détachable avant la remise', async ({ page }) => {
    const posts = [];
    await mount(page, posts);
    const button = page.locator('[data-supply-boxes] [data-workspace-action="detach-box-shipment"]');
    await expect(button).toHaveCount(1);
    await button.click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({path:`${API}/boxes/b2/detach`,body:{}});
  });

});

test.describe('Hub live · Approvisionnement — mobile 390', () => {
  test('la preuve physique du colis client reste lisible sans débordement horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mount(page, [], false);
    await expect(page.locator('[data-hlc-order]').first()).toContainText('1 reste à livrer');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
