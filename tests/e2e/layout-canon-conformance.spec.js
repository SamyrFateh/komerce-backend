/**
 * @e2e layout-canon-conformance.spec.js
 * @feature dashboard
 * @brief Conformité réelle des quatre écrans de référence aux derniers mocks Komerce :
 *        Pilotage / Action Center / Commerce / Operations à 1672×941.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const ORIGIN = 'http://komerce.test';
const INDEX = fs.readFileSync(path.join(CANONICAL, 'index.html'), 'utf8');

const context = {
  actor: { id: 'layout-admin', role: 'admin' },
  access: {
    mode: 'global',
    allowedMarkets: ['KM', 'CM', 'CG'],
    defaultMarket: null,
    capabilities: [],
  },
};

const chainStages = [
  ['ORDER','Commande'],['PURCHASING','Achats fournisseurs'],['SUPPLIER','Fournisseur'],
  ['HUB_RECEIVING','Réception HUB'],['HUB_CONTROL','Contrôle HUB'],['FORWARDER','Transitaire'],
  ['TRANSPORT','Transport'],['CUSTOMS','Douane'],['RELAY','Relais'],
];

const controlChain = {
  stages: chainStages.map(([key,label], index) => ({
    key, label,
    health: index === 1 ? 'RED' : (index === 6 ? 'ORANGE' : 'GREEN'),
    order_count: index < 4 ? index + 1 : 0,
    health_counts: index === 1
      ? { GREEN:0, ORANGE:0, RED:2, UNKNOWN:0 }
      : index === 6
        ? { GREEN:0, ORANGE:1, RED:0, UNKNOWN:0 }
        : { GREEN:index < 4 ? index + 1 : 0, ORANGE:0, RED:0, UNKNOWN:0 },
  })),
  structural_alerts: [],
  by_stage: Object.fromEntries(chainStages.map(([key]) => [key, []])),
};

const pilotage = {
  kpis_global: [
    { key:'cmds_actives', label:'Commandes actives', value:11, unit:'count', data_quality:{} },
    { key:'alertes_critiques', label:'Alertes critiques', value:2, unit:'count', data_quality:{}, drill_to:'/admin/action-center?severity=critical,urgent' },
    { key:'points_attention', label:'Points attention', value:1, unit:'count', data_quality:{}, drill_to:'/admin/action-center?severity=warning' },
  ],
  view_blocks: [],
  economic_flow:{ stages:[] },
  principles:[],
  control_chain:controlChain,
  system_alerts:[],
  data_quality:{ generated_at:'2026-10-09T18:00:00.000Z', warnings:[], scope_enforced:true },
};

const commerce = {
  period:'30',
  kpis:[
    { key:'ca_encaisse', value:820000, unit:'KMF', data_quality:{} },
    { key:'cmds_creees', value:24, unit:'count', data_quality:{} },
    { key:'panier_moyen', value:34167, unit:'KMF', data_quality:{} },
    { key:'produits_actifs_vendus', value:9, unit:'count', data_quality:{} },
  ],
  decision_signals:[
    { key:'orders-lost', label:'Commandes à récupérer', helper:'Décision commerciale', value_count:3, severity:'warning', destination:{kind:'commerce_funnel'} },
    { key:'margin-watch', label:'Rentabilité à surveiller', helper:'Vérifier la marge', value_count:1, severity:'warning', destination:{kind:'commerce_profitability'} },
  ],
  top_products:[],
  product_profitability:[],
  categories:[],
  funnel:{
    lost:3,
    steps:[
      { id:'created', label:'Créées', count:24, pct:100 },
      { id:'paid', label:'Payées', count:18, pct:75 },
      { id:'shipped', label:'Expédiées', count:12, pct:50 },
      { id:'relay', label:'Au relais', count:8, pct:33 },
    ],
  },
  data_quality:{ generated_at:'2026-10-09T18:00:00.000Z', warnings:[], scope_enforced:true },
};

const operations = {
  kpis:[
    { key:'cmds_aujourdhui', value:4, unit:'count', data_quality:{} },
    { key:'retards_critiques', value:2, unit:'count', data_quality:{} },
  ],
  active_orders:[],
  critical_delays:[],
  signals:[],
  control_chain:controlChain,
  data_quality:{ generated_at:'2026-10-09T18:00:00.000Z', warnings:[], scope_enforced:true },
};

const actionCenter = {
  summary:{ total_active:4, urgent:1, warning:2, info:1 },
  signals:[
    {
      signal_ref:'SIG-1',
      title:'Paiement fournisseur à traiter',
      summary:'Une commande nécessite une décision.',
      recommendation:'Ouvrir le contexte fournisseur.',
      severity:'urgent',
      family:'ops',
      status:'open',
      actions:['acknowledge','snooze','resolve'],
      work_item:{ actionable:true, href:'/admin/workspaces/purchasing?po=PO-1' },
    },
  ],
};

async function serve(page) {
  await page.route(`${ORIGIN}/**`, async route => {
    const url = new URL(route.request().url());

    if (['/admin/pilotage','/admin/action-center','/admin/commerce','/admin/operations'].includes(url.pathname)) {
      return route.fulfill({ contentType:'text/html', body:INDEX });
    }

    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/',''));
      return fs.existsSync(file) ? route.fulfill({ path:file }) : route.fulfill({ status:404, body:'' });
    }

    if (url.pathname === '/icons/favicon-32.png') return route.fulfill({ status:204, body:'' });
    if (url.pathname === '/api/auth/me') return route.fulfill({ contentType:'application/json', body:JSON.stringify({ id:'layout-admin', role:'admin' }) });
    if (url.pathname === '/api/admin/dashboard/context') return route.fulfill({ contentType:'application/json', body:JSON.stringify(context) });
    if (url.pathname === '/api/admin/dashboard/unified') return route.fulfill({ contentType:'application/json', body:JSON.stringify(pilotage) });
    if (url.pathname === '/api/admin/dashboard/commerce') return route.fulfill({ contentType:'application/json', body:JSON.stringify(commerce) });
    if (url.pathname === '/api/admin/dashboard/operations') return route.fulfill({ contentType:'application/json', body:JSON.stringify(operations) });
    if (url.pathname === '/api/admin/action-center') return route.fulfill({ contentType:'application/json', body:JSON.stringify(actionCenter) });

    return route.fulfill({ status:404, body:'' });
  });
}

async function geometry(page, pathname) {
  await page.goto(`${ORIGIN}${pathname}`);

  const actionCenterPage = pathname === '/admin/action-center';
  const root = actionCenterPage ? page.locator('.kmc-action-center') : page.locator('[data-dashboard-id]');
  await expect(root).toBeVisible();

  const hero = actionCenterPage
    ? root.locator(':scope > .kmc-workspace-header')
    : root.locator(':scope > [data-dashboard-role="hero"]');

  const attention = actionCenterPage
    ? root.locator(':scope > .kmc-metric-strip')
    : root.locator(':scope > [data-dashboard-role="attention"]');

  const primary = actionCenterPage
    ? root.locator(':scope > .kmc-section').first()
    : root.locator(':scope > [data-dashboard-role="primary"]');

  await expect(hero).toBeVisible();
  await expect(attention).toBeVisible();
  await expect(primary).toBeVisible();

  return page.evaluate(({ actionCenterPage }) => {
    const root = actionCenterPage
      ? document.querySelector('.kmc-action-center')
      : document.querySelector('[data-dashboard-id]');
    const hero = actionCenterPage
      ? root.querySelector(':scope > .kmc-workspace-header')
      : root.querySelector(':scope > [data-dashboard-role="hero"]');
    const attention = actionCenterPage
      ? root.querySelector(':scope > .kmc-metric-strip')
      : root.querySelector(':scope > [data-dashboard-role="attention"]');
    const primary = actionCenterPage
      ? root.querySelector(':scope > .kmc-section')
      : root.querySelector(':scope > [data-dashboard-role="primary"]');
    const market = document.querySelector('.kmc-admin-topbar .kmc-admin-market-select');
    const search = document.querySelector('.kmc-admin-search');
    const tabs = document.querySelector('.kmc-admin-domain-tabs');
    const topbar = document.querySelector('.kmc-admin-topbar');
    const hr = hero.getBoundingClientRect();
    const ar = attention.getBoundingClientRect();
    const pr = primary.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    const mr = market ? market.getBoundingClientRect() : null;
    const sr = search ? search.getBoundingClientRect() : null;
    const heroStyle = getComputedStyle(hero);
    const heroBefore = getComputedStyle(hero, '::before');
    const title = hero.querySelector('.kmc-dashboard-title, .kmc-workspace-title');
    const titleStyle = title ? getComputedStyle(title) : null;
    const tr = tabs ? tabs.getBoundingClientRect() : null;
    const topbarStyle = topbar ? getComputedStyle(topbar) : null;
    const tabsStyle = tabs ? getComputedStyle(tabs) : null;
    return {
      rootTop:rr.top,
      heroTop:hr.top,
      heroBottom:hr.bottom,
      heroHeight:hr.height,
      heroClientHeight:hero.clientHeight,
      heroScrollHeight:hero.scrollHeight,
      attentionTop:ar.top,
      attentionBottom:ar.bottom,
      primaryTop:pr.top,
      primaryBottom:pr.bottom,
      marketTop:mr && mr.top,
      marketBottom:mr && mr.bottom,
      searchTop:sr && sr.top,
      searchBottom:sr && sr.bottom,
      topbarPosition:topbarStyle && topbarStyle.position,
      tabsDisplay:tabsStyle && tabsStyle.display,
      tabsHeight:tr && tr.height,
      heroBackground:heroStyle.backgroundImage,
      heroBackgroundColor:heroStyle.backgroundColor,
      heroBorderColor:heroStyle.borderTopColor,
      heroBeforeBackground:heroBefore.backgroundImage,
      titleColor:titleStyle && titleStyle.color,
      horizontalOverflow:document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, { actionCenterPage });
}

test.describe('Layout Canon — conformité aux mocks approuvés', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width:1672, height:941 });
    await serve(page);
  });

  test('Pilotage, Action Center, Commerce et Operations parlent exactement la même grammaire', async ({ page }) => {
    const routes = ['/admin/pilotage','/admin/action-center','/admin/commerce','/admin/operations'];
    const measured = {};
    for (const route of routes) measured[route] = await geometry(page, route);

    const heroTops = routes.map(route => measured[route].heroTop);
    expect(Math.max(...heroTops) - Math.min(...heroTops)).toBeLessThanOrEqual(2);

    for (const route of routes) {
      const g = measured[route];
      expect(g.heroHeight).toBeCloseTo(150, 0);
      expect(g.heroScrollHeight).toBeLessThanOrEqual(g.heroClientHeight + 1);
      expect(g.attentionTop).toBeGreaterThanOrEqual(g.heroBottom + 9);
      expect(g.attentionTop).toBeLessThanOrEqual(g.heroBottom + 14);
      expect(g.primaryTop).toBeGreaterThan(g.attentionTop);
      expect(g.primaryTop).toBeLessThan(941);
      expect(g.horizontalOverflow).toBeLessThanOrEqual(1);
      expect(g.searchTop).not.toBeNull();
      expect(g.searchTop).toBeGreaterThanOrEqual(g.heroTop + 8);
      expect(g.searchBottom).toBeLessThanOrEqual(g.heroBottom - 8);
      expect(g.topbarPosition).toBe('absolute');
      expect(g.tabsDisplay === null || g.tabsDisplay === 'none' || g.tabsHeight === 0).toBe(true);
    }

    for (const route of ['/admin/pilotage','/admin/commerce','/admin/operations']) {
      const g = measured[route];
      expect(g.marketTop).not.toBeNull();
      expect(g.marketBottom).toBeLessThanOrEqual(g.heroBottom - 12);
      expect(g.marketTop).toBeGreaterThanOrEqual(g.heroTop + 12);
    }

    const illustrations = {
      '/admin/pilotage': 'pilotage-control-tower-hero-gold.svg',
      '/admin/commerce': 'commerce-hero-gold.svg',
      '/admin/action-center': 'action-center-hero-gold.svg',
      '/admin/operations': 'operations-logistics-hero-gold.svg',
    };

    for (const route of routes) {
      const g = measured[route];
      const image = g.heroBeforeBackground;
      expect(image).toContain(illustrations[route]);
      expect(g.titleColor).toBe('rgb(7, 26, 61)');
      expect(g.heroBorderColor).not.toBe('rgb(243, 215, 210)');
      expect(g.heroBackground).toContain('linear-gradient');
    }
  });

  test('recherche et marché restent à l\'intérieur du Hero sur écran large (cadre de page centré)', async ({ page }) => {
    await page.setViewportSize({ width: 2142, height: 760 });
    const heroFrames = [];
    for (const route of ['/admin/pilotage','/admin/action-center','/admin/commerce','/admin/operations']) {
      await page.goto(`${ORIGIN}${route}`);
      await page.waitForSelector('[data-dashboard-role="hero"]');
      heroFrames.push(await page.evaluate(() => {
        const b = document.querySelector('[data-dashboard-role="hero"]').getBoundingClientRect();
        return [Math.round(b.left), Math.round(b.right)];
      }));
    }
    // Même cadre de page centré sur les quatre écrans, quelle que soit la largeur de l'écran.
    for (const frame of heroFrames) expect(frame).toEqual(heroFrames[0]);
    for (const route of ['/admin/pilotage','/admin/commerce','/admin/operations']) {
      await page.goto(`${ORIGIN}${route}`);
      await page.waitForSelector('[data-dashboard-role="hero"]');
      const r = await page.evaluate(() => {
        const box = el => { const b = el.getBoundingClientRect(); return { left:b.left, right:b.right, top:b.top, bottom:b.bottom }; };
        return {
          hero: box(document.querySelector('[data-dashboard-role="hero"]')),
          search: box(document.querySelector('.kmc-admin-topbar .kmc-admin-search')),
          market: box(document.querySelector('.kmc-admin-topbar .kmc-admin-market-select')),
        };
      });
      for (const control of [r.search, r.market]) {
        expect(control.right).toBeLessThanOrEqual(r.hero.right - 8);
        expect(control.left).toBeGreaterThanOrEqual(r.hero.left);
        expect(control.top).toBeGreaterThanOrEqual(r.hero.top);
        expect(control.bottom).toBeLessThanOrEqual(r.hero.bottom);
      }
      expect(r.search.right).toBeLessThanOrEqual(r.market.left + 1);
    }
  });

  test('les quatre écrans produisent une capture de référence au même viewport', async ({ page }, testInfo) => {
    for (const route of ['/admin/pilotage','/admin/action-center','/admin/commerce','/admin/operations']) {
      await geometry(page, route);
      const name = route.split('/').filter(Boolean).pop();
      await page.screenshot({ path:testInfo.outputPath(`layout-canon-${name}-1672x941.png`), fullPage:false });
    }
  });
});
