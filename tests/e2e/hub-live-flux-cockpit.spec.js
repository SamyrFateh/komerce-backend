/**
 * @e2e   hub-live-flux-cockpit.spec.js
 * @feature dashboard (Hub live · cockpit « flux du besoin »)
 * @brief Cockpit Hub en desktop 1440, maquette C : « À faire maintenant » en pastilles, trois colonnes (commandes / besoins et PO /
 *        exécution physique), fil de l'objet sélectionné avec actions par rôle, sélection bidirectionnelle, préparation de PO
 *        sans double envoi, réception partielle 2/3 FIFO (scénario KOM-101/102/103). Dossiers = instantanés du VRAI serveur
 *        (fixtures/hub-cockpit-snapshots), API simulée : aucun serveur ni base requis.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pricing-atelier-km.json'), 'utf8'));
const ORIGIN = 'http://komerce.test';
const API = '/api/admin/workspaces/operations/market/KM';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const WORKSPACE = {
  scope: { code: 'KM', name: 'Comores' },
  summary: { hub_to_order: 0, hub_unassigned: 0, hub_to_ship: 0, relay_cash_pending: 0, relay_to_receive: 0, relay_to_collect: 0, inventory_to_assign: 0 },
  queues: { hub: { to_order: [], to_ship: [] }, relay: { cash_pending: [], to_receive: [], to_collect: [] } },
  distribution: { unassigned: [] }, inventory: { items: [], open_parcels: [] },
};

const ROLES = {
  agent: { role: 'agent_hub', can_authorize_commitment: false, can_authorize_payment: false },
  directrice: { role: 'agent_hub', can_authorize_commitment: true, can_authorize_payment: true },
  admin: { role: 'admin', can_authorize_commitment: false, can_authorize_payment: false },
};

/** Instantané du dossier réel (GET /supply) à une étape du scénario KOM-101/102/103. */
function snapshot(name, viewer = ROLES.agent) {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hub-cockpit-snapshots', `${name}.json`), 'utf8'));
  d.market = { ...d.market, code: 'KM' };
  d.cockpit.viewer = { ...d.cockpit.viewer, ...viewer };
  return d;
}
const orderId = (d, ref) => d.orders.find((o) => o.reference === ref).id;

test.use({ viewport: { width: 1440, height: 900 } });

