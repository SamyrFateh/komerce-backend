/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   golden-product-gpm.spec.js
 * @feature modal-product, catalog
 * @brief Chantier GOLDEN PRODUCT — modal mobile enrichie (GPM-2, GPM-3 DOM,
 *        GPM-4 régression CTA/prix, GPM-6 captures multi-résolutions).
 *
 * Prérequis avant exécution :
 *   1. node scripts/seed-golden-product.js   (contre une vraie DATABASE_URL)
 *   2. serveur applicatif démarré (npm run start / npm run dev)
 *   3. npx playwright test tests/e2e/golden-product-gpm.spec.js
 *      (depuis public/boutique/ — c'est le testDir réel de playwright.config.js)
 *
 * NON EXÉCUTÉ dans l'environnement où ce fichier a été écrit (pas de
 * serveur ni de PostgreSQL disponibles dans ce bac à sable). Écrit en
 * réutilisant exactement les helpers et sélecteurs déjà en place dans
 * tests/e2e/product-detail-pdc.spec.js, tests/e2e/search.spec.js et
 * tests/e2e/helpers/boutique.helpers.js — aucun sélecteur inventé.
 *
 * GPM-3 DOM : les 6 scénarios A-F rejouent au niveau DOM ce que
 * public/boutique/tests/unit/golden-product-selection-gpm3.test.js verrouille
 * déjà au niveau reducer (selectModalOption). Scénarios B/C/D/F écrits en
 * premier ; A et E ajoutés ici pour la parité complète A-F.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const {
  BASE_URL,
  waitForModalOpen,
  closeModal,
} = require('./helpers/boutique.helpers');

// Source canonique unique du Golden Product (racine du repo) — mêmes
// scénarios que GPM-1/GPM-3, aucune donnée redéfinie ici.
const golden = require('../../../../tests/fixtures/catalog/golden-elite-pro');

const MOBILE_VIEWPORTS = [
  { name: '320x568', width: 320, height: 568 },
  { name: '360x740', width: 360, height: 740 },
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
  { name: '430x932', width: 430, height: 932 },
];

const SCREENSHOT_DIR = path.join(__dirname, '..', '..', 'docs', '_work', 'gpm6-screenshots');

function optionSelector(axisKey, value) {
  return `[data-axis-key="${axisKey}"] button[data-option-value="${value}"]`;
}

/** Ouvre le Golden Product via la recherche réelle (pas un fetch direct). */
async function openGoldenProduct(page) {
  await page.goto(BASE_URL);
  const input = page.locator('#k-search-input');
  const dropdown = page.locator('#k-search-dropdown');

  await input.fill('Elite Pro');
  await expect(dropdown).toHaveClass(/open/, { timeout: 5_000 });
  await dropdown.locator('.k-search-item').first().click();
  await waitForModalOpen(page);

  await expect(page.locator('#k-modal-name')).toHaveText(golden.productRow().name);
}

async function selectColorAndSize(page, couleur, taille) {
  if (couleur) {
    await page.locator(optionSelector('Couleur', couleur)).click();
  }
  if (taille) {
    await page.locator(optionSelector('Taille', taille)).click();
  }
}

/**
 * GPM-4 — mesure exacte demandée par la doctrine du chantier :
 *   actionsStyle.position === "static"
 *   priceRect.bottom <= scrollRect.bottom
 *   priceRect.bottom <= actionsRect.top
 * Lue depuis le style calculé réel, jamais déduite du DOM parent.
 */
async function assertPriceNeverClipped(page) {
  const measurements = await page.evaluate(() => {
    const actions = document.querySelector('.k-modal-actions');
    const price = document.getElementById('k-modal-price');
    const scroll = document.querySelector('.k-modal-scroll');
    if (!actions || !price || !scroll) return null;

    const actionsStyle = getComputedStyle(actions);
    const priceRect = price.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();

    return {
      position: actionsStyle.position,
      priceBottom: priceRect.bottom,
      scrollBottom: scrollRect.bottom,
      actionsTop: actionsRect.top,
    };
  });

  expect(measurements, '.k-modal-actions / #k-modal-price / .k-modal-scroll introuvables').not.toBeNull();
  expect(measurements.position).toBe('static');
  expect(measurements.priceBottom).toBeLessThanOrEqual(measurements.scrollBottom);
  expect(measurements.priceBottom).toBeLessThanOrEqual(measurements.actionsTop);
}

