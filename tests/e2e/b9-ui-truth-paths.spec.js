/**
 * @e2e b9-ui-truth-paths.spec.js
 * @feature B9 — coutures UI de vérité avant Prod
 * @brief Prouve la descente Pilotage → flux, Action Center → workspace propriétaire,
 *        résolution universelle → vérité canonique et les quatre états de santé.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';

async function serveCanonical(route) {
  const url = new URL(route.request().url());
  if (!url.pathname.startsWith('/dashboards/canonical/')) return false;
  const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
  if (!fs.existsSync(file)) {
    await route.fulfill({ status: 404, body: '' });
    return true;
  }
  await route.fulfill({ path: file });
  return true;
}

test.describe('B9 — descente de vérité', () => {
  test('Tour de contrôle → signal structurel → flux propriétaire', async ({ page }) => {
    await page.route(`${ORIGIN}/**`, async route => {
      if (await serveCanonical(route)) return;
      const url = new URL(route.request().url());
      if (url.pathname === '/admin/pilotage') {
        return route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html lang="fr"><body><main id="canonical-admin-root"></main>
            <script src="/dashboards/canonical/js/primitives.js"></script>
            <script src="/dashboards/canonical/js/dashboard-schema.js"></script>
            <script src="/dashboards/canonical/js/dashboard-renderer.js"></script>
            <script src="/dashboards/canonical/js/pilotage.js"></script></body></html>`,
        });
      }
      if (url.pathname === '/api/admin/dashboard/unified') {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            kpis_global: [],
            system_alerts: [{
              title: 'Paiement fournisseur bloqué',
              message: '3 commandes impactées',
              severity: 'critical',
              action_url: '/admin/orders-logistics?cause=PAYMENT_BLOCKED',
              action_label: 'Voir le flux',
            }],
            view_blocks: [],
            economic_flow: { stages: [] },
          }),
        });
      }
      if (url.pathname === '/admin/operations') {
        return route.fulfill({ contentType: 'text/html', body: '<h1>Commandes & logistique</h1>' });
      }
      return route.fulfill({ status: 404, body: '' });
    });

    await page.goto(`${ORIGIN}/admin/pilotage`);
    await page.evaluate(async () => {
      await window.KomerceCanonicalPilotage.mount({
        root: document.getElementById('canonical-admin-root'),
        document,
        ui: window.KomerceCanonicalUI,
        renderer: window.KomerceDashboardRenderer,
        fetch: window.fetch.bind(window),
        adminContext: {},
        contextContract: { resolveMarketView: () => ({ mode: 'global' }) },
      });
    });

    const signal = page.getByRole('link', { name: 'Voir le flux' });
    await expect(signal).toHaveAttribute('href', '/admin/operations?cause=PAYMENT_BLOCKED');
    await signal.click();
    await expect(page.getByRole('heading', { name: 'Commandes & logistique' })).toBeVisible();
  });
});

test.describe('B9 — Action Center vers propriétaire', () => {
  test('Traiter ouvre le workspace donné par le backend, sans inférence frontend', async ({ page }) => {
    await page.route(`${ORIGIN}/**`, async route => {
      if (await serveCanonical(route)) return;
      const url = new URL(route.request().url());
      if (url.pathname === '/admin/action-center') {
        return route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html lang="fr"><body><main id="canonical-admin-root"></main>
            <script src="/dashboards/canonical/js/primitives.js"></script>
            <script src="/dashboards/canonical/js/action-center.js"></script></body></html>`,
        });
      }
      if (url.pathname === '/api/admin/action-center') {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            summary: { total: 1, urgent: 1, warning: 0, info: 0 },
            signals: [{
              signal_ref: 'KSG-PAY-001',
              title: 'Paiement fournisseur bloqué',
              summary: '3 commandes impactées',
              recommendation: 'Vérifier le paiement fournisseur',
              signal_type: 'supplier_payment_review',
              owner_role: 'purchasing',
              status: 'open',
              severity: 'urgent',
              family: 'ops',
              actions: ['acknowledge', 'snooze', 'resolve'],
              work_item: {
                actionable: true,
                href: '/admin/workspaces/purchasing?po=PO-42',
              },
            }],
          }),
        });
      }
      if (url.pathname === '/admin/workspaces/purchasing') {
        return route.fulfill({ contentType: 'text/html', body: '<h1>Achats fournisseurs</h1>' });
      }
      return route.fulfill({ status: 404, body: '' });
    });

    await page.goto(`${ORIGIN}/admin/action-center`);
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

    const traiter = page.getByRole('link', { name: 'Traiter' });
    await expect(traiter).toHaveAttribute('href', '/admin/workspaces/purchasing?po=PO-42');
    await traiter.click();
    await expect(page.getByRole('heading', { name: 'Achats fournisseurs' })).toBeVisible();
  });
});

test.describe('B9 — résolution de référence', () => {
  test('une référence résolue par le serveur ouvre sa vérité canonique', async ({ page }) => {
    await page.route(`${ORIGIN}/**`, async route => {
      if (await serveCanonical(route)) return;
      const url = new URL(route.request().url());
      if (url.pathname === '/admin/pilotage') {
        return route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html lang="fr"><body data-admin-generation="canonical">
            <main id="canonical-admin-root"></main>
            <script>
              window.KOMERCE_CANONICAL_AUTH_USER={"role":"admin"};
              window.KomerceCanonicalAdmin={
                surfaceForPath:()=> 'pilotage',
                marketChoices:()=> []
              };
            </script>
            <script src="/dashboards/canonical/js/navigation-policy-v4.js"></script></body></html>`,
        });
      }
      if (url.pathname === '/api/admin/dashboard/reference/resolve') {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            matches: [{
              entity_type: 'PARCEL',
              matched_reference: 'PCL-9001',
              customer_order_reference: 'KOM-360-001',
              market_code: 'KM',
              current_position: { stage: 'CUSTOMS', health: 'RED' },
              canonical_href: '/admin/orders/KOM-360-001',
            }],
            orphans: [],
          }),
        });
      }
      if (url.pathname === '/admin/orders/KOM-360-001') {
        return route.fulfill({ contentType: 'text/html', body: '<h1>ORDER 360 · KOM-360-001</h1>' });
      }
      return route.fulfill({ status: 404, body: '' });
    });

    await page.goto(`${ORIGIN}/admin/pilotage`);
    await page.evaluate(() => window.KomerceCanonicalNavigation.mount({
      user: window.KOMERCE_CANONICAL_AUTH_USER,
      surface: 'pilotage',
      document,
    }));
    const search = page.getByRole('searchbox', { name: 'Rechercher une référence opérationnelle' });
    await search.fill('PCL-9001');
    await page.getByRole('button', { name: 'Trouver' }).click();

    const result = page.locator('.kmc-admin-reference-result[href="/admin/orders/KOM-360-001"]');
    await expect(result).toContainText('PARCEL · PCL-9001');
    await expect(result).toContainText('CUSTOMS');
    await expect(result).toContainText('RED');
    await result.click();
    await expect(page.getByRole('heading', { name: 'ORDER 360 · KOM-360-001' })).toBeVisible();
  });
});

test.describe('B9 — quatre états de santé', () => {
  test('GREEN / ORANGE / RED / UNKNOWN sont distincts et UNKNOWN n’est jamais vert', async ({ page }) => {
    await page.route(`${ORIGIN}/**`, async route => {
      if (await serveCanonical(route)) return;
      const url = new URL(route.request().url());
      if (url.pathname === '/health') {
        return route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><main id="root"></main>
            <script src="/dashboards/canonical/js/decision-primitives.js"></script></body></html>`,
        });
      }
      return route.fulfill({ status: 404, body: '' });
    });

    await page.goto(`${ORIGIN}/health`);
    await page.evaluate(() => {
      const root = document.getElementById('root');
      for (const health of ['GREEN', 'ORANGE', 'RED', 'UNKNOWN']) {
        const host = document.createElement('div');
        host.dataset.case = health;
        root.appendChild(host);
        window.KomerceDecisionUI.HealthBadge.render(host, {
          health,
          cause: 'Cause test',
          owner: 'Owner test',
          observedAt: '2026-10-08T12:00:00Z',
          now: '2026-10-08T12:05:00Z',
          stale: false,
        });
      }
    });

    const expected = {
      GREEN: ['is-green', 'Sain'],
      ORANGE: ['is-orange', 'À surveiller'],
      RED: ['is-red', 'Bloqué'],
      UNKNOWN: ['is-unknown', 'Non observé'],
    };
    for (const [state, [klass, label]] of Object.entries(expected)) {
      const badge = page.locator(`[data-case="${state}"] .kmc-health`);
      await expect(badge).toHaveClass(new RegExp(klass));
      await expect(badge).toContainText(label);
      await expect(badge).toHaveAttribute('data-health', state);
    }
    await expect(page.locator('[data-case="UNKNOWN"] .kmc-health')).not.toHaveClass(/is-green/);
  });
});
