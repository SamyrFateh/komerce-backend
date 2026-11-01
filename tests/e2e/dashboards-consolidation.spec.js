/**
 * @e2e dashboards-consolidation.spec.js
 * @feature dashboard (À traiter, Clients)
 * @brief Revue déterministe des vues consolidées : À traiter compact (2 colonnes) et téléphone client masqué.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';
const index = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');
const CSS = [...index.matchAll(/href="\/dashboards\/canonical\/css\/([^"?]+)\.css/g)].map(m => m[1]);
const SHOTS = process.env.KMC_SHOTS_DIR || null;

const sig = (n, severity, family, title, ref) => ({
  signal_ref: `SIG-${n}`, family, severity, title, summary: `Cause métier ${n}`,
  recommendation: 'Ouvrir le dossier', status: 'open', actions: ['acknowledge', 'snooze'],
  created_at: new Date(Date.now() - n * 3600e3).toISOString(), auto_resolves: true,
  work_item: { actionable: true, href: `/admin/orders/${ref}` },
  entity: { type: 'order', ref, label: ref, href: `/admin/orders/${ref}` },
});
const SIGNALS = [
  sig(1, 'critical', 'ops', 'Commande bloquée', 'CMD-1'), sig(2, 'critical', 'ops', 'Commande bloquée', 'CMD-2'),
  sig(3, 'urgent', 'eco', 'Écart de marge', 'CMD-3'), sig(4, 'warning', 'sourcing', 'Fournisseur lent', 'CMD-4'),
];
const CLIENTS = { clients: [{ name: 'Amina', phone: '+2691234567', orders_valid: 2, ltv_kmf: 90000, average_basket_kmf: 45000, markets: ['KM'] }],
  pagination: { page: 1, total_pages: 1 } };

async function boot(page, kind, viewport) {
  await page.route(`${ORIGIN}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (url.pathname === '/api/admin/action-center') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        summary: { urgent: 3, warning: 1, info: 0, total_active: 4 }, signals: SIGNALS }) });
    }
    if (url.pathname === '/api/admin/entities/clients') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(CLIENTS) });
    if (url.pathname.startsWith('/admin/')) {
      const links = CSS.map(n => `<link rel="stylesheet" href="/dashboards/canonical/css/${n}.css">`).join('');
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8">${links}</head>
        <body data-admin-generation="canonical"><main id="root"></main>
        <script src="/dashboards/canonical/js/primitives.js"></script>
        <script src="/dashboards/canonical/js/decision-primitives.js"></script>
        <script src="/dashboards/canonical/js/navigation-policy-v4.js"></script>
        <script src="/dashboards/canonical/js/business-date.js"></script>
        <script src="/dashboards/canonical/js/action-center.js"></script>
        <script src="/dashboards/canonical/js/client-index.js"></script></body></html>` });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.setViewportSize(viewport);
  await page.goto(`${ORIGIN}/admin/${kind}`);
  await page.evaluate(async k => {
    const base = { root: document.getElementById('root'), document, ui: window.KomerceCanonicalUI, fetch: window.fetch.bind(window),
      adminContext: { actor: { role: 'admin' }, access: { mode: 'global', allowedMarkets: ['KM', 'CM'] } }, user: { role: 'admin' },
      contextContract: { resolveMarketView: () => ({ mode: 'global' }) } };
    if (k === 'action-center') await window.KomerceCanonicalActionCenter.mount(base);
    else await window.KomerceCanonicalClientIndex.mount(base);
  }, kind);
}

for (const [label, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
  test.describe(`consolidation ${label}`, () => {
    test('À traiter : deux colonnes, groupement, filtre domaine, sans débordement', async ({ page }) => {
      await boot(page, 'action-center', viewport);
      const cols = page.locator('.kmc-action-column');
      await expect(cols).toHaveCount(2);
      await expect(cols.nth(0)).toContainText('Urgent / critique · 3');
      await expect(cols.nth(1)).toContainText('Avertissements · 1');
      await expect(page.locator('.kmc-action-group')).toHaveCount(1);
      await expect(page.locator('.kmc-action-signal').first()).toBeHidden();
      await page.locator('.kmc-action-group > summary').click();
      await expect(page.locator('[data-signal-ref="SIG-1"] a.kmc-workspace-action')).toHaveText('Traiter');
      await page.selectOption('[data-action-center-domain]', 'eco');
      await expect(page.locator('.kmc-action-signal')).toHaveCount(1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow).toBe(false);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `action-center-${label}.png`), fullPage: true });
    });

    test('Clients : téléphone masqué, bouton œil, révélation puis masquage', async ({ page }) => {
      await boot(page, 'clients', viewport);
      const masked = page.locator('.kmc-client-phone-masked');
      await expect(masked).toHaveText('•••• 4567');
      const toggle = page.locator('.kmc-client-phone-toggle');
      await expect(toggle).toHaveAttribute('aria-label', 'Afficher le téléphone');
      await toggle.click();
      await expect(masked).toHaveText('+2691234567');
      await toggle.click();
      await expect(masked).toHaveText('•••• 4567');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `clients-${label}.png`), fullPage: true });
    });
  });
}