test.describe('GPM — Golden Product mobile enrichi', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('GPM-2 — ouverture réelle depuis le catalogue, composition mobile complète', async ({ page }) => {
    await openGoldenProduct(page);

    // Identité
    await expect(page.locator('#k-modal-name')).toHaveText(golden.productRow().name);
    await expect(page.locator('#k-modal-price')).not.toBeEmpty();

    // Axes SKU présents
    await expect(page.locator('[data-axis-key="Couleur"]')).toBeVisible();
    await expect(page.locator('[data-axis-key="Taille"]')).toBeVisible();

    // Info strip : livraison depuis delivery_options[], jamais en dur
    // (n'affiche que ce que le contrat fournit — cf. écart documenté GPM-1 :
    // un seul rail réel aujourd'hui, "Livraison standard").
    await expect(page.locator('.k-mdm-chip--delivery')).toContainText('Livraison standard');

    // CTA verrouillées tant qu'aucun SKU complet n'est résolu
    await expect(page.locator('#k-add-cart-btn')).toBeDisabled();
    await expect(page.locator('#k-buy-now-btn')).toBeDisabled();

    await closeModal(page);
  });

  test('GPM-3 (DOM) — Scénario A : Bleu seul → 43 en rupture visible, CTA toujours verrouillées', async ({ page }) => {
    await openGoldenProduct(page);
    await selectColorAndSize(page, 'Bleu', null);

    // Couleur retenue, mais aucune taille : le reducer refuse tout SKU
    // tant que l'axe Taille n'est pas résolu (miroir du scénario A unitaire).
    await expect(page.locator(optionSelector('Couleur', 'Bleu'))).toHaveAttribute('aria-pressed', 'true');

    // 42 et 44 restent AVAILABLE, 43 est en rupture réelle (stock 0 dans le
    // fixture) — visible et cliquable pour message contextuel, jamais retiré.
    await expect(page.locator(optionSelector('Taille', '42'))).toHaveAttribute('data-option-state', 'AVAILABLE');
    await expect(page.locator(optionSelector('Taille', '43'))).toHaveAttribute('data-option-state', 'OUT_OF_STOCK');
    await expect(page.locator(optionSelector('Taille', '44'))).toHaveAttribute('data-option-state', 'AVAILABLE');

    await expect(page.locator('#k-add-cart-btn')).toBeDisabled();
    await expect(page.locator('#k-buy-now-btn')).toBeDisabled();

    await closeModal(page);
  });

  test('GPM-3 (DOM) — Scénario B : Bleu + 42 → SKU dispo, CTA actives, prix 42 000 KMF', async ({ page }) => {
    await openGoldenProduct(page);
    await selectColorAndSize(page, 'Bleu', '42');

    await expect(page.locator('#k-modal-price')).toContainText('42 000');
    await expect(page.locator('#k-add-cart-btn')).toBeEnabled();
    await expect(page.locator('#k-buy-now-btn')).toBeEnabled();
    await expect(page.locator('#k-modal-selection-message')).toBeHidden();

    await closeModal(page);
  });

  test('GPM-3 (DOM) — Scénario C : Bleu + 43 → rupture, CTA verrouillées, message explicite', async ({ page }) => {
    await openGoldenProduct(page);
    await selectColorAndSize(page, 'Bleu', '43');

    await expect(page.locator('#k-add-cart-btn')).toBeDisabled();
    await expect(page.locator('#k-buy-now-btn')).toBeDisabled();
    await expect(page.locator('#k-modal-selection-message')).toContainText(/rupture/i);

    await closeModal(page);
  });

  test('GPM-3 (DOM) — Scénario D : Bleu + 44 → palier de prix différent (45 000 KMF)', async ({ page }) => {
    await openGoldenProduct(page);
    await selectColorAndSize(page, 'Bleu', '44');

    await expect(page.locator('#k-modal-price')).toContainText('45 000');
    await expect(page.locator('#k-add-cart-btn')).toBeEnabled();

    await closeModal(page);
  });

  test('GPM-3 (DOM) — Scénario E : Noir + 43 → SKU dispo, CTA actives, prix 43 000 KMF', async ({ page }) => {
    await openGoldenProduct(page);
    await selectColorAndSize(page, 'Noir', '43');

    await expect(page.locator('#k-modal-price')).toContainText('43 000');
    await expect(page.locator('#k-add-cart-btn')).toBeEnabled();
    await expect(page.locator('#k-buy-now-btn')).toBeEnabled();
    await expect(page.locator('#k-modal-selection-message')).toBeHidden();

    await closeModal(page);
  });

  test('GPM-3 (DOM) — Scénario F : Noir + 44 → combinaison inexistante, jamais de faux SKU', async ({ page }) => {
    await openGoldenProduct(page);
    await page.locator(optionSelector('Couleur', 'Noir')).click();

    const size44 = page.locator(optionSelector('Taille', '44'));
    await expect(size44).toHaveAttribute('data-option-state', 'INCOMPATIBLE');
    await size44.click();

    await expect(page.locator('#k-add-cart-btn')).toBeDisabled();
    await expect(page.locator('#k-modal-selection-message')).toContainText(/non proposée|combinaison/i);

    await closeModal(page);
  });

  test('GPM-4 — le prix n’est jamais peint sous la barre CTA (titre long + prix le plus long)', async ({ page }) => {
    await openGoldenProduct(page);
    // Sélection au prix le plus long de la table (45 000 KMF, Bleu 44) —
    // c'est le cas le plus défavorable pour la largeur du bloc prix.
    await selectColorAndSize(page, 'Bleu', '44');
    await assertPriceNeverClipped(page);
    await closeModal(page);
  });

  test('GPM-7 — resize 390 → 1280 → 390 conserve sélection, SKU, prix, média, zéro refetch', async ({ page }) => {
    let detailFetchCount = 0;
    page.on('request', (req) => {
      if (req.url().includes('/detail')) detailFetchCount += 1;
    });

    await openGoldenProduct(page);
    await selectColorAndSize(page, 'Noir', '43');
    await expect(page.locator('#k-modal-price')).toContainText('43 000');

    const fetchesAfterSelection = detailFetchCount;

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(200); // laisse syncResponsiveComposition() tourner (debounce 120ms)
    await expect(page.locator('#k-modal-price')).toContainText('43 000');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    await expect(page.locator('#k-modal-price')).toContainText('43 000');

    expect(detailFetchCount).toBe(fetchesAfterSelection); // zéro second fetch /detail

    await closeModal(page);
  });
});

