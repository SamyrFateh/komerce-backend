/**
 * @e2e dashboard-role-matrix.spec.js
 * @feature dashboard navigation V4 — matrice des rôles opérationnels
 * @brief Vérifie dans un vrai navigateur que chaque rôle ne voit que les destinations autorisées
 *        par le contrat SIDEBAR_GROUPS, sans élargissement silencieux côté client.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';
const PAGE_PATH = '/admin/pilotage';

const EXPECTED = Object.freeze({
  admin: [
    'control-tower', 'action-center',
    'flow-commerce', 'flow-orders', 'entity-clients', 'workspace-pricing', 'workspace-catalog',
    'flow-operations', 'workspace-shipping', 'workspace-purchasing',
    'flow-finance', 'workspace-accounting',
    'live-import-runtime', 'live-hub', 'live-relais',
    'markets-home', 'market-catalog', 'unsold',
    'admin-users', 'admin-providers', 'settings',
  ],
  market_operator: [
    'control-tower', 'action-center',
    'flow-commerce', 'flow-orders', 'entity-clients', 'workspace-pricing', 'workspace-catalog',
    'flow-operations', 'workspace-shipping', 'workspace-purchasing',
    'flow-finance', 'workspace-accounting',
    'live-import-runtime', 'live-hub', 'live-relais',
    'markets-home', 'market-autonomy', 'market-catalog', 'unsold',
    'admin-users', 'admin-providers', 'settings',
  ],
  agent_hub: ['action-center', 'workspace-shipping', 'live-hub'],
  agent_relais: ['action-center', 'live-hub', 'live-relais'],
  agent_transitaire: ['action-center', 'workspace-shipping'],
  finance: ['workspace-accounting', 'live-hub'],
  sourcing: ['live-import-runtime', 'live-hub'],
  support: ['live-hub'],
});

const ROLE_HOME = Object.freeze({
  admin: '/admin/pilotage',
  market_operator: '/admin/pilotage',
  finance: '/admin/workspaces/accounting',
  sourcing: '/admin/import-runtime',
  agent_hub: '/admin/hub',
  agent_relais: '/admin/relais-live',
  agent_transitaire: '/admin/workspaces/shipping-customs',
  support: '/portail',
});

async function mount(page, role) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === PAGE_PATH) {
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head>
          <body data-admin-generation="canonical">
            <main id="canonical-admin-root"></main>
            <script>window.KOMERCE_CANONICAL_AUTH_USER=${JSON.stringify({ role })};</script>
            <script src="/dashboards/canonical/js/navigation-policy-v4.js"></script>
          </body></html>`,
      });
    }
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({ status: 404, body: '' });
  });

  await page.goto(`${ORIGIN}${PAGE_PATH}`);
  await expect(page.locator('#canonical-admin-navigation')).toHaveCount(1);
}

test.describe('Navigation V4 — matrice des 8 rôles', () => {
  for (const [role, expected] of Object.entries(EXPECTED)) {
    test(`${role} ne voit que ses destinations autorisées`, async ({ page }) => {
      await mount(page, role);
      const ids = await page.$$eval('.kmc-admin-primary-link', (links) =>
        links.map((link) => link.getAttribute('data-dashboard'))
      );
      // Documentation est un utilitaire Aide autorisé pour les huit rôles
      // professionnels. Les autres domaines restent ceux de la matrice métier.
      expect(ids).toEqual([...expected, 'help-docs']);
      await expect(page.locator('.kmc-admin-primary-link[data-dashboard="help-docs"]'))
        .toHaveAttribute('href', '/admin/documentation');

      const home = await page.evaluate(() =>
        window.KomerceCanonicalNavigation.defaultLandingFor(window.KOMERCE_CANONICAL_AUTH_USER)
      );
      expect(home).toBe(ROLE_HOME[role]);
    });
  }

  test('Hub Live du menu agent mène au cockpit global tous marchés', async ({ page }) => {
    await mount(page, 'agent_hub');
    const hub = page.locator('.kmc-admin-primary-link[data-dashboard="live-hub"]');
    await expect(hub).toHaveAttribute('href', '/admin/hub');
    const landing = await page.evaluate(() =>
      window.KomerceCanonicalNavigation.defaultLandingFor(window.KOMERCE_CANONICAL_AUTH_USER)
    );
    expect(landing).toBe('/admin/hub');
  });

  test('un agent ne reçoit jamais les surfaces admin ou finance globale', async ({ page }) => {
    await mount(page, 'agent_hub');
    const ids = await page.$$eval('.kmc-admin-primary-link', (links) =>
      links.map((link) => link.getAttribute('data-dashboard'))
    );
    expect(ids).not.toEqual(expect.arrayContaining(['admin-users', 'admin-providers', 'settings', 'flow-finance']));
    expect(ids).toContain('action-center');
    expect(ids).toContain('live-hub');
  });
});

test('navigation Chromium Responsable marché : mêmes menus, routes alternatives sûres',async({page})=>{
  await mount(page,'market_operator');
  const links=Object.fromEntries(await page.$$eval('.kmc-admin-primary-link',
    els=>els.map(e=>[e.dataset.dashboard,e.getAttribute('href')])));
  expect(links['workspace-catalog']).toBe('/dashboards/canonical/market-catalog.html');
  expect(links['workspace-purchasing']).toBe('/admin/hub');
  expect(links['live-import-runtime']).toBe('/admin/hub');
  expect(links['live-relais']).toBe('/admin/operations');
  expect(links.unsold).toBe('/dashboards/canonical/unsold.html');
  expect(links['admin-users']).toContain('#market-team');
  expect(links['admin-providers']).toContain('#market-network');
  expect(links.settings).toContain('#market-cash-control');
  expect(Object.values(links)).not.toContain('/admin/workspaces/purchasing');
  expect(Object.values(links)).not.toContain('/admin/import-runtime');
  expect(Object.values(links)).not.toContain('/admin/settings');
});
