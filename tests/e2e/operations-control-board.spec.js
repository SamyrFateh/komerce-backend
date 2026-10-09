/**
 * @e2e operations-control-board.spec.js
 * @feature dashboard (Operations)
 * @brief Revue déterministe du tableau logistique client → relais.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';
const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
const CSS = [...index.matchAll(/href="\/dashboards\/canonical\/css\/([^"?]+)\.css/g)].map(m => m[1]);

const stages = [
  ['ORDER','Commande'],['PURCHASING','Achats fournisseurs'],['SUPPLIER','Fournisseur'],
  ['HUB_RECEIVING','Réception HUB'],['HUB_CONTROL','Contrôle HUB'],['FORWARDER','Transitaire'],
  ['TRANSPORT','Transport'],['CUSTOMS','Douane'],['RELAY','Relais'],
];

const order = (reference, health, summary, envelope, lineage) => ({
  order_reference: reference,
  health,
  split: false,
  exceptions: summary ? [{ code: 'cause', summary, owner_role: 'operations' }] : [],
  envelope: envelope || { type: 'ORDER', refs: [reference] },
  lineage: lineage || { purchase_orders: [], hub_units: [], parcels: [] },
});

const payload = {
  kpis: [
    { key:'cmds_aujourdhui', value:4, unit:'count', data_quality:{} },
    { key:'retards_critiques', value:1, unit:'count', data_quality:{} },
  ],
  active_orders: [],
  critical_delays: [],
  signals: [],
  control_chain: {
    stages: stages.map(([key,label]) => ({ key, label })),
    structural_alerts: [{
      stage:'PURCHASING', health:'RED', reason_code:'supplier_payment_blocked',
      summary:'Paiement fournisseur bloqué', owner_role:'finance',
      order_count:3, order_references:['K-104829','K-104833','K-104840'],
    }],
    by_stage: {
      ORDER:[order('K-104901','GREEN'),order('K-104907','GREEN')],
      PURCHASING:[order('K-104829','RED'),order('K-104833','RED'),order('K-104840','RED'),order('K-104852','GREEN')],
      SUPPLIER:[
        order('K-104812','GREEN'),
        order(
          'K-104816',
          'ORANGE',
          'Confirmation fournisseur à surveiller',
          { type:'PURCHASE_ORDER', refs:['PO-104816'] },
          { purchase_orders:['PO-104816'], hub_units:[], parcels:[] }
        )
      ],
      HUB_RECEIVING:[order('K-104791','GREEN'),order('K-104797','ORANGE')],
      HUB_CONTROL:[
        order(
          'K-104766',
          'RED',
          'Article non conforme au contrôle HUB',
          { type:'HUB_UNIT', refs:['HU-104766'] },
          { purchase_orders:['PO-104766'], hub_units:['HU-104766'], parcels:[] }
        ),
        order('K-104772','GREEN'),
        order('K-104781','GREEN')
      ],
      FORWARDER:[order('K-104744','GREEN'),order('K-104751','GREEN')],
      TRANSPORT:[
        order('K-104701','GREEN'),
        order('K-104709','GREEN'),
        order(
          'K-104715',
          'ORANGE',
          'Transit à surveiller',
          { type:'PARCEL', refs:['P-104715'] },
          { purchase_orders:['PO-104715'], hub_units:['HU-104715'], parcels:['P-104715'] }
        )
      ],
      CUSTOMS:[order('K-104688','UNKNOWN')],
      RELAY:[order('K-104661','GREEN'),order('K-104672','GREEN')],
    },
  },
  data_quality:{ generated_at:'2026-10-08T20:00:00.000Z', warnings:[], scope_enforced:true },
};

async function mount(page) {
  await page.route(`${ORIGIN}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/admin/operations') {
      const links = CSS.map(n => `<link rel="stylesheet" href="/dashboards/canonical/css/${n}.css">`).join('');
      return route.fulfill({
        contentType:'text/html',
        body:`<!doctype html><html lang="fr"><head><meta charset="utf-8">${links}</head>
          <body data-admin-generation="canonical"><main id="canonical-admin-root"></main>
          <script>window.KOMERCE_CANONICAL_AUTH_USER={"role":"admin"};</script>
          <script src="/dashboards/canonical/js/primitives.js"></script>
          <script src="/dashboards/canonical/js/decision-primitives.js"></script>
          <script src="/dashboards/canonical/js/cockpit-pattern.js"></script>
          <script src="/dashboards/canonical/js/dashboard-schema.js"></script>
          <script src="/dashboards/canonical/js/dashboard-renderer.js"></script>
          <script src="/dashboards/canonical/js/operations.js"></script>
          <script src="/dashboards/canonical/js/operations-decision.js"></script>
          <script src="/dashboards/canonical/js/navigation-policy-v4.js"></script>
          </body></html>`,
      });
    }
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/',''));
      return fs.existsSync(file) ? route.fulfill({ path:file }) : route.fulfill({ status:404, body:'' });
    }
    if (url.pathname === '/api/admin/dashboard/operations') {
      return route.fulfill({ contentType:'application/json', body:JSON.stringify(payload) });
    }
    return route.fulfill({ status:404, body:'' });
  });

  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto(`${ORIGIN}/admin/operations`);
  await page.evaluate(async () => {
    window.KomerceCanonicalNavigation.mount({ user:{role:'admin'}, surface:'operations', document });
    await window.KomerceCanonicalOperations.mount({
      root:document.getElementById('canonical-admin-root'),
      document,
      ui:window.KomerceCanonicalUI,
      renderer:window.KomerceDashboardRenderer,
      fetch:window.fetch.bind(window),
      adminContext:{ actor:{role:'admin'}, access:{mode:'global'} },
      contextContract:{ resolveMarketView:() => ({mode:'global'}) },
      user:{role:'admin'},
    });
  });
  await expect(page.locator('[data-dashboard-id="operations"]')).toBeVisible();
}

test.describe('Operations — logistics control board', () => {
  test.beforeEach(async ({ page }) => mount(page));

  test('le hero logistique précède le tableau et porte l’identité Operations', async ({ page }) => {
    const header = page.locator('[data-dashboard-id="operations"] > .kmc-dashboard-header');
    await expect(page.locator('.kmc-dashboard-title')).toHaveText('Opérations — Tour de contrôle');
    const visual = await header.evaluate(el => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { height:r.height, backgroundImage:cs.backgroundImage, radius:cs.borderRadius };
    });
    expect(visual.height).toBeGreaterThanOrEqual(150);
    expect(visual.backgroundImage).toContain('operations-logistics-hero.svg');
    expect(visual.radius).toBe('16px');
  });

  test('la hiérarchie suit Hero → Attention → Objet principal → Secondaire', async ({ page }) => {
    const order = await page.locator('[data-dashboard-id="operations"] > *').evaluateAll(nodes =>
      nodes.map(n => ({
        cls:n.className,
        id:n.id,
        role:n.getAttribute('data-dashboard-role')
      }))
    );
    const heroIndex = order.findIndex(x => x.role === 'hero');
    const attentionIndex = order.findIndex(x => x.role === 'attention');
    const primaryIndex = order.findIndex(x => x.role === 'primary');
    const secondaryIndex = order.findIndex(x => x.role === 'secondary');

    expect(heroIndex).toBeGreaterThanOrEqual(0);
    expect(attentionIndex).toBeGreaterThan(heroIndex);
    expect(primaryIndex).toBeGreaterThan(attentionIndex);
    expect(secondaryIndex).toBeGreaterThan(primaryIndex);
  });

  test('les rubriques d’attention sont visibles et dominantes dans le premier écran', async ({ page }) => {
    const attention = page.locator('[data-dashboard-role="attention"]');
    await expect(attention).toBeVisible();

    const geometry = await attention.evaluate(el => {
      const box = el.getBoundingClientRect();
      const cards = [...el.querySelectorAll('.kmc-decision-card')];
      return {
        top: box.top,
        bottom: box.bottom,
        cardCount: cards.length,
        minCardHeight: Math.min(...cards.map(card => card.getBoundingClientRect().height)),
        borderWidths: cards.map(card => getComputedStyle(card).borderLeftWidth),
      };
    });

    expect(geometry.top).toBeGreaterThan(0);
    expect(geometry.top).toBeLessThan(500);
    expect(geometry.bottom).toBeLessThanOrEqual(941);
    expect(geometry.cardCount).toBeGreaterThanOrEqual(1);
    expect(geometry.minCardHeight).toBeGreaterThanOrEqual(100);
    expect(geometry.borderWidths.every(value => value === '5px')).toBe(true);
  });

  test('affiche les 9 étapes et la légende santé', async ({ page }) => {
    await expect(page.locator('.kmc-control-stage')).toHaveCount(9);
    await expect(page.locator('.kmc-control-chain-legend-item')).toHaveCount(4);
    await expect(page.locator('.kmc-control-stage-icon')).toHaveCount(9);
  });

  test('les colonnes sont des vraies colonnes opérationnelles hautes', async ({ page }) => {
    const geometry = await page.locator('.kmc-control-stage').first().evaluate(el => {
      const cs=getComputedStyle(el), r=el.getBoundingClientRect();
      return { height:r.height, radius:cs.borderRadius, background:cs.backgroundColor };
    });
    expect(geometry.height).toBeGreaterThanOrEqual(440);
    expect(geometry.radius).toBe('12px');
    const icon = await page.locator('.kmc-control-stage-icon').first().evaluate(el => {
      const r = el.getBoundingClientRect();
      return { width:r.width, height:r.height };
    });
    expect(icon.width).toBeGreaterThanOrEqual(60);
    expect(icon.height).toBeGreaterThanOrEqual(60);
  });


  test('les 9 étapes tiennent ensemble sur le viewport desktop de référence', async ({ page }) => {
    const board = page.locator('.kmc-control-chain');
    const geometry = await board.evaluate(el => ({
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 2);

    const stages = page.locator('.kmc-control-stage');
    await expect(stages).toHaveCount(9);
    const first = await stages.first().boundingBox();
    const last = await stages.last().boundingBox();
    expect(first).not.toBeNull();
    expect(last).not.toBeNull();
    expect(last.x + last.width).toBeLessThanOrEqual(1672);
  });

  test('les cartes restent compactes puis révèlent l’objet précis au clic', async ({ page }) => {
    const warning = page.locator('.kmc-control-order.is-warning').filter({ hasText:'K-104816' });
    await expect(warning).toBeVisible();
    await expect(warning).not.toContainText('Confirmation fournisseur à surveiller');
    const hiddenDetails = page.locator('.kmc-control-order-detail');
    const visibleBeforeClick = await hiddenDetails.evaluateAll(nodes =>
      nodes.filter(node => !node.hidden && getComputedStyle(node).display !== 'none').length
    );
    expect(visibleBeforeClick).toBe(0);

    await warning.click();

    const detail = page.locator('.kmc-control-order-row.is-expanded .kmc-control-order-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('Objet en cause');
    await expect(detail).toContainText('PO fournisseur · PO-104816');
    await expect(detail).toContainText('Confirmation fournisseur à surveiller');
    await expect(detail).toContainText('Responsable : operations');
    await expect(detail.locator('.kmc-control-order-open')).toHaveAttribute('href','/admin/orders/K-104816');

    const unknown = page.locator('.kmc-control-order.is-unknown').filter({ hasText:'K-104688' });
    await expect(unknown).toBeVisible();
    await expect(page.locator('.kmc-control-structural-alert.is-critical')).toContainText('Paiement fournisseur bloqué');
  });

  test('l’encapsulation distingue PO, unité HUB et colis avec le lineage serveur', async ({ page }) => {
    await page.locator('.kmc-control-order.is-critical').filter({ hasText:'K-104766' }).click();
    let detail = page.locator('.kmc-control-order-row.is-expanded .kmc-control-order-detail');
    await expect(detail).toContainText('Unité HUB · HU-104766');
    await expect(detail).toContainText('PO-104766');

    await page.locator('.kmc-control-order.is-warning').filter({ hasText:'K-104715' }).click();
    detail = page.locator('.kmc-control-order-row.is-expanded .kmc-control-order-detail').last();
    await expect(detail).toContainText('Colis · P-104715');
    await expect(detail).toContainText('HU-104715');
    await expect(detail).toContainText('PO-104715');
  });

  test('capture de revue 1672×941', async ({ page }, testInfo) => {
    await page.screenshot({ path:testInfo.outputPath('operations-control-board-1672x941.png'), fullPage:false });
  });
});