test.describe('GPM-6 — captures visuelles mobile (5 résolutions × 8 états)', () => {
  for (const viewport of MOBILE_VIEWPORTS) {
    test(`captures @ ${viewport.name}`, async ({ page }) => {
      test.skip(!process.env.GPM6_SCREENSHOTS, 'Activer avec GPM6_SCREENSHOTS=1 (génère des fichiers, hors run CI standard)');

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

      const shot = async (name) => {
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `${viewport.name}__${name}.png`),
          fullPage: false,
        });
      };

      await openGoldenProduct(page);
      await shot('01-ouverture-initiale');

      await selectColorAndSize(page, 'Bleu', '42');
      await shot('02-bleu-42-disponible');

      await selectColorAndSize(page, 'Bleu', '43');
      await shot('03-bleu-43-rupture');

      await selectColorAndSize(page, 'Bleu', '44');
      await shot('04-bleu-44-prix-different');

      await selectColorAndSize(page, 'Noir', '43');
      await shot('05-noir-43-disponible');

      await page.locator(optionSelector('Couleur', 'Noir')).click();
      await page.locator(optionSelector('Taille', '44')).click();
      await shot('06-noir-44-incompatible');

      await page.locator('.k-mdm-fold').scrollIntoViewIfNeeded();
      await shot('07-livraison-et-editorial');

      // État le plus compact : titre + prix le plus long doivent rester
      // entièrement visibles (cf. GPM-4).
      await selectColorAndSize(page, 'Bleu', '44');
      await shot('08-compact-titre-long-prix-visible');

      await closeModal(page);
    });
  }
});
