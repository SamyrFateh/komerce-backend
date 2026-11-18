/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires none
 * @komerce-arch-lite
 * @role g6-fiab-director-queue-stable-height
 * @domain dashboard
 * @layer e2e
 * @purpose P1 FIAB : la file direction Hub réserve sa hauteur (aucun décalage du contenu
 *          en dessous à l'arrivée des données) et expose data-hub-director-state. Réseau refusé.
 * @impact-areas hub, dashboard, test-only
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const base = path.join(__dirname, '../../public/dashboards/canonical');
const CSS = fs.readFileSync(path.join(base, 'css/hub-live-cockpit.css'), 'utf8');
const WS = fs.readFileSync(path.join(base, 'js/hub-workstation.js'), 'utf8');

test('file direction retardée : le contenu en dessous ne bouge pas à son arrivée', async ({ page }) => {
  await page.route('**/*', (route) => route.abort('blockedbyclient'));
  await page.goto('about:blank');
  await page.setContent('<!doctype html><body><div id="queue"></div><div id="below">contenu</div></body>');
  await page.addStyleTag({ content: CSS });
  await page.addScriptTag({ content: WS });
  await page.evaluate(() => {
    const tasks = Array.from({ length: 8 }, (_, i) => ({ kind: 'T' + i, missing: 'Tâche ' + i, market: { code: 'KM' }, age_hours: 5 }));
    const fetchFn = () => new Promise((r) => setTimeout(() => r({ ok: true, status: 200, json: async () => ({ scope: 'ALL_MARKETS', tasks, overdue_count: 0 }), text: async () => '' }), 400));
    window.KomerceCanonicalHubWorkstation.renderDirectorQueue(document.getElementById('queue'), { document, fetch: fetchFn, user: { role: 'admin' } });
  });
  const top = () => page.locator('#below').evaluate((e) => Math.round(e.getBoundingClientRect().top));
  await expect(page.locator('[data-hub-director-state="loading"]')).toHaveCount(1);
  const before = await top();
  await expect(page.locator('[data-hub-director-state="ready"]')).toHaveCount(1);
  expect(await top()).toBe(before);
});
