/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires none
 * @komerce-arch-lite
 * @role hub-alerts-t3-t9-t10-offline-real-chromium
 * @domain dashboard
 * @layer e2e
 * @purpose Verify actual canonical Hub cockpit renders server-supplied shortage, age and capacity tasks;
 *          controlled ephemeral dossier only, NO HTTP, NO PostgreSQL, NO staging.
 * @impact-areas hub, dashboard, test-only
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const SCRIPT = fs.readFileSync(path.join(
  __dirname, '../../public/dashboards/canonical/js/hub-live-cockpit.js'), 'utf8');
const OUT = path.resolve('test-results/g2-hub-po-chromium-isolated');
const ORDER_A = '00000000-0000-4000-8000-000000000061';
const ORDER_B = '00000000-0000-4000-8000-000000000062';

test.use({ screenshot: 'off', trace: 'off', video: 'off' });

async function loadCockpit(page, todo) {
  const requests = [];
  await page.route('**/*', route => {
    requests.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  await page.goto('about:blank');
  await page.setContent('<!doctype html><html lang="fr"><body><main id="hub"></main></body></html>');
  await page.addScriptTag({ content: SCRIPT });
  await page.evaluate(tasks => {
    const dossier = {
      market: { code: 'KM' }, orders: [], purchase_orders: [],
      bags_open: [], bags_ready: [], boxes: [], open_shipments: [],
      cockpit: {
        viewer: { role: 'agent_hub', can_authorize_commitment: false,
          can_authorize_payment: false },
        todo: tasks, physical: [], unit_legend: [], need_batches: [],
        po_steps: ['draft', 'validation', 'engaged', 'sent', 'received'],
      },
    };
    const state = {};
    window.__hub_alert_proof = { unexpectedActions: 0, outbound: 0, dossier, state };
    window.fetch = () => {
      window.__hub_alert_proof.outbound++;
      throw Error('OFFLINE_NETWORK_FORBIDDEN');
    };
    window.XMLHttpRequest = class {
      open() {
        window.__hub_alert_proof.outbound++;
        throw Error('OFFLINE_NETWORK_FORBIDDEN');
      }
    };
    const context = {
      document, dossier, state, marketCode: 'KM', isReadOnly: true,
      endpoint: p => '/api/admin/workspaces/operations/market/KM/' + p,
      act: async () => {
        window.__hub_alert_proof.unexpectedActions++;
        throw Error('OFFLINE_WRITER_FORBIDDEN');
      },
      feedback() {}, async reload() {}, openPhysical() {},
      openSourcing() {}, renderReception() { return null; },
    };
    window.__hub_alert_proof.render = () =>
      window.KomerceHubLiveCockpit.render(document.getElementById('hub'), context);
    window.__hub_alert_proof.render();
  }, todo);
  return requests;
}

async function evidence(page, name, tasks, requests) {
  const observed = await page.evaluate(() => ({
    outbound: window.__hub_alert_proof.outbound,
    attemptedActions: window.__hub_alert_proof.unexpectedActions,
    selected: document.querySelector('[data-hub-cockpit]')?.getAttribute('data-hlc-selection'),
    taskKinds: Array.from(document.querySelectorAll('[data-hlc-todo-item]'))
      .map(el => el.getAttribute('data-hlc-todo-item')),
  }));
  expect(observed.outbound).toBe(0);
  expect(observed.attemptedActions).toBe(0);
  expect(requests).toEqual([]);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name + '.json'),
    JSON.stringify({
      schema: 'komerce-hub-alert-offline-chromium/1', name,
      source: 'public/dashboards/canonical/js/hub-live-cockpit.js',
      environment: 'DISPOSABLE_IN_MEMORY_ONLY', staging: 'NOT_CONTACTED',
      network: 'DENIED', database: 'NOT_CONNECTED', actual_elapsed_48h: 'NOT_PROVEN',
      result: 'REAL_CHROMIUM_UI_RENDER_ONLY', tasks, observed,
    }, null, 2) + '\n');
  await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
}

