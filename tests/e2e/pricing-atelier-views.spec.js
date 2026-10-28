/**
 * @e2e   pricing-atelier-views.spec.js
 * @feature dashboard (Atelier des prix, /admin/workspaces/pricing, marché Comores) — lot UX A
 * @brief Trois entrées (Vue économique, Produits à décider, Modèle de coûts), file de travail à une action principale par ligne,
 *        dossier produit (sources, simulation, brouillon distinct de l'activation, sortie vers le Catalogue pays), états droits/erreur/vide,
 *        aucun débordement horizontal (desktop et mobile). API simulée : aucun serveur, aucune base, aucune écriture réelle.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pricing-atelier-km.json'), 'utf8'));
const ORIGIN = 'http://komerce.test';
const SHOTS = process.env.ATELIER_SHOTS_DIR || '';

const clone = value => JSON.parse(JSON.stringify(value));
const PRODUCTS = FX.market.simulation_products.slice(0, 6).map((product, index) => ({ ...product, name: `Produit ${index + 1}`, product_ref: `KPR-90000${index + 1}`, category: 'phones' }));
// 1 coût absent · 2 brouillon · 3 actif · 4 brouillon sous plancher · 5-6 à décider
function corridorFor(ref) {
  const index = PRODUCTS.findIndex(product => product.product_ref === ref);
  const data = clone(FX.corridor);
  data.product = { ...data.product, product_ref: ref, name: PRODUCTS[index].name, purchase_cost_kmf: 7000 };
  if (index === 0) data.product.purchase_cost_kmf = 0;
  if (index === 1) data.candidate = { amount: 30000, currency: 'KMF', price_kmf: 30000, status: 'LOCAL_DRAFT', buyer_effective: false, economics: data.selected.economics };
  if (index === 2) data.selected = { ...data.selected, source: 'LOCAL_ACTIVE', buyer_effective: true, local_amount: 30000, local_currency: 'KMF', price_kmf: 30000 };
  if (index === 3) data.candidate = { amount: 9000, currency: 'KMF', price_kmf: 9000, status: 'LOCAL_DRAFT', buyer_effective: false, economics: data.selected.economics };
  if (index === 1) data.corridor.local = { ...data.corridor.local, sample_count: 1, low: { observed_amount: 28000, currency: 'KMF' }, target: { observed_amount: 28000, currency: 'KMF' }, high: { observed_amount: 28000, currency: 'KMF' }, observations: [{ competitor_name: 'Boutique Moroni', observed_amount: 28000, currency: 'KMF', observed_at: '2026-10-20T08:00:00Z', source: 'relevé terrain' }] };
  return data;
}
const COMPONENTS = [
  { key: 'stripe_fee_pct', label: 'Frais Stripe', family: 'business', category: 'payment', unit: 'pct', default_value: 2.9, allocation_method: 'per_order', inherited: true, is_active: true },
  { key: 'cash_fee_kmf', label: 'Frais collecte cash', family: 'business', category: 'payment', unit: 'kmf_per_order', default_value: 500, allocation_method: 'per_order', inherited: false, is_active: true },
  { key: 'freight_kg', label: 'Fret maritime', family: 'landed_relay', category: 'freight', unit: 'kmf_per_kg', default_value: null, allocation_method: 'by_weight', inherited: true, is_active: true },
];

async function mount(page, { caps = {}, posts = [], search = '', components = COMPONENTS, corridorStatus = 200, preview = null } = {}) {
  const market = { ...FX.market, simulation_products: PRODUCTS, cost_components: components, capabilities: { ...FX.market.capabilities, ...caps } };
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/admin/workspaces/pricing') return route.fulfill({ contentType: 'text/html', path: path.join(CANONICAL, 'index.html') });
    if (url.pathname.startsWith('/dashboards/canonical/')) {
      const file = path.join(CANONICAL, url.pathname.replace('/dashboards/canonical/', ''));
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    }
    if (route.request().method() === 'POST') {
      posts.push({ path: url.pathname, body: route.request().postDataJSON() });
      if (url.pathname.endsWith('/simulate-impact')) return json({ baseline: { metrics: { minimum_safe_price_kmf: 17990, recommended_price_kmf: 26990 } }, scenario: { metrics: { minimum_safe_price_kmf: 18500, recommended_price_kmf: 27600 } }, delta: { minimum_safe_price_kmf: 510, recommended_price_kmf: 610 }, persisted: false });
      return json({ ok: true });
    }
    if (url.pathname === '/api/auth/me') return json(FX.auth_me);
    if (url.pathname === '/api/admin/dashboard/context') return json(FX.context);
    if (url.pathname === '/api/admin/workspaces/pricing/market/KM') return json(market);
    if (url.pathname === '/api/admin/workspaces/pricing/market/KM/decision') return json(FX.decision);
    if (url.pathname === '/api/admin/workspaces/pricing/market/KM/decision-policy/history') return json(FX.history);
    if (url.pathname === '/api/admin/workspaces/pricing/market/KM/corridor') {
      if (corridorStatus !== 200) return json({ error: 'Corridor indisponible' }, corridorStatus);
      return json(corridorFor(url.searchParams.get('product_ref')));
    }
    if (url.pathname.endsWith('/local-price/activation-preview')) return json(preview || { activation: { allowed: false, reason: 'Politique de marché requise pour ce prix.' } });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${ORIGIN}/admin/workspaces/pricing${search}`);
  if (!/market=KM/.test(search)) await page.locator('select').first().selectOption({ label: 'KM · Comores' });
  await expect(page.locator('[data-atelier-nav]')).toBeVisible();
}

const shot = async (page, name, viewport) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}-${viewport}.png`), fullPage: true }); };
const noOverflow = async (page) => {
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
};

for (const [name, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
  test.describe(`Atelier des prix · lot A — ${name}`, () => {
    test.use({ viewport });

    test('trois entrées, Vue économique par défaut : KPI et priorités, rien d’autre', async ({ page }) => {
      await mount(page);
      await expect(page.locator('[data-atelier-nav] [role="tab"]')).toHaveText(['Vue économique', 'Produits à décider', 'Modèle de coûts'].map(label => new RegExp(`^${label}`)));
      await expect(page.locator('[data-atelier-nav] [aria-selected="true"]')).toContainText('Vue économique');
      await expect(page.locator('.kmc-metric-card')).toHaveCount(4);
      await expect(page.locator('[data-atelier-priorities]')).toBeVisible();
      await expect(page.locator('[data-atelier-priorities]')).toContainText('1 ligne du modèle de coûts sans valeur');
      await expect(page.locator('[data-atelier-priorities]')).toContainText('1 produit sans coût d’achat');
      await expect(page.locator('[data-atelier-priorities]')).toContainText('1 produit sous le plancher moteur');
      await expect(page.locator('[data-atelier-priorities]')).toContainText('Couverture non décisionnelle');
      await expect(page.locator('[data-atelier-products]')).toBeHidden();
      await expect(page.locator('.kmc-cockpit-costs')).toBeHidden();
      await expect(page.locator('[data-cockpit-portfolio]')).toBeHidden();
      await expect(page.locator('[data-atelier-priorities] input, [data-atelier-priorities] form')).toHaveCount(0);
      const body = await page.locator('body').innerText();
      expect(body).not.toMatch(/\bnull\b|\bundefined\b|NaN/);
      await noOverflow(page);
      await shot(page, '1-vue-economique', name);
    });

    test('Produits à décider : file triée par urgence, une action principale par ligne', async ({ page }) => {
      await mount(page);
      await page.locator('[data-atelier-view="products"]').click();
      const rows = page.locator('[data-atelier-queue] .kmc-atelier-row:not(.is-head)');
      await expect(rows).toHaveCount(5); // le produit actif n'est pas « à traiter »
      await expect(rows.first()).toHaveAttribute('data-state', 'cost_missing');
      await expect(rows.nth(1)).toHaveAttribute('data-state', 'under_floor');
      await expect(rows.first().locator('.kmc-atelier-primary')).toHaveText('Compléter le coût');
      await expect(rows.first()).toContainText('MANQUANT');
      for (let i = 0; i < 5; i += 1) await expect(rows.nth(i).locator('.kmc-atelier-primary')).toHaveCount(1);
      await expect(page).toHaveURL(/view=products/);
      await page.locator('[data-atelier-filter-chip="active"]').click();
      await expect(rows).toHaveCount(1);
      await page.locator('[data-atelier-search]').fill('introuvable');
      await expect(page.locator('.kmc-atelier-empty')).toContainText('Aucun produit ne correspond');
      await noOverflow(page);
      await page.locator('[data-atelier-search]').fill('');
      await page.locator('[data-atelier-filter-chip="todo"]').click();
      await shot(page, '2-produits-a-decider', name);
    });

    test('dossier : sources à gauche, décision à droite, brouillon distinct de l’activation, sortie Catalogue pays', async ({ page }) => {
      const posts = [];
      await mount(page, { caps: { local_price_drafts: true, simulation: true, manage_market_price_observations: true }, posts });
      await page.locator('[data-atelier-view="products"]').click();
      await page.locator('[data-product-ref="KPR-900002"] [data-atelier-open]').click();
      const dossier = page.locator('[data-atelier-dossier="KPR-900002"]');
      await expect(dossier).toBeVisible();
      await expect(page).toHaveURL(/product_ref=KPR-900002/);
      await expect(dossier.locator('[data-atelier-sources]')).toContainText('Boutique Moroni');
      await expect(dossier.locator('[data-atelier-decision]')).toContainText('Plancher moteur');
      await expect(dossier.locator('[data-atelier-verdict]')).toContainText('Activation refusée par le serveur');
      await expect(dossier.locator('[data-atelier-verdict]')).toContainText('Politique de marché requise');
      // aucun bouton d'activation dans l'Atelier : le geste final est dans le Catalogue pays
      await expect(dossier.getByRole('button', { name: /activer/i })).toHaveCount(0);
      const link = dossier.locator('[data-atelier-catalogue]');
      await expect(link).toHaveText('Activer dans le Catalogue pays →');
      const href = await link.getAttribute('href');
      expect(href).toContain('/dashboards/canonical/market-catalog.html?market=KM&product_ref=KPR-900002');
      expect(href).toContain('return_to=');
      await shot(page, '3-dossier-produit', name);
      // simulation : lecture seule, aucune écriture de prix
      await dossier.locator('details.kmc-atelier-sim > summary').click();
      await dossier.locator('[data-atelier-sim-form] select[name="key"]').selectOption('cash_fee_kmf');
      await dossier.locator('[data-atelier-sim-form] input[name="value"]').fill('600');
      await dossier.locator('[data-atelier-sim-form] button[type="submit"]').click();
      await expect(dossier.locator('[data-atelier-sim-result]')).toContainText('Aucune donnée n’est enregistrée');
      expect(posts.map(post => post.path)).toEqual(['/api/admin/workspaces/pricing/market/KM/simulate-impact']);
      expect(posts[0].body.overrides).toEqual([{ key: 'cash_fee_kmf', default_value: 600 }]);
      // brouillon : étape explicite, jamais d'activation
      await dossier.locator('[data-atelier-draft-form] input[name="amount"]').fill('31000');
      await dossier.locator('[data-atelier-draft-form] button[type="submit"]').click();
      await expect(page.locator('[data-atelier-feedback]')).toContainText('Brouillon enregistré');
      expect(posts.map(post => post.path)).toEqual([
        '/api/admin/workspaces/pricing/market/KM/simulate-impact',
        '/api/admin/workspaces/pricing/market/KM/products/KPR-900002/local-price',
      ]);
      expect(posts[1].body).toMatchObject({ amount: 31000, source: 'atelier_dossier' });
      expect(posts.some(post => /\/activate$/.test(post.path))).toBe(false);
      // observation sourcée
      await page.locator('[data-atelier-observation-form] input[name="competitor_name"]').fill('Boutique Mitsamiouli');
      await page.locator('[data-atelier-observation-form] input[name="amount"]').fill('29000');
      await page.locator('[data-atelier-observation-form] input[name="source"]').fill('relevé terrain');
      await page.locator('[data-atelier-observation-form] button[type="submit"]').click();
      await expect(page.locator('[data-atelier-feedback]')).toContainText('Observation enregistrée');
      expect(posts[2]).toMatchObject({ path: '/api/admin/workspaces/pricing/market/KM/price-observations', body: { product_ref: 'KPR-900002', competitor_name: 'Boutique Mitsamiouli', amount: 29000, source: 'relevé terrain' } });
      await noOverflow(page);
      await page.locator('[data-atelier-back]').click();
      await expect(page.locator('[data-atelier-queue]')).toBeVisible();
      await expect(page).not.toHaveURL(/product_ref=/);
    });

    test('sans droit de décision : simulation lisible, aucun formulaire de prix ni d’observation', async ({ page }) => {
      await mount(page, { search: '?market=KM&product_ref=KPR-900005' });
      await expect(page.locator('[data-atelier-dossier="KPR-900005"]')).toBeVisible();
      await expect(page.locator('[data-atelier-nav] [aria-selected="true"]')).toContainText('Produits à décider');
      await expect(page.locator('[data-atelier-draft-form], [data-atelier-observation-form]')).toHaveCount(0);
      await expect(page.locator('[data-atelier-sim-form]')).toHaveCount(1);
      await expect(page.locator('[data-atelier-decision]')).toContainText('Droit pricing.decide absent');
      await expect(page.locator('[data-atelier-decision]')).toContainText('Enregistrez d’abord un prix pays en brouillon');
      await expect(page.locator('[data-atelier-catalogue]')).toHaveCount(0);
    });

    test('coût absent : décision bloquée, aucun prix proposé, renvoi vers la fiche produit', async ({ page }) => {
      await mount(page, { caps: { local_price_drafts: true, simulation: true }, search: '?market=KM&product_ref=KPR-900001' });
      const decision = page.locator('[data-atelier-decision]');
      await expect(decision).toContainText('Décision bloquée');
      await expect(decision).toContainText('Indisponible');
      await expect(page.locator('[data-atelier-draft-form], [data-atelier-sim-form]')).toHaveCount(0);
    });

    test('Modèle de coûts : familles en onglets, propriétaire des coûts', async ({ page }) => {
      await mount(page);
      await page.locator('[data-atelier-view="costs"]').click();
      await expect(page).toHaveURL(/view=costs/);
      await expect(page.locator('.kmc-cockpit-costs')).toBeVisible();
      await expect(page.locator('[data-atelier-products]')).toBeHidden();
      await expect(page.locator('.kmc-metric-card').first()).toBeHidden();
      const tabs = page.locator('.kmc-cockpit-cost-tabs [role="tab"]');
      await expect(tabs).toHaveText(['Coûts variables', 'Charges fixes directes', 'Charges fixes mutualisées']);
      await noOverflow(page);
      await shot(page, '4-modele-de-couts', name);
    });

    test('priorité → file filtrée, retour conservé dans l’URL', async ({ page }) => {
      await mount(page);
      await page.locator('[data-atelier-go="products"][data-atelier-filter="under_floor"]').click();
      await expect(page.locator('[data-atelier-queue] .kmc-atelier-row:not(.is-head)')).toHaveCount(1);
      await expect(page.locator('[data-atelier-filter-chip="under_floor"]')).toHaveAttribute('aria-pressed', 'true');
    });

    test('erreur serveur : message explicite par ligne, aucune valeur inventée', async ({ page }) => {
      await mount(page, { corridorStatus: 500 });
      await page.locator('[data-atelier-view="products"]').click();
      await expect(page.locator('.kmc-atelier-alert-inline').first()).toContainText('Indisponible');
      await expect(page.locator('[data-atelier-priorities]')).not.toContainText('produit sans');
    });
  });
}
