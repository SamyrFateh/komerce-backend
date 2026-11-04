/**
 * @e2e   hub-live-flux-cockpit.spec.js
 * @feature dashboard (Hub live · cockpit « flux du besoin »)
 * @brief Cockpit Hub en desktop 1440 : trois zones (commandes/besoins, achats/PO, suivi physique), navigation bidirectionnelle
 *        commande ↔ PO, actions par rôle (agent Hub / responsable / admin), préparation de PO sans double envoi, réception
 *        partielle 2/3 FIFO (scénario KOM-101/102/103). API simulée : aucun serveur ni base requis.
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
const PO1 = '11111111-1111-4111-8111-111111111111';
const PO2 = '33333333-3333-4333-8333-333333333333';
const O101 = '00000000-0000-4000-8000-000000000101';
const O102 = '00000000-0000-4000-8000-000000000102';
const O103 = '00000000-0000-4000-8000-000000000103';
const IA1 = 'a1000000-0000-4000-8000-000000000001';
const IB1 = 'b1000000-0000-4000-8000-000000000001';
const IA2 = 'a2000000-0000-4000-8000-000000000002';
const IC3 = 'c3000000-0000-4000-8000-000000000003';

const WORKSPACE = {
  scope: { code: 'KM', name: 'Comores' },
  summary: { hub_to_order: 0, hub_unassigned: 0, hub_to_ship: 0, relay_cash_pending: 0, relay_to_receive: 0, relay_to_collect: 0, inventory_to_assign: 0 },
  queues: { hub: { to_order: [], to_ship: [] }, relay: { cash_pending: [], to_receive: [], to_collect: [] } },
  distribution: { unassigned: [] }, inventory: { items: [], open_parcels: [] },
};

const ORDERS = [
  { id: O101, reference: 'KOM-101', status: 'ordered', created_at: '2026-11-01T08:00:00Z', items: [
    { id: IA1, product: 'Produit A', ordered: 2, fulfillment_source: 'IMPORT' }, { id: IB1, product: 'Produit B', ordered: 1, fulfillment_source: 'IMPORT' }] },
  { id: O102, reference: 'KOM-102', status: 'ordered', created_at: '2026-11-01T09:00:00Z', items: [{ id: IA2, product: 'Produit A', ordered: 1, fulfillment_source: 'IMPORT' }] },
  { id: O103, reference: 'KOM-103', status: 'ordered', created_at: '2026-11-01T10:00:00Z', items: [{ id: IC3, product: 'Produit C', ordered: 2, fulfillment_source: 'IMPORT', purchasing_missing: 2 }] },
];

function dossier({ status, received, authorizations, sentAt }) {
  return {
    market: { id: 'm1', code: 'KM', name: 'Comores' }, generated_at: '2026-11-02T10:00:00Z',
    kpis: { orders_waiting: 3, lines_open: 3, po_draft: status === 'draft' ? 1 : 0, po_issued_not_sent: 0, po_sent_unconfirmed: 0, qty_missing: 3 - received, qty_anomaly: 0, boxes_open: 0, boxes_unshipped: 0 },
    orders: ORDERS.map((o) => ({ ...o, items: o.items.map((i) => ({ ...i, received: i.id === IA1 ? Math.min(received, 2) : 0 })) })),
    needs: [], client_parcels: [], receipts: [], boxes: [], open_shipments: [], to_handle: [],
    purchase_orders: [{
      id: PO1, status, supplier_name: 'Fournisseur A', sent_at: sentAt || null, confirmed_at: null, authorizations,
      totals: { effective: 3, received, missing: 3 - received, anomaly: 0 },
      lines: [
        { line_id: 'l-101', order_id: O101, order_item_id: IA1, order_ref: 'KOM-101', product: 'Produit A', ordered: 2, confirmed: 2, received: Math.min(received, 2), missing: 2 - Math.min(received, 2), fifo_rank: 1, fifo_next: received < 2 },
        { line_id: 'l-102', order_id: O102, order_item_id: IA2, order_ref: 'KOM-102', product: 'Produit A', ordered: 1, confirmed: 1, received: 0, missing: 1, fifo_rank: 2, fifo_next: received >= 2 },
      ],
    }],
  };
}

const NEED_BATCH = [{
  key: 'sup-A|KM|', supplier_id: 'sup-A', supplier_name: 'Fournisseur A', procurement_hub_ref: null, quantity: 3, compatible_draft_po_ids: [],
  groups: [{ key: 'g-A', product: 'Produit A', supplier_sku: 'SKU-A', quantity: 3, lines: [
    { line_id: 'l-101', order_ref: 'KOM-101' }, { line_id: 'l-102', order_ref: 'KOM-102' }] }],
}];

const ROLES = {
  agent: { role: 'agent_hub', can_authorize_commitment: false, can_authorize_payment: false },
  directrice: { role: 'agent_hub', can_authorize_commitment: true, can_authorize_payment: true },
  admin: { role: 'admin', can_authorize_commitment: false, can_authorize_payment: false },
};

test.use({ viewport: { width: 1440, height: 900 } });

async function mount(page, { source, viewer = ROLES.agent, todo = [], needBatches = [], posts = [], delay = 0 } = {}) {
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
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return json({ ok: true, purchase_order_id: PO1 }, 201);
    }
    if (url.pathname === '/api/auth/me') return json(FX.auth_me);
    if (url.pathname === '/api/admin/dashboard/context') return json(FX.context);
    if (url.pathname === API) return json(WORKSPACE);
    if (url.pathname === '/api/scans/hub/receivable') return json({ purchase_orders: [] });
    if (url.pathname === `${API}/supply`) return json(shapeDossier(source, { viewer, todo, needBatches }));
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${ORIGIN}/admin/hub-live?view=execute`);
  await page.locator('select').first().selectOption({ label: 'KM · Comores' });
  await expect(page.locator('h1')).toHaveText('Hub live · Dossiers');
  await page.locator('[data-workspace-view="supply"]').click();
  await expect(page.locator('[data-hub-cockpit]')).toBeVisible();
}

test.describe('Hub live · cockpit flux du besoin — desktop 1440', () => {
  test('trois zones : commandes et achats dominants, suivi physique plus étroit, sans débordement', async ({ page }) => {
    await mount(page, { source: dossier({ status: 'notified', received: 2, authorizations: { commitment: { id: 'c' }, payment: null }, sentAt: '2026-11-02T09:00:00Z' }) });
    const zones = await page.evaluate(() => ['orders', 'purchases', 'physical'].map((z) => {
      const r = document.querySelector(`[data-hlc-zone="${z}"]`).getBoundingClientRect();
      return { x: r.x, w: r.width };
    }));
    expect(zones[0].x).toBeLessThan(zones[1].x);
    expect(zones[1].x).toBeLessThan(zones[2].x);
    expect(zones[2].w).toBeLessThan(zones[0].w);
    expect(zones[2].w).toBeLessThan(zones[1].w);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.locator('table.kmc-hub-board')).toHaveCount(0);
  });

  test('réception partielle 2/3 : KOM-101 servie d’abord (FIFO), reliquat KOM-102 conservé, KOM-101 non prête', async ({ page }) => {
    await mount(page, { source: dossier({ status: 'notified', received: 2, authorizations: { commitment: { id: 'c' }, payment: null }, sentAt: '2026-11-02T09:00:00Z' }) });
    const c101 = page.locator(`[data-hlc-order="${O101}"]`);
    const c102 = page.locator(`[data-hlc-order="${O102}"]`);
    await expect(c101.locator('.hlc-nums')).toContainText('2 reçu');
    await expect(c101.locator('.hlc-nums')).toContainText('1 reste à livrer');
    await expect(c102.locator('.hlc-nums')).toContainText('0 reçu');
    await expect(c102.locator('.hlc-nums')).toContainText('1 reste à livrer');
    await expect(page.locator(`[data-hlc-po="${PO1}"]`)).toContainText('FIFO');
    await expect(c101).not.toContainText('Prête à emballer');
    await expect(page.locator(`[data-hlc-order="${O103}"] .hlc-nums`)).toContainText('2 non couvert');
    await page.screenshot({ path: 'test-results/hub-live-flux-cockpit-partial-1440.png', fullPage: true });
  });

  test('navigation bidirectionnelle : commande → PO → commande, sans mutation', async ({ page }) => {
    const posts = [];
    await mount(page, { source: dossier({ status: 'notified', received: 2, authorizations: { commitment: { id: 'c' }, payment: null }, sentAt: '2026-11-02T09:00:00Z' }), posts });
    await page.locator(`[data-hlc-order="${O102}"]`).click();
    await expect(page.locator(`[data-hlc-po="${PO1}"]`)).toHaveClass(/is-related/);
    await expect(page.locator('[data-hlc-po-line].is-highlight')).toHaveCount(1);
    await expect(page.locator('[data-hlc-po-line].is-highlight')).toContainText('KOM-102');
    await page.locator(`[data-hlc-po="${PO1}"]`).click();
    await expect(page.locator(`[data-hlc-order="${O101}"]`)).toHaveClass(/is-related/);
    await expect(page.locator(`[data-hlc-order="${O102}"]`)).toHaveClass(/is-related/);
    await expect(page.locator(`[data-hlc-order="${O103}"]`)).not.toHaveClass(/is-related/);
    await page.locator(`[data-hlc-po="${PO1}"] [data-hlc-goto-order="${O101}"]`).first().click();
    await expect(page.locator('[data-hub-cockpit]')).toHaveAttribute('data-hlc-selection', `order:${O101}`);
    expect(posts).toHaveLength(0);
  });

  test('rôles : agent Hub et admin voient l’engagement désactivé avec raison, la responsable peut le valider', async ({ page }) => {
    for (const key of ['agent', 'admin']) {
      await mount(page, { source: dossier({ status: 'draft', received: 0, authorizations: { commitment: null, payment: null } }), viewer: ROLES[key] });
      const button = page.locator(`[data-hlc-po="${PO1}"] [data-hlc-action="authorize-commitment"]`);
      await expect(button).toBeDisabled();
      await expect(page.locator(`[data-hlc-po="${PO1}"]`)).toContainText('Réservé à la responsable Hub');
      await page.unroute(`${ORIGIN}/**`);
    }
  });

  test('responsable : valider l’engagement poste la pièce, une seule fois malgré le double clic', async ({ page }) => {
    const posts = [];
    await mount(page, { source: dossier({ status: 'draft', received: 0, authorizations: { commitment: null, payment: null } }), viewer: ROLES.directrice, posts, delay: 200 });
    const card = page.locator(`[data-hlc-po="${PO1}"]`);
    await card.locator('[data-hlc-action="authorize-commitment"]').click();
    const form = card.locator('[data-hlc-form="commitment"]');
    await form.locator('input[name="proof_ref"]').fill('BC-2026-11');
    await form.locator('input[name="amount"]').fill('120');
    await form.locator('input[name="currency"]').fill('usd');
    await form.locator('[data-hlc-action="submit-commitment"]').dblclick();
    await expect.poll(() => posts.length).toBeGreaterThan(0);
    await page.waitForTimeout(400);
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe(`/api/purchasing/po/${PO1}/authorize-commitment`);
    expect(posts[0].body).toMatchObject({ proof_ref: 'BC-2026-11', amount: 120, currency: 'USD' });
  });

  test('préparer une PO depuis les besoins cochés : un seul POST /po/prepare avec les lignes KOM-101 et KOM-102', async ({ page }) => {
    const posts = [];
    const source = dossier({ status: 'draft', received: 0, authorizations: { commitment: null, payment: null } });
    source.purchase_orders = [];
    await mount(page, { source, needBatches: NEED_BATCH, posts, delay: 200 });
    const prepare = page.locator('[data-hlc-prepare]');
    await expect(prepare).toBeDisabled();
    await page.locator('[data-hlc-need-check="g-A"]').check();
    await expect(prepare).toBeEnabled();
    await prepare.dblclick();
    await expect.poll(() => posts.length).toBeGreaterThan(0);
    await page.waitForTimeout(400);
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe('/api/purchasing/po/prepare');
    expect(posts[0].body).toMatchObject({ supplier_id: 'sup-A', line_ids: ['l-101', 'l-102'] });
  });

  test('« À faire maintenant » : message complet (manque, raison, responsable) et action bloquée avec sa raison', async ({ page }) => {
    const todo = [{
      kind: 'AUTHORIZE_COMMITMENT', owner: 'responsable_hub', title: 'Valider l’engagement de la PO Fournisseur A',
      missing: 'Engagement non validé', why: 'Aucune commande fournisseur sans engagement', viewer_can_act: false,
      blocked_reason: 'Réservé à la responsable Hub', action: { type: 'authorize_commitment', label: 'Valider l’engagement', po_id: PO1 },
    }];
    await mount(page, { source: dossier({ status: 'draft', received: 0, authorizations: { commitment: null, payment: null } }), todo });
    const item = page.locator('[data-hlc-todo-item="AUTHORIZE_COMMITMENT"]');
    await expect(item).toContainText('Engagement non validé');
    await expect(item).toContainText('Aucune commande fournisseur sans engagement');
    await expect(item).toContainText('Responsable Hub');
    await expect(item).toContainText('Réservé à la responsable Hub');
    await expect(item.locator('button')).toBeDisabled();
  });
});
