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

test('Commerce : drill acheteurs paginé, périmètre figé et refus de population modifiée', async ({page})=>{
  await page.setViewportSize({width:1280,height:900});
  await page.setContent('<main id="root"></main>');
  await page.addStyleTag({path:path.join(CANONICAL,'css','decision-visual.css')});
  await page.evaluate(()=>{window.module={exports:{}};});
  await page.addScriptTag({path:path.join(CANONICAL,'js','commerce-decision.js')});
  await page.evaluate(()=>{
    const period={from:'2026-10-13T23:00:00.000Z',to:'2026-10-20T12:00:00.000Z',timezone:'Africa/Douala'};
    const scope={mode:'market',market:{code:'CM'}};
    const simulation={scope:'RCT1'};
    const token='a'.repeat(32);
    const payload={period:7,period_definition:period,scope,simulation,buyer_cohort:{paid_buyers:26,repeat_paid_buyers:1,completeness:'complete',population_token:token}};
    window.buyerCalls=[];window.buyerChanged=false;
    const fetch=async(url,opts)=>{
      const p=new URL(url,'https://komerce.test').searchParams;
      const kind=p.get('buyer_drill');const pg=Number(p.get('page'));
      window.buyerCalls.push({url,method:opts.method});
      const total=kind==='repeat_paid_buyers'?1:26;
      const accounts=Array.from({length:Math.min(25,Math.max(0,total-(pg-1)*25))},(_,i)=>({
        paid_orders:kind==='repeat_paid_buyers'?2:1,latest_order_reference:'K-'+(i+1+(pg-1)*25)
      }));
      return {ok:true,json:async()=>({kind,period:7,period_definition:period,scope,simulation,
        population_token:window.buyerChanged?'b'.repeat(32):token,
        pagination:{page:pg,page_size:25,total,total_pages:Math.ceil(total/25)},accounts})};
    };
    const host=window.module.exports.renderBuyerCohort(document,payload,{fetch,buyerEndpoint:'/api/admin/dashboard/commerce/market/CM'},{formatNumber:String});
    document.getElementById('root').appendChild(host);
  });
  const paid=page.locator('[data-buyer-drill="paid_buyers"]');
  const repeat=page.locator('[data-buyer-drill="repeat_paid_buyers"]');
  const detail=page.locator('.kmc-commerce-buyer-detail');
  await expect(detail).toBeHidden();
  await expect(paid).toContainText('26');
  await paid.click();
  await expect(detail.locator('li')).toHaveCount(25);
  await detail.getByRole('button',{name:'Suivant'}).click();
  await expect(detail.locator('li')).toHaveCount(1);
  await expect(detail).toContainText('K-26');
  await expect(detail.getByRole('button',{name:'Suivant'})).toBeDisabled();
  await repeat.click();
  await expect(detail.locator('li')).toHaveCount(1);
  await expect(detail).toContainText('2 commande(s) payée(s)');
  await detail.getByRole('button',{name:'Fermer'}).click();
  await expect(detail).toBeHidden();
  await page.evaluate(()=>{window.buyerChanged=true;});
  await paid.click();
  await expect(detail).toContainText('Population modifiée ou non réconciliée');
  await expect(detail.locator('li')).toHaveCount(0);
  const calls=await page.evaluate(()=>window.buyerCalls);
  expect(calls).toHaveLength(4);
  for(const call of calls){
    const url=new URL(call.url,'https://komerce.test');
    expect(url.pathname).toBe('/api/admin/dashboard/commerce/market/CM');
    expect(url.searchParams.get('as_of')).toBe('2026-10-20T12:00:00.000Z');
    expect(url.searchParams.get('simulation_scope')).toBe('RCT1');
    expect(url.searchParams.get('population_token')).toBe('a'.repeat(32));
    expect(call.method).toBe('GET');
  }
});
