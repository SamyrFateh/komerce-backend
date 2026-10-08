/**
 * @e2e   live-ops-shell.spec.js
 * @feature dashboard (navigation canonique, coque Live noire)
 * @brief Le domaine « Live » porte les cockpits opérationnels : entrée de menu dédiée,
 *        coque entièrement noire (sidebar, barre du haut, contenu) et écrans de gestion
 *        inchangés (coque claire). API simulée : aucun serveur ni base requis.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';
const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
const CSS = [...index.matchAll(/href="\/dashboards\/canonical\/css\/([^"?]+)\.css/g)].map((m) => m[1]);

async function mountShell(page, { role = 'admin', surface = 'import-runtime', pathname = '/admin/import-runtime' } = {}) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === pathname) {
      const links = CSS.map((n) => `<link rel="stylesheet" href="/dashboards/canonical/css/${n}.css">`).join('');
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="fr"><head><meta charset="utf-8">${links}</head>
          <body data-admin-generation="canonical"><main id="canonical-admin-root"></main>
          <script>window.KOMERCE_CANONICAL_AUTH_USER=${JSON.stringify({ role })};</script>
          <script src="/dashboards/canonical/js/navigation-policy-v4.js"></script>
          <script src="/dashboards/canonical/js/import-runtime.js"></script></body></html>`,
      });
    }
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto(`${ORIGIN}${pathname}`);
  await page.evaluate(({ role: r, surface: s }) => {
    window.KomerceCanonicalNavigation.mount({ user: { role: r }, surface: s });
    const root = document.getElementById('canonical-admin-root');
    if (s === 'import-runtime') window.KomerceCanonicalImportRuntime.render(root, { source_controls: [], lots: [], selected: null });
    else root.innerHTML = '<section class="kmc-page"><h1>Vue de gestion</h1></section>';
  }, { role, surface });
}

const lum = (c) => c.match(/\d+/g).slice(0, 3).map(Number).reduce((a, b) => a + b, 0) / 3;

test.describe('Coque Live — menu dédié et noir complet', () => {
  test('le menu latéral porte une entrée « Live » distincte d’Opérations', async ({ page }) => {
    await mountShell(page);
    const links = await page.$$eval('.kmc-admin-primary-link', (els) => els.map((el) => ({
      id: el.getAttribute('data-dashboard'), label: el.textContent.trim(), active: el.classList.contains('is-active'), href: el.getAttribute('href'),
    })));
    const ids = links.map((l) => l.id);
    expect(ids).toContain('live-import-runtime');
    // Le groupe Live suit immédiatement le groupe Flux (Commerce, Commandes & logistique, Finance).
    expect(ids.indexOf('live-import-runtime')).toBe(ids.indexOf('flow-finance') + 1);
    const live = links.find((l) => l.id === 'live-import-runtime');
    expect(live.active).toBe(true);
    expect(live.href).toBe('/admin/import-runtime');
    expect(links.find((l) => l.id === 'flow-operations').active).toBe(false);
  });

  test('sidebar, barre du haut, recherche et contenu sont noirs (aucune surface claire)', async ({ page }) => {
    await mountShell(page);
    await expect(page.locator('body')).toHaveClass(/kmc-shell-live/);
    const bg = await page.evaluate(() => {
      const c = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).backgroundColor : null; };
      return {
        body: c('body'), sidebar: c('body > .kmc-admin-navigation'), topbar: c('.kmc-admin-topbar'),
        search: c('.kmc-admin-search'), root: c('#canonical-admin-root'), tabs: c('.kmc-admin-domain-tabs'),
      };
    });
    for (const [name, value] of Object.entries(bg)) {
      if (value === null) continue;
      expect(lum(value), `${name} = ${value}`).toBeLessThan(40);
    }
    expect(bg.topbar).not.toBeNull();
  });

  test('pas de bordure orange claire sous la barre du haut, texte lisible', async ({ page }) => {
    await mountShell(page);
    const info = await page.evaluate(() => {
      const top = getComputedStyle(document.querySelector('.kmc-admin-topbar'));
      const input = getComputedStyle(document.querySelector('.kmc-admin-search-input'));
      return { border: top.borderBottomColor, width: parseFloat(top.borderBottomWidth), text: input.color };
    });
    expect(info.width).toBeLessThanOrEqual(1);
    expect(lum(info.border)).toBeLessThan(80);
    expect(lum(info.text)).toBeGreaterThan(150);
  });

  test('aucune grande surface blanche dans la page Live, logo lisible', async ({ page }) => {
    await mountShell(page);
    const info = await page.evaluate(() => {
      const whites = [...document.querySelectorAll('body *')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 300 && r.height > 30 && getComputedStyle(el).backgroundColor === 'rgb(255, 255, 255)';
      }).map((el) => el.className || el.tagName);
      const label = getComputedStyle(document.querySelector('.kmc-admin-home-label'));
      return { whites, labelFill: label.webkitTextFillColor };
    });
    expect(info.whites).toEqual([]);
    expect(lum(info.labelFill)).toBeGreaterThan(200);
  });

  test('les écrans de gestion gardent la coque claire (pas de contamination)', async ({ page }) => {
    await mountShell(page, { surface: 'operations', pathname: '/admin/operations' });
    await expect(page.locator('body')).not.toHaveClass(/kmc-shell-live/);
    const topbar = await page.evaluate(() => getComputedStyle(document.querySelector('.kmc-admin-topbar')).backgroundColor);
    expect(lum(topbar)).toBeGreaterThan(200);
  });

  test('Sourcing live n’apparaît plus dans les onglets Opérations ; le rôle sourcing ne voit que Live', async ({ page }) => {
    await mountShell(page, { surface: 'operations', pathname: '/admin/operations' });
    const tabs = await page.$$eval('.kmc-admin-domain-tab', (els) => els.map((el) => el.textContent.trim()));
    expect(tabs).not.toContain('Sourcing live');
    await page.unroute(`${ORIGIN}/**`);
  });

  test('capture de revue de la coque Live 1672×941', async ({ page }, testInfo) => {
    await mountShell(page);
    await page.screenshot({ path: testInfo.outputPath('live-shell.png') });
  });
});

test.describe('Coque Live — rôle sourcing', () => {
  test('ne voit que son workspace Sourcing et le cockpit Live (aucun faux Dashboard, pas d’Opérations)', async ({ page }) => {
    await mountShell(page, { role: 'sourcing' });
    const ids = await page.$$eval('.kmc-admin-primary-link', (els) => els.map((el) => el.getAttribute('data-dashboard')));
    expect(ids).toEqual(['live-import-runtime', 'workspace-sourcing']);
  });
});
