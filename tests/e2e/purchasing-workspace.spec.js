/**
 * @e2e   purchasing-workspace.spec.js
 * @feature dashboard (espace « Achats fournisseurs »), purchasing (routes PR 4/5 consommées)
 * @brief Parcours navigateur de l'espace /admin/workspaces/purchasing : liste groupée (fournisseur + Hub,
 *        marché visible par ligne), sélection, préparation (un double clic ne crée qu'une commande),
 *        détail brouillon (détacher), soumission, confirmation partielle (reliquat), refus de
 *        soumission, projection de l’exécution fournisseur persistée, absence de débordement mobile et desktop.
 *        API simulée avec état : aucun serveur ni base requis.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';
const PAGE_PATH = '/admin/workspaces/purchasing';
const CSS = ['base', 'canonical-theme-v2', 'canonical-shell-v4', 'canonical-legacy-theme-v1', 'operations-workspace', 'purchasing-workspace'];

const SUPPLIER = { id: '11111111-1111-4111-8111-111111111111', name: 'Allegro Pologne' };
const HUB = 'HUB-001';
const KM = { market_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', market_code: 'KM', market_name: 'Comores' };
const CM = { market_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', market_code: 'CM', market_name: 'Cameroun' };

function makeLine(n, market, qty, extra = {}) {
  return {
    line_id: `00000000-0000-4000-8000-00000000000${n}`,
    purchase_order_id: null,
    order_id: `order-${n}`,
    order_reference: `KOM-${1000 + n}`,
    order_item_id: `item-${n}`,
    ...market,
    product_name: `Produit ${n}`,
    supplier_sku: `SKU-${n}`,
    supplier_unit_ref: n <= 2 ? 'UNIT-A' : 'UNIT-B',
    quantity: qty,
    effective_quantity: qty,
    cancelled: false,
    expected_unit_price: 12.5,
    supplier_currency: 'PLN',
    groupable: true,
    parent_line_id: null,
    confirmed_quantity: null,
    ...extra,
  };
}

function emptyExecution() {
  return { orders: [], order_lines: [], groups: [], group_members: [], payments: [], proofs: [], events: [] };
}

function summarize(lines) {
  const byMarket = new Map();
  lines.filter((l) => !l.cancelled).forEach((l) => {
    const m = byMarket.get(l.market_id) || { market_id: l.market_id, market_code: l.market_code, market_name: l.market_name, lines: 0, quantity: 0 };
    m.lines += 1;
    m.quantity += l.effective_quantity;
    byMarket.set(l.market_id, m);
  });
  const markets = [...byMarket.values()];
  return { markets, multi_market: markets.length > 1 };
}

/** API d'achats simulée avec état ; chaque appel mutant est journalisé dans `calls`. */
function createFakeApi({ submitRefusal = false } = {}) {
  const state = {
    lines: [makeLine(1, KM, 5), makeLine(2, CM, 3), makeLine(3, KM, 4)],
    pos: new Map(),
    executions: new Map(),
    calls: [],
    nextPo: 1,
    nextRemnant: 9,
  };
  const openLines = () => state.lines.filter((l) => !l.purchase_order_id && !l.cancelled);
  const poLines = (poId) => state.lines.filter((l) => l.purchase_order_id === poId);

  async function handle(method, pathname, search, body) {
    const key = `${method} ${pathname}`;
    if (method === 'POST') state.calls.push({ key, body });

    if (key === 'GET /api/purchasing/open-lines') {
      const lines = openLines();
      const groups = lines.length ? [{
        supplier_id: SUPPLIER.id, supplier_name: SUPPLIER.name, procurement_hub_ref: HUB, currencies: ['PLN'],
        lines, by_supplier_unit_ref: [], ...summarize(lines),
      }] : [];
      return { status: 200, json: { filter: { market_id: null }, groups, total_lines: lines.length } };
    }
    if (key === 'POST /api/purchasing/po/prepare') {
      await new Promise((r) => setTimeout(r, 300));
      const id = `cccccccc-cccc-4ccc-8ccc-00000000000${state.nextPo++}`;
      const po = { id, status: 'draft', procurement_hub_ref: body.procurement_hub_ref, supplier_id: body.supplier_id };
      state.pos.set(id, po);
      state.lines.forEach((l) => { if (body.line_ids.includes(l.line_id)) l.purchase_order_id = id; });
      return { status: 201, json: { purchase_order: po, line_ids: body.line_ids, lines: poLines(id), ...summarize(poLines(id)) } };
    }
    const poMatch = pathname.match(/^\/api\/purchasing\/po\/([^/]+)(?:\/(detach|discard|submit|confirm))?$/);
    if (poMatch) {
      const po = state.pos.get(poMatch[1]);
      if (!po) return { status: 404, json: { error: 'PO introuvable', code: 'PURCHASE_ORDER_NOT_FOUND' } };
      const action = poMatch[2];
      if (!action && method === 'GET') return { status: 200, json: { purchase_order: po, lines: poLines(po.id), ...summarize(poLines(po.id)), supplier_execution: state.executions.get(po.id) || emptyExecution() } };
      if (action === 'detach') {
        state.lines.forEach((l) => { if (body.line_ids.includes(l.line_id)) l.purchase_order_id = null; });
        return { status: 200, json: { purchase_order_id: po.id, detached: body.line_ids, remaining_lines: poLines(po.id).length } };
      }
      if (action === 'discard') {
        state.lines.forEach((l) => { if (l.purchase_order_id === po.id) l.purchase_order_id = null; });
        po.status = 'cancelled';
        return { status: 200, json: { purchase_order_id: po.id, status: 'cancelled', detached: [] } };
      }
      if (action === 'submit') {
        if (submitRefusal) {
          return { status: 409, json: { error: 'Soumission refusée', code: 'PURCHASE_ORDER_SUBMIT_REFUSED', verdicts: [{ supplier_unit_ref: 'UNIT-A', reason: 'preflight distant requis' }] } };
        }
        po.status = 'notified';
        return { status: 200, json: { purchase_order: po, lines: poLines(po.id), place_order_invoked: false } };
      }
      if (action === 'confirm') {
        const remnants = [];
        body.lines.forEach((entry) => {
          const line = state.lines.find((l) => l.line_id === entry.purchase_line_id);
          const remaining = line.quantity - entry.confirmed_quantity;
          line.confirmed_quantity = entry.confirmed_quantity;
          line.effective_quantity = entry.confirmed_quantity;
          if (remaining > 0) {
            const remnant = makeLine(state.nextRemnant++, { market_id: line.market_id, market_code: line.market_code, market_name: line.market_name }, remaining, { parent_line_id: line.line_id });
            state.lines.push(remnant);
            remnants.push(remnant);
          }
        });
        po.status = 'confirmed';
        return { status: 200, json: { purchase_order: po, lines: poLines(po.id), remnants, ...summarize(poLines(po.id)) } };
      }
    }
    return { status: 404, json: { error: `Route simulée absente : ${key}`, code: 'NOT_FOUND' } };
  }
  return { state, handle };
}

