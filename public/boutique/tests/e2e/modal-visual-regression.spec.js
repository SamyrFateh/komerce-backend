/**
 * @e2e   modal-visual-regression.spec.js
 * @feature modal-product, mobile-canonical
 * @brief Volet 3.3 — régression visuelle des 4 états de la modale produit
 *        (cf. docs/reference/reference-modale-4-etats.html) : desktop
 *        non-enrichi, desktop enrichi, mobile non-enrichi, mobile enrichi.
 *
 * Données 100% déterministes (mêmes fixtures que le volet 3.2, dérivées du
 * contrat golden réel via geometry-fixtures.js) — aucune image/texte
 * dépendant du catalogue live, condition nécessaire pour qu'un diff de
 * pixels signifie une régression de code/CSS et non un aléa de données.
 *
 * ATTENTION PORTABILITÉ : les baselines PNG committées ont été générées
 * dans l'environnement du contributeur (Linux/Chromium headless). Le
 * rendu des fontes peut varier légèrement d'un OS à l'autre — si ce spec
 * échoue en CI sur un diff mineur et homogène (anti-aliasing), régénérer
 * les baselines DEPUIS LE RUNNER CI (`--update-snapshots` dans le même
 * job), pas localement. maxDiffPixelRatio (voir playwright.config.js)
 * absorbe les écarts de sous-pixel, pas un vrai changement de layout.
 *
 * Projet dédié "Chromium Visual" (comme MDM-9) : évite la multiplication
 * ×5 navigateurs — ces captures n'ont de sens que sur un rendu Chromium
 * de référence unique.
 *
 * PÉRIMÈTRE MESURÉ (pas supposé) : #k-modal est un overlay à hauteur fixe
 * (viewport) avec défilement interne (.k-modal-scroll) — screenshot d'un
 * locator capture le rendu tel quel, PAS le scrollHeight complet. Ces 4
 * captures verrouillent donc l'état initial (au chargement, sans scroll),
 * pas le contenu qui n'apparaît qu'après défilement (ex. partage/WhatsApp
 * sur le produit enrichi mobile, rendu hors-champ dans cet état initial).
 * Le contenu défilé (image sticky, non-régression overflow) est déjà
 * couvert par des assertions dédiées dans modal-geometry.spec.js (volet
 * 3.2) — pas dupliqué ici en pixel-diff, plus fragile pour ce cas.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { buildSimpleFixture, buildEnrichedFixture } = require('./helpers/geometry-fixtures');
const { IS_REMOTE } = require('./helpers/boutique.helpers');

// Les baselines PNG n'ont de sens que contre le rendu LOCAL déterministe
// (fixtures stubbées) — en DISTANT (BASE_URL), le catalogue/CSS servis
// peuvent différer de la version locale en cours de dev : skip plutôt que
// faux positif.
test.skip(IS_REMOTE, 'Régression visuelle réservée au mode LOCAL (données déterministes).');

const LIST_PRODUCT = (detail) => ({
  id: detail.product.id,
  name: detail.product.name,
  price_kmf: detail.pricing.price_kmf,
  description: detail.product.description || '',
  images: (detail.media || []).map((m) => m.url),
  image_url: (detail.media || [])[0]?.url || '',
  category: detail.product.category || 'sport',
  is_available: true,
  stock: 12,
  inventory_model: detail.inventory_model,
});

async function stubApi(page, detail) {
  const sp = LIST_PRODUCT(detail);
  await page.route(/\/api\//, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '[]',
  }));
  await page.route(/\/api\/boutique\/suggestions/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: [] }),
  }));
  await page.route(/\/api\/products(\?|$)/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([sp]),
  }));
  await page.route(/\/api\/products\/[^/]+\/detail/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(detail),
  }));
  return sp;
}

async function openModalFor(page, detail) {
  const sp = await stubApi(page, detail);
  await page.goto('/boutique/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window._kbus && window._kstate, null, { timeout: 8000 });
  await page.evaluate((sp) => {
    if (!window._kstate.products.find((x) => String(x.id) === String(sp.id))) {
      window._kstate.products.push(sp);
    }
    window._kbus.emit('modal:open', { id: sp.id });
  }, sp);
  await page.waitForSelector('#k-modal', { state: 'visible', timeout: 6000 });
  await page.waitForFunction(() => !!document.querySelector('.k-modal-scroll'), null, { timeout: 6000 });
  // Images de fixture = SVG statiques (pas de latence réseau réelle),
  // mais on attend explicitement l'animation d'ouverture + le render PDC
  // asynchrone avant de capturer, comme pour le volet 3.2.
  await page.waitForTimeout(400);
}

test.describe('Modale produit — régression visuelle 4 états (volet 3.3)', () => {
  test('desktop ≥1024px — produit non-enrichi', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openModalFor(page, buildSimpleFixture());
    await expect(page.locator('#k-modal')).toHaveScreenshot('modal-desktop-simple.png');
  });

  test('desktop ≥1024px — produit enrichi', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openModalFor(page, buildEnrichedFixture());
    await expect(page.locator('#k-modal')).toHaveScreenshot('modal-desktop-enrichi.png');
  });

  test('mobile ≤390px — produit non-enrichi', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openModalFor(page, buildSimpleFixture());
    await expect(page.locator('#k-modal')).toHaveScreenshot('modal-mobile-simple.png');
  });

  test('mobile ≤390px — produit enrichi', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openModalFor(page, buildEnrichedFixture());
    await expect(page.locator('#k-modal')).toHaveScreenshot('modal-mobile-enrichi.png');
  });
});
