/**
 * @e2e   control-tower-visual.spec.js
 * @feature dashboard (Tour de contrôle)
 * @brief Revue visuelle déterministe de la Tour 1672×941 : typographie, shell,
 *        hiérarchie Situation → Causes → Chaîne → Actions et états de santé.
 *        API simulée : aucun serveur ni base requis.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';
const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
const CSS = [...index.matchAll(/href="\/dashboards\/canonical\/css\/([^"?]+)\.css/g)].map((m) => m[1]);

const payload = {
  kpis_global: [
    { key: 'cmds_actives', label: 'Commandes actives', value: 11, unit: 'count', data_quality: {} },
    { key: 'alertes_critiques', label: 'Alertes critiques', value: 7, unit: 'count', data_quality: {}, drill_to: '/admin/action-center?severity=critical,urgent' },
    { key: 'points_attention', label: 'Points attention', value: 1, unit: 'count', data_quality: {}, drill_to: '/admin/action-center?severity=warning' },
  ],
  view_blocks: [
    {
      view: 'costing',
      title: 'Coût rendu relais',
      subtitle: 'Dire la vérité économique',
      url: '/admin/finance',
      kpis_summary: [
        { key: 'cmds_cout_incomplet', label: 'Commandes coût incomplet', value: 11, unit: 'count' },
      ],
    },
  ],
  economic_flow: { stages: [] },
  principles: [],
  control_chain: {
    stages: [
      { key: 'ORDER', label: 'Commande', health: 'ORANGE', order_count: 2, health_counts: { GREEN: 0, ORANGE: 2, RED: 0, UNKNOWN: 0 } },
      { key: 'PURCHASING', label: 'Achats', health: 'RED', order_count: 3, health_counts: { GREEN: 0, ORANGE: 0, RED: 3, UNKNOWN: 0 } },
      { key: 'SUPPLIER', label: 'Fournisseur', health: 'ORANGE', order_count: 1, health_counts: { GREEN: 0, ORANGE: 1, RED: 0, UNKNOWN: 0 } },
      { key: 'HUB_RECEIVING', label: 'Réception HUB', health: 'ORANGE', order_count: 1, health_counts: { GREEN: 0, ORANGE: 1, RED: 0, UNKNOWN: 0 } },
      { key: 'HUB_CONTROL', label: 'Contrôle HUB', health: 'RED', order_count: 1, health_counts: { GREEN: 0, ORANGE: 0, RED: 1, UNKNOWN: 0 } },
      { key: 'FORWARDER', label: 'Transitaire', health: 'GREEN', order_count: 0, health_counts: { GREEN: 0, ORANGE: 0, RED: 0, UNKNOWN: 0 } },
      { key: 'TRANSPORT', label: 'Transport', health: 'ORANGE', order_count: 1, health_counts: { GREEN: 0, ORANGE: 1, RED: 0, UNKNOWN: 0 } },
      { key: 'CUSTOMS', label: 'Douane', health: 'UNKNOWN', order_count: 1, health_counts: { GREEN: 0, ORANGE: 0, RED: 0, UNKNOWN: 1 } },
      { key: 'RELAY', label: 'Relais', health: 'GREEN', order_count: 0, health_counts: { GREEN: 0, ORANGE: 0, RED: 0, UNKNOWN: 0 } },
    ],
    structural_alerts: [
      {
        stage: 'PURCHASING', health: 'RED', reason_code: 'purchase_line_missing',
        summary: '1 item(s) non couvert(s) par une ligne d’achat depuis 2091 min',
        owner_role: 'sourcing', order_count: 3, order_references: ['K-1', 'K-2', 'K-3'],
        href: '/admin/operations#operations-control-chain',
      },
      {
        stage: 'PURCHASING', health: 'RED', reason_code: 'supplier_payment_blocked',
        summary: 'Paiement fournisseur bloqué',
        owner_role: 'finance', order_count: 3, order_references: ['K-4', 'K-5', 'K-6'],
        href: '/admin/operations#operations-control-chain',
      },
    ],
  },
  system_alerts: [
    {
      id: 'S-1', level: 'critical', source: 'signal-service',
      title: 'Article non conforme au contrôle HUB',
      message: 'Article non conforme au contrôle HUB',
      action_url: '/admin/action-center', action_label: 'Action Center',
    },
    {
      id: 'S-2', level: 'warning', source: 'finance',
      title: 'Paiement fournisseur à revoir',
      message: 'Paiement fournisseur à revoir',
      action_url: '/admin/action-center', action_label: 'Action Center',
    },
  ],
  data_quality: { generated_at: '2026-10-08T18:00:00.000Z', warnings: [], scope_enforced: true },
};

async function mountControlTower(page) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === '/admin/pilotage') {
      const links = CSS.map((n) => `<link rel="stylesheet" href="/dashboards/canonical/css/${n}.css">`).join('');
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="fr"><head><meta charset="utf-8">${links}</head>
          <body data-admin-generation="canonical">
          <main id="canonical-admin-root"></main>
          <script>window.KOMERCE_CANONICAL_AUTH_USER={"role":"admin"};</script>
          <script src="/dashboards/canonical/js/primitives.js"></script>
          <script src="/dashboards/canonical/js/decision-primitives.js"></script>
          <script src="/dashboards/canonical/js/cockpit-pattern.js"></script>
          <script src="/dashboards/canonical/js/dashboard-schema.js"></script>
          <script src="/dashboards/canonical/js/dashboard-renderer.js"></script>
          <script src="/dashboards/canonical/js/pilotage.js"></script>
          <script src="/dashboards/canonical/js/pilotage-decision.js"></script>
          <script src="/dashboards/canonical/js/navigation-policy-v4.js"></script>
          </body></html>`,
      });
    }

    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }

    if (url.pathname === '/api/admin/dashboard/unified') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) });
    }

    return route.fulfill({ status: 404, body: '' });
  });

  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto(`${ORIGIN}/admin/pilotage`);

  await page.evaluate(async () => {
    window.KomerceCanonicalNavigation.mount({
      user: { role: 'admin' },
      surface: 'pilotage',
      document,
    });

    await window.KomerceCanonicalPilotage.mount({
      root: document.getElementById('canonical-admin-root'),
      document,
      ui: window.KomerceCanonicalUI,
      renderer: window.KomerceDashboardRenderer,
      fetch: window.fetch.bind(window),
      adminContext: { actor: { role: 'admin' }, access: { mode: 'global' } },
      contextContract: { resolveMarketView: () => ({ mode: 'global' }) },
    });
  });

  await expect(page.locator('[data-dashboard-id="pilotage"]')).toBeVisible();
}

test.describe('Tour de contrôle — revue visuelle déterministe', () => {
  test.beforeEach(async ({ page }) => {
    await mountControlTower(page);
  });

  test('typographie de référence : sans serif, titre fort et lisible', async ({ page }) => {
    const typo = await page.evaluate(() => {
      const read = (sel) => {
        const el = document.querySelector(sel);
        const cs = getComputedStyle(el);
        return {
          family: cs.fontFamily,
          size: parseFloat(cs.fontSize),
          weight: Number(cs.fontWeight),
          lineHeight: parseFloat(cs.lineHeight),
          letterSpacing: cs.letterSpacing,
        };
      };
      return {
        body: read('body'),
        title: read('.kmc-dashboard-title'),
        section: read('.kmc-decision-dashboard-section-title'),
        card: read('.kmc-decision-card-label'),
      };
    });

    expect(typo.body.family).toMatch(/Segoe UI|Inter|-apple-system|BlinkMacSystemFont/i);
    expect(typo.title.family).not.toMatch(/Times New Roman|Georgia/i);
    expect(typo.title.family).toMatch(/Segoe UI|Inter|-apple-system|BlinkMacSystemFont|Helvetica Neue|Arial|sans-serif/i);
    expect(typo.title.size).toBeGreaterThanOrEqual(34); // Hero canon: titre fort, comme les mocks approuvés
    expect(typo.title.weight).toBe(800);
    expect(typo.section.size).toBeCloseTo(14.08, 1);
    expect(typo.card.size).toBeGreaterThanOrEqual(13);
  });

  test('le début du menu est visible au chargement sans scroll restauré', async ({ page }) => {
    const nav = page.locator('.kmc-admin-primary-nav');
    const firstGroup = page.locator('.kmc-admin-sidebar-group').first();
    const firstLabel = firstGroup.locator('.kmc-admin-sidebar-group-label');
    const firstLink = firstGroup.locator('.kmc-admin-primary-link').first();

    await expect(firstLabel).toHaveText('Piloter');
    await expect(firstLink).toContainText('Tour de contrôle');
    await expect(firstGroup).toBeVisible();

    const metrics = await nav.evaluate(el => ({
      scrollTop: el.scrollTop,
      top: el.getBoundingClientRect().top,
      firstTop: el.querySelector('.kmc-admin-sidebar-group').getBoundingClientRect().top,
    }));
    expect(metrics.scrollTop).toBe(0);
    expect(metrics.firstTop).toBeGreaterThanOrEqual(metrics.top);
  });

  test('structure visuelle : Hero + décisions + santé de la chaîne uniquement', async ({ page }) => {
    await expect(page.locator('.kmc-admin-navigation')).toBeVisible();
    await expect(page.locator('.kmc-decision-card')).toHaveCount(4);
    await expect(page.locator('#pilotage-flow-health.is-control-tower-flow')).toBeVisible();
    await expect(page.locator('.is-control-tower-flow .kmc-flow-stage')).toHaveCount(9);
    await expect(page.locator('#pilotage-causes')).toHaveCount(0);
    await expect(page.locator('#pilotage-alerts')).toHaveCount(0);
    await expect(page.getByText('Causes structurelles', { exact:true })).toHaveCount(0);
    await expect(page.locator('[data-dashboard-id="pilotage"]').getByText('À traiter', { exact:true })).toHaveCount(0);
  });

  test('hiérarchie Canonical : Hero → Attention → Objet principal, sans secondaire', async ({ page }) => {
    const dashboard = page.locator('[data-dashboard-id="pilotage"]');
    await expect(dashboard).toHaveAttribute('data-dashboard-hierarchy', 'hero-attention-primary-secondary');

    const order = await dashboard.locator(':scope > *').evaluateAll(nodes =>
      nodes.map(node => ({
        role: node.getAttribute('data-dashboard-role'),
        top: node.getBoundingClientRect().top,
        bottom: node.getBoundingClientRect().bottom,
      }))
    );

    const hero = order.findIndex(item => item.role === 'hero');
    const attention = order.findIndex(item => item.role === 'attention');
    const primary = order.findIndex(item => item.role === 'primary');
    const secondary = order.findIndex(item => item.role === 'secondary');

    expect(hero).toBeGreaterThanOrEqual(0);
    expect(attention).toBeGreaterThan(hero);
    expect(primary).toBeGreaterThan(attention);
    expect(secondary).toBe(-1);

    const attentionBox = order[attention];
    expect(attentionBox.top).toBeLessThan(520);
    expect(attentionBox.bottom).toBeLessThanOrEqual(941);
  });

  test('contraste du cockpit et états de chaîne restent distincts', async ({ page }) => {
    const colors = await page.evaluate(() => {
      const color = (sel, prop = 'backgroundColor') => getComputedStyle(document.querySelector(sel))[prop];
      return {
        sidebar: color('.kmc-admin-navigation'),
        sidebarWidth: document.querySelector('.kmc-admin-navigation').getBoundingClientRect().width,
        canvas: color('[data-dashboard-id="pilotage"]'),
        flow: color('.is-control-tower-flow'),
        decisionBg: color('.kmc-decision-card'),
        decisionGradient: color('.kmc-decision-card', 'backgroundImage'),
        decisionBorderLeft: color('.kmc-decision-card', 'borderLeftWidth'),
        activeNavGradient: color('.kmc-admin-primary-link.is-active', 'backgroundImage'),
        activeNavText: color('.kmc-admin-primary-link.is-active', 'color'),
        red: color('.kmc-flow-stage.is-critical', 'borderTopColor'),
        warning: color('.kmc-flow-stage.is-warning', 'borderTopColor'),
        green: color('.kmc-flow-stage.is-positive', 'borderTopColor'),
        unknown: color('.kmc-flow-stage.is-neutral', 'borderTopColor'),
      };
    });

    const lum = (value) => {
      const rgb = value.match(/\d+/g).slice(0, 3).map(Number);
      return rgb.reduce((a, b) => a + b, 0) / 3;
    };

    expect(colors.sidebar).toBe('rgb(7, 26, 61)');
    expect(colors.sidebarWidth).toBe(260);
    expect(colors.canvas).toBe('rgb(255, 255, 255)');
    expect(colors.flow).toBe('rgb(255, 255, 255)');
    expect(colors.decisionGradient).toContain('linear-gradient');
    expect(colors.decisionBorderLeft).toBe('5px');
    expect(colors.activeNavGradient).toContain('linear-gradient');
    expect(colors.activeNavText).toBe('rgb(255, 255, 255)');
    expect(new Set([colors.red, colors.warning, colors.green, colors.unknown]).size).toBe(4);
  });


  test('langage Canonical Komerce : canvas blanc + cartes blanches + états distincts', async ({ page }) => {
    const surfaces = await page.evaluate(() => {
      const bg = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
      const border = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
      const cs = (sel) => getComputedStyle(document.querySelector(sel));
      return {
        canvas: bg('[data-dashboard-id="pilotage"]'),
        flow: bg('.is-control-tower-flow'),
        criticalCard: bg('.kmc-decision-card.is-critical'),
        warningCard: bg('.kmc-decision-card.is-warning'),
        criticalGradient: cs('.kmc-decision-card.is-critical').backgroundImage,
        warningGradient: cs('.kmc-decision-card.is-warning').backgroundImage,
        criticalAccent: border('.kmc-decision-card.is-critical', 'borderLeftColor'),
        warningAccent: border('.kmc-decision-card.is-warning', 'borderLeftColor'),
        decisionRadius: cs('.kmc-decision-card').borderRadius,
        sectionRadius: cs('.kmc-decision-surface-card').borderRadius,
        sectionShadow: cs('.kmc-decision-surface-card').boxShadow,
      };
    });

    expect(surfaces.canvas).toBe('rgb(255, 255, 255)');
    expect(surfaces.flow).toBe('rgb(255, 255, 255)');
    expect(surfaces.criticalGradient).toContain('linear-gradient');
    expect(surfaces.warningGradient).toContain('linear-gradient');
    expect(surfaces.criticalGradient).not.toBe(surfaces.warningGradient);
    expect(surfaces.decisionRadius).toBe('12px');
    expect(surfaces.sectionRadius).toBe('12px');
    expect(surfaces.sectionShadow).toContain('0px 2px 8px');
    expect(surfaces.criticalAccent).not.toBe(surfaces.warningAccent);
  });

  test('aucun libellé technique interne dans la vue utilisateur', async ({ page }) => {
    const dashboard = page.locator('[data-dashboard-id="pilotage"]');
    await expect(dashboard).not.toContainText('signal-service');
    await expect(dashboard).not.toContainText('Causes structurelles');
    await expect(dashboard).not.toContainText('signaux restants');
  });

  test('capture de revue 1672×941', async ({ page }, testInfo) => {
    await page.screenshot({
      path: testInfo.outputPath('control-tower-1672x941.png'),
      fullPage: false,
    });
  });
});