async function mountWorkspace(page, api, { search = '' } = {}) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === PAGE_PATH) {
      const links = CSS.map((n) => `<link rel="stylesheet" href="/dashboards/canonical/css/${n}.css">`).join('');
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${links}</head>
          <body class="kmc-shell-v4"><main id="canonical-admin-root"></main>
          <script src="/dashboards/canonical/js/primitives.js"></script>
          <script src="/dashboards/canonical/js/purchasing-workspace.js"></script></body></html>`,
      });
    }
    if (url.pathname.startsWith('/api/purchasing/')) {
      const raw = request.postData();
      const result = await api.handle(request.method(), url.pathname, url.search, raw ? JSON.parse(raw) : null);
      return route.fulfill({ status: result.status, contentType: 'application/json', body: JSON.stringify(result.json) });
    }
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${ORIGIN}${PAGE_PATH}${search}`);
  await page.evaluate(() => {
    window.__mounted = window.KomerceCanonicalPurchasingWorkspace.mount({
      root: document.getElementById('canonical-admin-root'),
      user: { role: 'admin' },
      document,
      fetch: window.fetch.bind(window),
      ui: window.KomerceCanonicalUI,
      confirm: () => true,
      prompt: () => 'Raison de test',
    });
    return window.__mounted;
  });
  await expect(page.locator('[data-purchasing-group]')).toBeVisible();
}

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const mutatingCalls = (api, suffix) => api.state.calls.filter((c) => c.key === `POST /api/purchasing${suffix}`);

