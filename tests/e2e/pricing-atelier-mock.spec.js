/**
 * @e2e   pricing-atelier-mock.spec.js
 * @feature dashboard (espace « Atelier des prix », /admin/workspaces/pricing, marché Comores)
 * @brief Conformité au mock validé : titre, 4 KPI (valeur absente = « Indisponible », jamais 0 ni « null »),
 *        trois familles économiques en onglets (une seule visible), colonnes Valeur/Provenance avec unités,
 *        panneau secondaire fermé par défaut, aucun texte parasite, aucun débordement horizontal (desktop et mobile).
 *        API simulée avec réponses réelles rejouées : aucun serveur ni base requis.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pricing-atelier-km.json'), 'utf8'));
const ORIGIN = 'http://komerce.test';

const COMPONENTS = [
  { key: 'stripe_fee_pct', label: 'Frais Stripe', family: 'business', category: 'payment', unit: 'pct', default_value: 2.9, allocation_method: 'per_order', inherited: true, is_active: true },
  { key: 'cash_fee_kmf', label: 'Frais collecte cash', family: 'business', category: 'payment', unit: 'kmf_per_order', default_value: 500, allocation_method: 'per_order', inherited: false, is_active: true },
];

async function mount(page, { populated = false, autoMarket = false, posts = [] } = {}) {
  const market = populated ? { ...FX.market, cost_components: COMPONENTS } : FX.market;
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/admin/workspaces/pricing') return route.fulfill({ contentType: 'text/html', path: path.join(CANONICAL, 'index.html') });
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (route.request().method() === 'POST') { posts.push({ path: url.pathname, body: route.request().postDataJSON() }); return json({ ok: true }); }
    if (url.pathname === '/api/auth/me') return json(FX.auth_me);
    if (url.pathname === '/api/admin/dashboard/context') return json(autoMarket ? { ...FX.context, actor: { ...FX.context.actor, role: 'market_operator' }, access: { ...FX.context.access, mode: 'market', allowedMarkets: ['KM'], defaultMarket: 'KM', capabilities: ['pricing.read'] } } : FX.context);
    if (url.pathname === '/api/admin/workspaces/pricing') return json(FX.global);
    if (url.pathname === '/api/admin/workspaces/pricing/market/KM') return json(market);
    if (url.pathname === '/api/admin/workspaces/pricing/market/KM/decision') return json(FX.decision);
    if (url.pathname === '/api/admin/workspaces/pricing/market/KM/decision-policy/history') return json(FX.history);
    if (url.pathname === '/api/admin/workspaces/pricing/market/KM/corridor') return json(FX.corridor);
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${ORIGIN}/admin/workspaces/pricing`);
  if (!autoMarket) await page.locator('select').first().selectOption({ label: 'KM · Comores' });
  await expect(page.locator('[data-pricing-economic-cockpit]')).toBeVisible();
  // Lot A : la vue par défaut est « Vue économique » ; les familles de coûts vivent dans « Modèle de coûts ».
  if (populated) await page.locator('[data-atelier-view="costs"]').click();
}

for (const [name, viewport] of [['desktop', { width: 1536, height: 1024 }], ['mobile', { width: 390, height: 844 }]]) {
  test.describe(`Atelier des prix — ${name}`, () => {
    test.use({ viewport });

    test('titre, quatre KPI indisponibles sans zéro ni null, aucun texte parasite', async ({ page }) => {
      await mount(page);
      await expect(page.locator('h1')).toHaveText('Atelier des prix · Comores');
      const kpis = page.locator('.kmc-metric-card');
      await expect(kpis).toHaveCount(4);
      await expect(kpis.locator('.kmc-metric-label')).toHaveText(['Couverture réelle', 'Contribution reconnue', 'Structure à couvrir', 'Maturité']);
      await expect(kpis.locator('.kmc-metric-value')).toHaveText(['Indisponible', 'Indisponible', 'Indisponible', 'Indisponible']);
      const body = await page.locator('body').innerText();
      expect(body).not.toMatch(/\bnull\b|\bundefined\b|\\n/);
      expect(body).not.toContain('Ajouter un produit');
    });

    test('délégation mono-marché : le marché autorisé est chargé sans sélection manuelle, titre inclus (L1)', async ({ page }) => {
      await mount(page, { autoMarket: true });
      await expect(page.locator('h1')).toHaveText('Atelier des prix · Comores');
    });

    test('politique de marché absente : un seul avis neutre, aucun bouton ni code brut (L5)', async ({ page }) => {
      await mount(page);
      const notice = page.locator('[data-pricing-configuration-notice]');
      await expect(notice).toHaveCount(1);
      await expect(notice).toContainText('Les prix couvrant le CDR restent possibles');
      await expect(notice.locator('a, button')).toHaveCount(0);
      const body = await page.locator('body').innerText();
      expect(body).not.toMatch(/Voir la décision|Voir le gate|MARKET_DECISION_POLICY_REQUIRED/);
    });

    test('familles : onglets répartis sur la largeur du panneau actif', async ({ page }) => {
      await mount(page, { populated: true });
      if (viewport.width < 900) return; // mobile : défilement horizontal des onglets
      const tabs = page.locator('.kmc-cockpit-cost-tabs [role="tab"]');
      const widths = await tabs.evaluateAll(nodes => nodes.map(n => Math.round(n.getBoundingClientRect().width)));
      const card = await page.locator('.kmc-cockpit-cost-card:visible').evaluate(n => Math.round(n.getBoundingClientRect().width));
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2);
      expect(widths.reduce((a, b) => a + b, 0)).toBeGreaterThan(card * 0.9);
    });

    test('coûts variables : enregistrement automatique à la validation, valeur vide jamais enregistrée', async ({ page }) => {
      const posts = [];
      await mount(page, { populated: true, posts });
      await page.locator('[data-open-cost-detail="variable"]').click();
      const input = page.locator('[data-variable-cost-input="stripe_fee_pct"]');
      await input.fill('3.1');
      await input.blur();
      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0].path).toBe('/api/admin/workspaces/pricing/market/KM/cost-components/stripe_fee_pct/update');
      expect(posts[0].body).toMatchObject({ default_value: 3.1 });
      await input.fill('');
      await input.blur();
      await expect(page.locator('.kmc-structure-panel-error')).toBeVisible();
      expect(posts.length).toBe(1);
    });

    test('familles : navigation clavier (flèches, Home/End)', async ({ page }) => {
      await mount(page, { populated: true });
      const tabs = page.locator('.kmc-cockpit-cost-tabs [role="tab"]');
      await tabs.nth(0).focus();
      await page.keyboard.press('ArrowRight');
      await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('End');
      await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Home');
      await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    });

    test('trois familles en onglets : une seule visible, bascule au clic', async ({ page }) => {
      await mount(page, { populated: true });
      const tabs = page.locator('.kmc-cockpit-cost-tabs [role="tab"]');
      await expect(tabs).toHaveText(['Coûts variables', 'Charges fixes directes', 'Charges fixes mutualisées']);
      const visible = page.locator('.kmc-cockpit-cost-card:visible');
      await expect(visible).toHaveCount(1);
      await expect(visible).toHaveAttribute('data-cost-summary', 'variable');
      await tabs.nth(1).click();
      await expect(visible).toHaveAttribute('data-cost-summary', 'fixed-direct');
      await tabs.nth(2).click();
      await expect(visible).toHaveAttribute('data-cost-summary', 'fixed-mutualized');
      await tabs.nth(0).click();
      const cells = (await page.locator('.kmc-cockpit-cost-card.is-variable .kmc-cockpit-cell').allInnerTexts()).join('|');
      expect(cells).toContain('Valeur');
      expect(cells).toContain('Provenance');
      expect(cells).toContain('2,9 %');
      expect(cells).toContain('500 KMF/commande');
      expect(cells).toContain('Global hérité');
      expect(cells).toContain('Surcharge pays');
    });

    test('ancien portefeuille remplacé par la file « Produits à décider » et aucun débordement horizontal de la page', async ({ page }) => {
      await mount(page, { populated: true });
      await expect(page.locator('[data-cockpit-portfolio]')).toBeHidden();
      await expect(page.locator('[data-atelier-view="products"]')).toBeVisible();
      const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
      expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
    });
  });
}
