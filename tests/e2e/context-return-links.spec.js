'use strict';

/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires none
 *
 * L4 — parcours avec contexte : un lien vers une fiche 360 ou un PO depuis l'Action Center
 * porte `return_to` ; la fiche résout alors son retour vers l'écran d'origine (filtres inclus).
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';

async function serveCanonical(route) {
  const url = new URL(route.request().url());
  if (!url.pathname.startsWith('/dashboards/canonical/')) return false;
  const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
  if (!fs.existsSync(file)) return false;
  const type = file.endsWith('.js') ? 'application/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
  await route.fulfill({ contentType: type, body: fs.readFileSync(file) });
  return true;
}

test('Action Center → fiche Order 360 / PO : le retour revient à l’Action Center filtré', async ({ page }) => {
  await page.route(`${ORIGIN}/**`, async route => {
    if (await serveCanonical(route)) return;
    const url = new URL(route.request().url());
    if (url.pathname === '/admin/action-center') {
      return route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html lang="fr"><body><main id="canonical-admin-root"></main>
          <script src="/dashboards/canonical/js/primitives.js"></script>
          <script src="/dashboards/canonical/js/navigation-policy-v4.js"></script>
          <script src="/dashboards/canonical/js/action-center.js"></script></body></html>`,
      });
    }
    if (url.pathname === '/api/admin/action-center') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          summary: { total: 2, urgent: 1, warning: 1, info: 0 },
          signals: [
            {
              signal_ref: 'KSG-ORD-1', title: 'Commande bloquée', summary: 's', recommendation: 'r',
              signal_type: 'parcel_blocked', owner_role: 'hub', status: 'open', severity: 'urgent', family: 'ops',
              actions: ['acknowledge'], entity: { type: 'order', ref: 'CMD-9', label: 'CMD-9', href: '/admin/orders/CMD-9' },
            },
            {
              signal_ref: 'KSG-PO-1', title: 'PO à revoir', summary: 's', recommendation: 'r',
              signal_type: 'supplier_payment_review', owner_role: 'purchasing', status: 'open', severity: 'urgent', family: 'ops',
              actions: ['acknowledge'], work_item: { actionable: true, href: '/admin/workspaces/purchasing?po=PO-42' },
            },
          ],
        }),
      });
    }
    return route.fulfill({ status: 404, body: '' });
  });

  await page.goto(`${ORIGIN}/admin/action-center?severity=urgent`);
  await page.evaluate(async () => {
    await window.KomerceCanonicalActionCenter.mount({
      root: document.getElementById('canonical-admin-root'),
      document,
      user: { role: 'admin' },
      fetch: window.fetch.bind(window),
      ui: window.KomerceCanonicalUI,
      adminContext: { access: { mode: 'global' } },
      location: window.location,
    });
  });

  const orderHref = await page.getByRole('link', { name: 'Voir CMD-9' }).getAttribute('href');
  const poHref = await page.getByRole('link', { name: 'Traiter' }).getAttribute('href');
  expect(orderHref.startsWith('/admin/orders/CMD-9?')).toBe(true);
  expect(poHref.startsWith('/admin/workspaces/purchasing?po=PO-42&')).toBe(true);

  const back = await page.evaluate(search => window.KomerceCanonicalNavigation.resolveBackTarget('order-360', search), orderHref.split('?')[1]);
  expect(back.href).toBe('/admin/action-center?severity=urgent');
  expect(back.label).toBe('Retour à À traiter');
});