test.describe('Achats fournisseurs — espace canonique', () => {
  test('liste groupée par fournisseur + Hub, marché visible par ligne et en badge multi-marchés', async ({ page }) => {
    const api = createFakeApi();
    await mountWorkspace(page, api);

    const group = page.locator('[data-purchasing-group]');
    await expect(group).toContainText('Allegro Pologne');
    await expect(group).toContainText('Hub HUB-001');
    await expect(group).toContainText('Commande multi-marchés');
    await expect(group.locator('tr[data-purchasing-line]')).toHaveCount(3);
    await expect(group.locator('tr[data-purchasing-line]').nth(1)).toContainText('CM');
    await expect(page.locator('[data-workspace-action="prepare-po"]')).toBeDisabled();
  });

  test('sélection puis préparation : un double clic ne crée qu\'une seule commande', async ({ page }) => {
    const api = createFakeApi();
    await mountWorkspace(page, api);

    await page.locator('tr[data-purchasing-line] input[type=checkbox]').nth(0).check();
    await page.locator('tr[data-purchasing-line] input[type=checkbox]').nth(1).check();
    const prepare = page.locator('[data-workspace-action="prepare-po"]');
    await expect(prepare).toHaveText('Préparer la commande (2)');

    await prepare.dblclick();
    await expect(page.locator('[data-purchasing-po-status="draft"]')).toBeVisible();

    expect(mutatingCalls(api, '/po/prepare')).toHaveLength(1);
    expect(mutatingCalls(api, '/po/prepare')[0].body.line_ids).toHaveLength(2);
    expect(api.state.pos.size).toBe(1);
    expect(page.url()).toContain('po=cccccccc-cccc-4ccc-8ccc-000000000001');
    await expect(page.locator('tr[data-purchasing-line]')).toHaveCount(1);
  });

  test('brouillon : détacher une ligne la rend à nouveau ouverte', async ({ page }) => {
    const api = createFakeApi();
    await mountWorkspace(page, api);
    await page.locator('tr[data-purchasing-line] input[type=checkbox]').nth(0).check();
    await page.locator('tr[data-purchasing-line] input[type=checkbox]').nth(1).check();
    await page.locator('[data-workspace-action="prepare-po"]').click();
    await expect(page.locator('[data-purchasing-po-status="draft"]')).toBeVisible();

    await page.locator('tr[data-purchasing-po-line] input[type=checkbox]').first().check();
    await page.locator('[data-workspace-action="detach-lines"]').click();

    await expect(page.locator('tr[data-purchasing-po-line]')).toHaveCount(1);
    await expect(page.locator('tr[data-purchasing-line]')).toHaveCount(2);
    expect(mutatingCalls(api, '/po/cccccccc-cccc-4ccc-8ccc-000000000001/detach')).toHaveLength(1);
  });

  test('soumission puis confirmation partielle : le reliquat réapparaît dans les lignes à acheter', async ({ page }) => {
    const api = createFakeApi();
    await mountWorkspace(page, api);
    await page.locator('tr[data-purchasing-line] input[type=checkbox]').nth(0).check();
    await page.locator('[data-workspace-action="prepare-po"]').click();
    await page.locator('[data-workspace-action="submit-po"]').click();
    await expect(page.locator('[data-purchasing-po-status="notified"]')).toBeVisible();
    await expect(page.locator('[data-purchasing-confirm]')).toBeVisible();

    await page.locator('[data-confirmed-quantity]').fill('2');
    await page.locator('[data-supplier-order-id]').fill('ALG-42');
    await page.locator('[data-workspace-action="confirm-po"]').click();

    await expect(page.locator('[data-purchasing-po-status="confirmed"]')).toBeVisible();
    const confirm = mutatingCalls(api, '/po/cccccccc-cccc-4ccc-8ccc-000000000001/confirm');
    expect(confirm).toHaveLength(1);
    expect(confirm[0].body.supplier_order_id).toBe('ALG-42');
    expect(confirm[0].body.lines).toEqual([{ purchase_line_id: '00000000-0000-4000-8000-000000000001', confirmed_quantity: 2 }]);
    await expect(page.locator('[data-workspace-feedback]')).toContainText('1 reliquat');
    // reliquat 5 - 2 = 3 : nouvelle ligne ouverte (KOM-1009) qui garde le marché de la ligne d'origine
    const remnant = page.locator('tr[data-purchasing-line]').filter({ hasText: 'KOM-1009' });
    await expect(remnant).toHaveCount(1);
    await expect(remnant.locator('td').nth(2)).toHaveText('KM');
    await expect(remnant.locator('td').nth(5)).toHaveText('3');
  });

  test('détail PO : affiche ordres, paiements, preuves et états ambigus sans les convertir en succès', async ({ page }) => {
    const api = createFakeApi();
    await mountWorkspace(page, api);
    // L'exécution fournisseur est posée avant l'ouverture du PO : la lecture qui suit « prepare-po » la relit.
    const poId = 'cccccccc-cccc-4ccc-8ccc-000000000001';
    api.state.executions.set(poId, {
      orders: [{
        id: 'exec-order-1', provider: 'CJ', supplier_order_id: 'CJ-42', supplier_order_code: 'CJ-CODE-42',
        provider_status: 'awaiting_supplier', created_at: '2026-10-05T10:00:00Z', updated_at: '2026-10-05T10:01:00Z',
      }],
      order_lines: [{ supplier_execution_order_id: 'exec-order-1', purchase_line_id: '00000000-0000-4000-8000-000000000001', quantity: 5 }],
      groups: [{
        id: 'exec-group-1', provider: 'CJ', supplier_parent_order_id: 'CJ-PARENT-7', payment_ref: 'PAY-7',
        provider_status: 'partial', payment_status: 'pending', created_at: '2026-10-05T10:02:00Z', updated_at: '2026-10-05T10:03:00Z',
      }],
      group_members: [{ supplier_execution_group_id: 'exec-group-1', supplier_execution_order_id: 'exec-order-1' }],
      payments: [{
        id: 'payment-1', provider: 'CJ', payment_execution_key: 'pay-key-1', supplier_execution_order_id: null,
        supplier_execution_group_id: 'exec-group-1', payment_ref: 'PAY-7', expected_amount: '19.9900',
        observed_amount: null, currency: 'USD', status: 'ambiguous', reconciliation_status: 'unverified',
        real_debit_verified: false, created_at: '2026-10-05T10:04:00Z', updated_at: '2026-10-05T10:05:00Z',
      }],
      proofs: [{
        id: 'proof-1', supplier_payment_id: 'payment-1', provider: 'CJ', proof_source: 'billingHistory',
        proof_ref: 'BH-1', provider_order_id: 'CJ-PARENT-7', payment_ref: 'PAY-7', observed_amount: '19.9900',
        currency: 'USD', debit_confirmed: false, sandbox: false, simulated: false,
        occurred_at: '2026-10-05T10:06:00Z', created_at: '2026-10-05T10:07:00Z',
      }],
      events: [{
        id: 'event-1', provider: 'CJ', supplier_execution_order_id: 'exec-order-1', supplier_execution_group_id: null,
        operation: 'pay', outcome: 'unknown', provider_request_id: 'REQ-42', provider_code: 'TIMEOUT',
        created_at: '2026-10-05T10:08:00Z',
      }],
    });

    await page.locator('tr[data-purchasing-line] input[type=checkbox]').nth(0).check();
    await page.locator('[data-workspace-action="prepare-po"]').click();

    const execution = page.locator('[data-purchasing-execution]');
    await expect(execution).toBeVisible();
    await expect(execution.locator('[data-purchasing-execution-block="orders"]')).toContainText('awaiting_supplier');
    await expect(execution.locator('[data-purchasing-execution-block="payments"]')).toContainText('19.9900 USD');
    await expect(execution.locator('[data-purchasing-execution-block="payments"]')).toContainText('ambiguous');
    await expect(execution.locator('[data-purchasing-execution-block="payments"]')).toContainText('unverified');
    await expect(execution.locator('[data-purchasing-execution-block="proofs"]')).toContainText('billingHistory');
    await expect(execution.locator('[data-purchasing-execution-block="events"]')).toContainText('unknown');
    await expect(execution).not.toContainText('OK');
  });

  test('quantité confirmée au-delà de la demande : refus côté écran, aucun appel serveur', async ({ page }) => {
    const api = createFakeApi();
    await mountWorkspace(page, api);
    await page.locator('tr[data-purchasing-line] input[type=checkbox]').nth(0).check();
    await page.locator('[data-workspace-action="prepare-po"]').click();
    await page.locator('[data-workspace-action="submit-po"]').click();
    await expect(page.locator('[data-purchasing-confirm]')).toBeVisible();

    await page.locator('[data-confirmed-quantity]').fill('99');
    await page.locator('[data-workspace-action="confirm-po"]').click();

    await expect(page.locator('[data-workspace-feedback]')).toContainText('invalide');
    expect(mutatingCalls(api, '/po/cccccccc-cccc-4ccc-8ccc-000000000001/confirm')).toHaveLength(0);
  });

  test('soumission refusée par le serveur : verdicts affichés, brouillon conservé', async ({ page }) => {
    const api = createFakeApi({ submitRefusal: true });
    await mountWorkspace(page, api);
    await page.locator('tr[data-purchasing-line] input[type=checkbox]').nth(0).check();
    await page.locator('[data-workspace-action="prepare-po"]').click();
    await page.locator('[data-workspace-action="submit-po"]').click();

    await expect(page.locator('[data-workspace-feedback]')).toContainText('preflight distant requis');
    await expect(page.locator('[data-purchasing-po-status="draft"]')).toBeVisible();
    await expect(page.locator('[data-workspace-action="submit-po"]')).toBeEnabled();
  });

  test('un brouillon reste ouvrable après rechargement via ?po=', async ({ page }) => {
    const api = createFakeApi();
    await mountWorkspace(page, api);
    await page.locator('tr[data-purchasing-line] input[type=checkbox]').nth(0).check();
    await page.locator('[data-workspace-action="prepare-po"]').click();
    await expect(page.locator('[data-purchasing-po-status="draft"]')).toBeVisible();
    const search = new URL(page.url()).search;
    await page.unroute(`${ORIGIN}/**`);

    await mountWorkspace(page, api, { search });
    await expect(page.locator('[data-purchasing-po-status="draft"]')).toBeVisible();
  });

  for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
    test(`aucun débordement horizontal (${viewport.name}) sur la liste, le brouillon et la confirmation`, async ({ page }) => {
      const api = createFakeApi();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mountWorkspace(page, api);
      await expectNoHorizontalOverflow(page);

      await page.locator('tr[data-purchasing-line] input[type=checkbox]').nth(0).check();
      await page.locator('[data-workspace-action="prepare-po"]').click();
      await expect(page.locator('[data-purchasing-po-status="draft"]')).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.locator('[data-workspace-action="submit-po"]').click();
      await expect(page.locator('[data-purchasing-confirm]')).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }
});