function task(kind, orderId, missing, age, overdue, why) {
  return {
    id: kind + ':' + orderId, kind, severity: 'anomaly',
    owner: kind === 'BLOCKED_BY_SHORTFALL' ? 'responsable_hub' : 'agent_hub', viewer_can_act: true,
    subject: { order_id: orderId }, missing, why,
    age_hours: age, overdue, since: '2026-11-10T00:00:00Z',
  };
}

test('T3: la rupture fournisseur est visible et mène au bon dossier', async ({ page }) => {
  const tasks = [
    task('BLOCKED_BY_SHORTFALL', ORDER_A, 'T3 : 1 u non couverte', 11, false,
      'Rupture fournisseur : remboursement ou remplacement à traiter'),
    task('PARCEL_CAPACITY_WAIT', ORDER_B, 'T10 : Relais KM (3 ouverts)', 4, false,
      'Aucune place disponible dans les colis ouverts'),
  ];
  const requests = await loadCockpit(page, tasks);
  const blocked = page.locator('[data-hlc-todo-item="BLOCKED_BY_SHORTFALL"]');
  await expect(blocked).toBeVisible();
  await expect(blocked).toContainText('1 u non couverte');
  await expect(blocked).toHaveAttribute('data-owner', 'responsable_hub');
  await blocked.click();
  await expect(page.locator('[data-hub-cockpit]'))
    .toHaveAttribute('data-hlc-selection', 'order:' + ORDER_A);
  await evidence(page, 'T3-shortage-ui-only', tasks, requests);
});

test('T10: la saturation (3 colis ouverts) apparaît et ouvre la bonne commande', async ({ page }) => {
  const tasks = [
    task('BLOCKED_BY_SHORTFALL', ORDER_A, 'T3 : ligne en attente', 4, false,
      'Fournisseur indisponible'),
    task('PARCEL_CAPACITY_WAIT', ORDER_B, 'T10 : Relais KM (3 ouverts)', 6, false,
      'Impossible de créer un quatrième colis local sans capacité'),
  ];
  const requests = await loadCockpit(page, tasks);
  const capacity = page.locator('[data-hlc-todo-item="PARCEL_CAPACITY_WAIT"]');
  await expect(capacity).toBeVisible();
  await expect(capacity).toContainText('(3 ouverts)');
  await expect(capacity).toHaveAttribute('data-owner', 'agent_hub');
  await capacity.click();
  await expect(page.locator('[data-hub-cockpit]'))
    .toHaveAttribute('data-hlc-selection', 'order:' + ORDER_B);
  await evidence(page, 'T10-capacity-ui-only', tasks, requests);
});

test('T9: seuil visuel 47h vs 48h (projection fournie par serveur, pas 48h vécues)', async ({ page }) => {
  const tasks = [
    task('RECONCILE_PARCEL', ORDER_A, 'Colis sans manifeste 47h', 47, false,
      'À rapprocher'),
    task('BLOCKED_BY_SHORTFALL', ORDER_B, 'Rupture 48h', 48, true,
      'À traiter en priorité'),
    task('PARCEL_CAPACITY_WAIT', '00000000-0000-4000-8000-000000000063',
      'Colis saturés 72h', 72, true, 'Alerte directrice'),
  ];
  const requests = await loadCockpit(page, tasks);
  const pill47 = page.locator('[data-hlc-todo-item="RECONCILE_PARCEL"]');
  const pill48 = page.locator('[data-hlc-todo-item="BLOCKED_BY_SHORTFALL"]');
  const pill72 = page.locator('[data-hlc-todo-item="PARCEL_CAPACITY_WAIT"]');
  await expect(pill47.locator('[data-hlc-age="47"]')).toBeVisible();
  await expect(pill47.locator('[data-hlc-age="47"]')).not.toHaveClass(/is-overdue/);
  await expect(pill48.locator('[data-hlc-age="48"]')).toHaveClass(/is-overdue/);
  await expect(pill48).toContainText('⚠');
  await expect(pill72.locator('[data-hlc-age="72"]')).toHaveClass(/is-overdue/);
  await evidence(page, 'T9-age-display-ui-only', tasks, requests);
});