async function mount(page, { source, posts = [], delay = 0 } = {}) {
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
      return json({ ok: true }, 201);
    }
    if (url.pathname === '/api/auth/me') return json(FX.auth_me);
    if (url.pathname === '/api/admin/dashboard/context') return json(FX.context);
    if (url.pathname === API) return json(WORKSPACE);
    if (url.pathname === '/api/scans/hub/receivable') return json({ purchase_orders: [] });
    if (url.pathname === `${API}/supply`) return json(source);
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${ORIGIN}/admin/hub-live?view=execute`);
  await page.locator('select').first().selectOption({ label: 'KM · Comores' });
  await expect(page.locator('h1')).toHaveText('Hub live · Dossiers');
  await page.locator('[data-workspace-view="supply"]').click();
  await expect(page.locator('[data-hub-cockpit]')).toBeVisible();
}

const selectPo = (page) => page.locator('[data-hlc-po]').first().click();
const enabledPrimaries = (page) => page.locator('[data-hlc-actions] .is-primary:not([disabled])');

test.describe('Hub live · cockpit maquette C — desktop 1440', () => {
  test('hero conservé, pas de bloc KPI ni titre « Flux du besoin », trois colonnes sans débordement, légende visible', async ({ page }) => {
    await mount(page, { source: snapshot('partial') });
    await expect(page.locator('h1')).toHaveText('Hub live · Dossiers');
    await expect(page.locator('[data-metric-key]')).toHaveCount(0);
    await expect(page.getByText('Flux du besoin')).toHaveCount(0);
    const xs = await page.evaluate(() => ['orders', 'purchases', 'physical'].map((z) => document.querySelector(`[data-hlc-zone="${z}"]`).getBoundingClientRect().x));
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator('.hlc-legend')).toBeVisible();
    await expect(page.locator('.hlc-legend')).not.toContainText('Sourcing requis');
    await expect(page.locator('table.kmc-hub-board')).toHaveCount(0);
  });

  test('lisibilité : pavés et étapes avec title, aucun UUID ni HPO en clair', async ({ page }) => {
    await mount(page, { source: snapshot('partial') });
    const missing = await page.evaluate(() => ({
      pips: [...document.querySelectorAll('.hlc-pip')].filter((n) => !n.title && !n.closest('.hlc-legend') && !n.closest('[title]')).length,
      steps: [...document.querySelectorAll('[data-hlc-steps] [data-step]')].filter((n) => !n.title).length,
    }));
    expect(missing).toEqual({ pips: 0, steps: 0 });
    await selectPo(page);
    const text = await page.locator('[data-hub-cockpit]').innerText();
    expect(text).not.toMatch(UUID_RE);
    expect(text).not.toMatch(/HPO-/);
  });

  test('« À faire maintenant » : pastilles courtes, l’anomalie fournisseur est rouge et distincte', async ({ page }) => {
    await mount(page, { source: snapshot('needs') });
    const pills = page.locator('.hlc-todo-pill');
    expect(await pills.count()).toBeLessThanOrEqual(4);
    const anomaly = page.locator('.hlc-todo-pill.is-bad');
    await expect(anomaly).toHaveCount(1);
    await expect(anomaly).toContainText('Sourcing requis — aucun fournisseur admissible');
    const kom103 = page.locator(`[data-hlc-order="${orderId(snapshot('needs'), 'KOM-103')}"]`);
    await expect(kom103).toContainText('Anomalie fournisseur');
    await anomaly.click();
    await expect(page.locator('[data-hlc-blocker]')).toContainText('Sourcing requis — aucun fournisseur admissible');
    await expect(page.locator('[data-hlc-action="resolve-sourcing"]')).toBeEnabled();
    expect(await enabledPrimaries(page).count()).toBe(1);
  });

  test('Sourcing requis — aucun fournisseur admissible : rendu rouge sur l\'anomalie (pastille, besoin, fil), aucune PO possible', async ({ page }) => {
    await mount(page, { source: snapshot('needs') });
    const label = 'Sourcing requis — aucun fournisseur admissible';
    const pill = page.locator('.hlc-todo-pill.is-bad');
    await expect(pill).toHaveCount(1);
    await expect(pill).toContainText(label);
    const rgb = (s) => s.match(/\d+/g).map(Number);
    const [r, g, b] = rgb(await pill.evaluate((el) => getComputedStyle(el).borderTopColor));
    expect([r, g, b]).toEqual([192, 38, 45]); // #c0262d : rouge anomalie, jamais l'ambre des avertissements
    await expect(page.locator('.hlc-need.is-dashed .hlc-need-title').first()).toContainText(label);
    await pill.click();
    await expect(page.locator('[data-hlc-blocker]')).toContainText(label);
    await page.screenshot({ path: 'test-results/hub-live-sourcing-requis.png' });
  });

  test('réception partielle 2/3 : étape « Reçue 2/3 » distincte, FIFO KOM-101 d’abord, reliquat KOM-102, KOM-101 non prête', async ({ page }) => {
    const d = snapshot('partial');
    await mount(page, { source: d });
    const step = page.locator('[data-hlc-po] [data-step="received"]').first();
    await expect(step).toHaveAttribute('data-partial', 'true');
    await expect(step).toContainText('Reçue 2/3');
    await expect(step).toHaveClass(/is-partial/);
    await expect(step).not.toHaveClass(/is-complete/);
    const po = page.locator('[data-hlc-po]').first();
    await expect(po).toContainText('FIFO');
    const lines = po.locator('[data-hlc-po-line]');
    await expect(lines.filter({ hasText: 'KOM-101' })).toContainText('2/2');
    await expect(lines.filter({ hasText: 'KOM-102' })).toContainText('reliquat 1');
    const c101 = page.locator(`[data-hlc-order="${orderId(d, 'KOM-101')}"]`);
    await expect(c101).not.toContainText('Prête');
    await expect(page.locator('[data-hlc-phys="reliquats"]')).toContainText('KOM-102');
    await expect(page.locator('[data-hlc-phys="received"]')).toContainText('KOM-101');
  });

  test('sélection bidirectionnelle : commande → PO → commandes, fil lisible, sans mutation', async ({ page }) => {
    const posts = [];
    const d = snapshot('partial');
    await mount(page, { source: d, posts });
    await page.locator(`[data-hlc-order="${orderId(d, 'KOM-102')}"]`).click();
    await expect(page.locator('[data-hlc-po]').first()).toHaveClass(/is-related/);
    await expect(page.locator('[data-hlc-fil-title]')).toContainText('KOM-102');
    await expect(page.locator('[data-hlc-chain] [data-hlc-node]')).not.toHaveCount(0);
    await page.locator('[data-hlc-po]').first().click();
    await expect(page.locator(`[data-hlc-order="${orderId(d, 'KOM-101')}"]`)).toHaveClass(/is-related/);
    await expect(page.locator(`[data-hlc-order="${orderId(d, 'KOM-102')}"]`)).toHaveClass(/is-related/);
    await expect(page.locator(`[data-hlc-order="${orderId(d, 'KOM-103')}"]`)).not.toHaveClass(/is-related/);
    await expect(page.locator('[data-hlc-blocker]')).toContainText('KOM-102');
    expect(posts).toHaveLength(0);
  });

  test('rôles : agent et admin voient l’engagement désactivé avec une raison courte, un seul primaire actif', async ({ page }) => {
    for (const key of ['agent', 'admin']) {
      await mount(page, { source: snapshot('draft', ROLES[key]) });
      await selectPo(page);
      const button = page.locator('[data-hlc-action="authorize-commitment"]');
      await expect(button).toBeDisabled();
      const reason = (await button.locator('xpath=following-sibling::*[1]').innerText()).trim();
      expect(reason.split(/\s+/).length).toBeLessThanOrEqual(8);
      expect(await enabledPrimaries(page).count()).toBeLessThanOrEqual(1);
      await page.unroute(`${ORIGIN}/**`);
    }
  });

  test('responsable : valider l’engagement poste la pièce une seule fois malgré le double clic', async ({ page }) => {
    const posts = [];
    const d = snapshot('draft', ROLES.directrice);
    await mount(page, { source: d, posts, delay: 200 });
    await selectPo(page);
    await page.locator('[data-hlc-action="authorize-commitment"]').click();
    const form = page.locator('[data-hlc-form="commitment"]');
    await form.locator('input[name="proof_ref"]').fill('BC-2026-11');
    await form.locator('[data-hlc-action="submit-commitment"]').dblclick();
    await expect.poll(() => posts.length).toBeGreaterThan(0);
    await page.waitForTimeout(400);
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe(`/api/purchasing/po/${d.purchase_orders[0].id}/authorize-commitment`);
    expect(posts[0].body).toMatchObject({ proof_ref: 'BC-2026-11' });
  });

  test('préparer une PO depuis le besoin coché : un seul POST /po/prepare avec les lignes KOM-101 et KOM-102', async ({ page }) => {
    const posts = [];
    const d = snapshot('needs');
    await mount(page, { source: d, posts, delay: 200 });
    await page.locator('[data-hlc-need-check]').first().check();
    await page.locator('[data-hlc-need]').first().click();
    const prepare = page.locator('[data-hlc-action="prepare-po"]');
    await expect(prepare).toBeEnabled();
    await prepare.dblclick();
    await expect.poll(() => posts.length).toBeGreaterThan(0);
    await page.waitForTimeout(400);
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe('/api/purchasing/po/prepare');
    expect(posts[0].body.line_ids).toHaveLength(2);
  });

  test('étapes de la PO : brouillon → validation après engagement, envoyée ensuite', async ({ page }) => {
    for (const [name, label] of [['draft', 'Brouillon'], ['validation', 'En validation'], ['sent', 'Expédiée']]) {
      await mount(page, { source: snapshot(name, ROLES.directrice) });
      const done = page.locator('[data-hlc-po] [data-hlc-steps] li.is-done');
      expect(await done.count()).toBe(['draft', 'validation', 'sent'].indexOf(name) === 0 ? 1 : name === 'validation' ? 2 : 4);
      await expect(page.locator('[data-hlc-po]').first()).toContainText(label);
      await page.unroute(`${ORIGIN}/**`);
    }
  });
});
