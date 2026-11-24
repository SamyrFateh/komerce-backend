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

test('Direction Hub : décisions hiérarchisées, PO ciblée et aucun geste financier au simple clic', async ({ page }) => {
  await page.route('**/*', route => route.abort('blockedbyclient'));
  await page.goto('about:blank');
  await page.setContent('<!doctype html><html lang="fr"><body><div id="queue"></div></body></html>');
  await page.addStyleTag({ content: CSS });
  await page.addScriptTag({ content: WS });
  await page.evaluate(async () => {
    window.__hubWrites = [];
    const po = '11111111-1111-4111-8111-111111111111';
    const tasks = [
      { kind:'AWAIT_RECEIPT', owner:'agent_hub', market:{code:'KM'}, missing:'Réception fournisseur à suivre', age_hours:4 },
      { kind:'AUTHORIZE_PAYMENT', owner:'responsable_hub', market:{code:'CM'}, subject:{po_id:po},
        missing:'Autorisation paiement', age_hours:52, overdue:true, viewer_can_act:false,
        blocked_reason:'Droit de paiement requis' },
      { kind:'BLOCKED_BY_SHORTFALL', owner:'responsable_hub', market:{code:'CG'},
        subject:{order_id:'22222222-2222-4222-8222-222222222222'}, missing:'Commande bloquée', age_hours:7 },
      { kind:'AUTHORIZE_COMMITMENT', owner:'responsable_hub', market:{code:'KM'}, subject:{po_id:po},
        missing:'Engagement à valider', age_hours:9, viewer_can_act:true },
    ];
    const fetchFn = async (url, opts) => {
      if (opts.method !== 'GET') window.__hubWrites.push({ url, method:opts.method });
      return { ok:true, json: async () => ({ scope:'ALL_MARKETS', total:4, overdue_count:1, tasks }) };
    };
    await window.KomerceCanonicalHubWorkstation.renderDirectorQueue(document.getElementById('queue'), {
      document, fetch:fetchFn, user:{role:'agent_hub'}
    });
  });
  await expect(page.locator('[data-hub-director-group]')).toHaveCount(4);
  await expect(page.locator('[data-hub-director-group]').first()).toHaveAttribute('data-hub-director-group','commitment');
  await expect(page.locator('[data-hub-director-group="payment"]')).toContainText('Autorisation paiement');
  await expect(page.locator('[data-hub-director-task="AUTHORIZE_PAYMENT"]')).toContainText('Droit de paiement requis');
  await expect(page.locator('[data-hub-director-task="AUTHORIZE_PAYMENT"] a')).toHaveAttribute(
    'href', /market=CM&entry=direction&sel=po%3A11111111-1111-4111-8111-111111111111/);
  await page.setViewportSize({width:390,height:844});
  const overflow=await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => window.__hubWrites)).toEqual([]);
});
