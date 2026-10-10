/**
 * @e2e admin-menu-navigation.spec.js
 * @feature dashboard
 * @brief Menu latéral : une seule entrée active par page, et Paramètres / Utilisateurs / Providers
 *        restent accessibles à l'admin (plus de renvoi vers le Pilotage).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';
const INDEX = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
const json = body => ({ contentType: 'application/json', body: JSON.stringify(body) });

const context = {
  actor: { id: 'menu-admin', role: 'admin' },
  access: { mode: 'global', allowedMarkets: ['KM', 'CM', 'CG'], defaultMarket: null, capabilities: [] },
};

async function serve(page) {
  await page.route(`${ORIGIN}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/admin/')) return route.fulfill({ contentType: 'text/html', body: INDEX });
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (url.pathname === '/icons/favicon-32.png') return route.fulfill({ status: 204, body: '' });
    if (url.pathname === '/api/auth/me') return route.fulfill(json({ id: 'menu-admin', role: 'admin' }));
    if (url.pathname === '/api/admin/dashboard/context') return route.fulfill(json(context));
    if (url.pathname.startsWith('/api/')) return route.fulfill(json({ items: [], rows: [], users: [], providers: [] }));
    return route.fulfill({ status: 404, body: '' });
  });
}

const activeLabels = page => page.evaluate(() =>
  [...document.querySelectorAll('.kmc-admin-navigation .kmc-admin-primary-link.is-active')]
    .map(link => link.querySelector('.kmc-admin-primary-label').textContent.trim()));

test.describe('Menu latéral — une entrée active, accès administration', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    await serve(page);
  });

  test('Catalogue et Produits ne sont jamais allumés ensemble (chargement direct)', async ({ page }) => {
    await page.goto(`${ORIGIN}/admin/workspaces/catalog`);
    await page.waitForSelector('.kmc-admin-primary-link.is-active');
    expect(await activeLabels(page)).toEqual(['Catalogue']);

    await page.goto(`${ORIGIN}/admin/workspaces/catalog?view=advanced`);
    await page.waitForSelector('.kmc-admin-primary-link.is-active');
    expect(await activeLabels(page)).toEqual(['Produits']);
  });

  test('Catalogue et Produits ne sont jamais allumés ensemble (navigation sans rechargement)', async ({ page }) => {
    await page.goto(`${ORIGIN}/admin/workspaces/catalog`);
    await page.waitForSelector('.kmc-admin-primary-link.is-active');
    await page.click('.kmc-admin-navigation a[data-dashboard="entity-products"]');
    await page.waitForURL('**view=advanced*');
    await page.waitForTimeout(500);
    expect(await activeLabels(page)).toEqual(['Produits']);

    await page.click('.kmc-admin-navigation a[data-dashboard="workspace-catalog"]');
    await page.waitForURL(url => url.pathname === '/admin/workspaces/catalog' && !url.search);
    await page.waitForTimeout(500);
    expect(await activeLabels(page)).toEqual(['Catalogue']);
  });

  for (const [route, label] of [['/admin/users', 'Utilisateurs'], ['/admin/providers', 'Providers'], ['/admin/settings', 'Paramètres']]) {
    test(`${label} : la page reste sur ${route} pour un admin`, async ({ page }) => {
      await page.goto(`${ORIGIN}${route}`);
      await page.waitForTimeout(1200);
      expect(new URL(page.url()).pathname).toBe(route);
      expect(await page.evaluate(() => document.body.dataset.kmcSurface)).not.toBe('pilotage');
    });
  }
});
