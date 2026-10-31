/**
 * @e2e   pricing-atelier-mock.spec.js
 * @feature dashboard (espace « Atelier des prix », /admin/workspaces/pricing, marché Comores)
 * @brief Conformité au mock validé : titre, 4 KPI (valeur absente = « Indisponible », jamais 0 ni « null »),
 *        trois cartes économiques comparables ou superposées, détail Valeur/Provenance avec unités,
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
      await expect(page.locator('h1')).toHaveText('Moteur économique · Comores');
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
      await expect(page.locator('h1')).toHaveText('Moteur économique · Comores');
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

    test('familles : trois cartes alignées en desktop, pile lisible en petit écran', async ({ page }) => {
      await mount(page, { populated: true });
      const costs = page.locator('.kmc-cockpit-costs');
      await expect(costs).toHaveAttribute('data-cost-layout', 'columns');
      const cards = page.locator('.kmc-economic-family-grid > .kmc-cockpit-cost-card');
      await expect(cards).toHaveCount(3);
      if (viewport.width >= 1100) {
        const xs = await cards.evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().x));
        expect(xs[0]).toBeLessThan(xs[1]);
        expect(xs[1]).toBeLessThan(xs[2]);
      } else {
        const xs = await cards.evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().x));
        expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(5);
      }
    });

    test('ligne variable : dernière valeur conservée, saisie explicite, refus du vide', async ({ page }) => {
      const posts = [];
      await mount(page, { populated: true, posts });
      await expect(page.locator('[data-cost-layout-button]')).toHaveCount(0);
      const row = page.locator('[data-inline-cost-row="stripe_fee_pct"]');
      await expect(row).toContainText('2,9 %');
      await row.locator('[data-edit-inline-cost]').click();
      await expect(row).toContainText('Valeur actuelle : 2,9 %');
      const input = row.locator('[data-inline-cost-value]');
      await expect(input).toHaveValue('2.9');
      await input.fill('');
      await row.locator('.kmc-inline-cost-save').click();
      await expect(row.locator('[data-inline-cost-message]')).toContainText('Valeur invalide');
      expect(posts).toHaveLength(0);
      await input.fill('3.1');
      await row.locator('.kmc-inline-cost-save').click();
      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0].path).toBe('/api/admin/workspaces/pricing/market/KM/cost-components/stripe_fee_pct/update');
      expect(posts[0].body).toMatchObject({ default_value: 3.1 });
    });

    test('trois familles fixes, le détail reste accessible sans bascule superposée', async ({ page }) => {
      await mount(page, { populated: true });
      const visible = page.locator('.kmc-economic-family-grid .kmc-cockpit-cost-card:visible');
      await expect(visible).toHaveCount(3);
      await expect(visible.nth(0)).toHaveAttribute('data-cost-summary', 'variable');
      await expect(visible.nth(1)).toHaveAttribute('data-cost-summary', 'fixed-direct');
      await expect(visible.nth(2)).toHaveAttribute('data-cost-summary', 'fixed-mutualized');
      await page.locator('.kmc-cockpit-cost-card.is-variable [data-expand-cost-family]').click();
      const cells = (await page.locator('.kmc-cockpit-cost-card.is-variable .kmc-cockpit-cell').allInnerTexts()).join('|');
      expect(cells).toContain('Valeur');
      expect(cells).toContain('Provenance');
      expect(cells).toContain('2,9 %');
      expect(cells).toContain('500 KMF/commande');
      await expect(page.locator('.kmc-cockpit-cost-card.is-variable .kmc-cockpit-cost-table')).toBeVisible();
      await page.locator('.kmc-cockpit-cost-card.is-variable [data-expand-cost-family]').click();
      await expect(page.locator('.kmc-cockpit-cost-card.is-variable .kmc-cockpit-cost-table')).toBeHidden();
    });

    test('ancien portefeuille remplacé par la file « Produits à décider » et aucun débordement horizontal de la page', async ({ page }) => {
      await mount(page, { populated: true });
      await expect(page.locator('[data-cockpit-portfolio]')).toBeHidden();
      await expect(page.locator('[data-atelier-view="costs"]')).toBeVisible();
      await expect(page.locator('[data-atelier-nav]')).toBeVisible();
      const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
      expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
    });
  });
}
