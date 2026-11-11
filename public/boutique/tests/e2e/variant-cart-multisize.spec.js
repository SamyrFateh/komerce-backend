/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */
/**
 * @komerce-arch-lite
 * @role          boutique-variant-cart-chromium-regression
 * @domain        boutique
 * @layer         test
 * @owner         public/boutique/tests/e2e/variant-cart-multisize.spec.js
 * @purpose       Reproduce multi-size SKU cart incident using real staging UI, no mocked APIs.
 * @impact-areas  product-modal, cart, sku-selection, checkout
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { BASE_URL, IS_REMOTE } = require('./helpers/boutique.helpers');

const TARGET = process.env.E2E_MULTI_VARIANT_PRODUCT_NAME || '';
const axis = (page, regex) => page.locator('#k-modal-variants [data-axis-key]')
  .filter({ has: page.locator('.k-vg-label-type').filter({ hasText: regex }) })
  .first();

test.describe('P0 variantes — parcours vrai Chromium desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.skip(!IS_REMOTE || !TARGET,
    'Campagne staging explicite : BASE_URL distant et E2E_MULTI_VARIANT_PRODUCT_NAME requis (un skip ne vaut pas PASS)');

  test('même produit en deux tailles : ajout, quantités isolées, libellés et persistance', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.locator('#k-search-input').fill(TARGET);
    const suggestion = page.locator('#k-search-dropdown .k-search-item').first();
    await expect(suggestion).toBeVisible({ timeout: 20000 });
    await suggestion.click();
    await expect(page.locator('#k-modal-variants [data-pdc5-root]')).toBeAttached();

    // L'axe couleur est optionnel dans la fiche ; l'axe taille est requis pour la campagne.
    const groups = page.locator('#k-modal-variants [data-axis-key]');
    const names = await groups.evaluateAll(nodes => nodes.map(n => n.dataset.axisKey));
    const colorKey = names.find(key => /couleur|color|coloris/i.test(key || ''));
    const sizeKey = names.find(key => /taille|size/i.test(key || ''));
    expect(sizeKey, 'Le produit de recette doit avoir un axe de tailles').toBeTruthy();

    const colorValues = colorKey
      ? await page.locator('#k-modal-variants [data-axis-key="' + colorKey + '"] button[data-option-value]')
          .evaluateAll(nodes => nodes.map(n => n.dataset.optionValue))
      : [null];

    let availableSizes = [];
    for (const color of colorValues) {
      if (color != null) {
        await page.locator('#k-modal-variants [data-axis-key="' + colorKey + '"] button[data-option-value]')
          .filter({ hasText: /^.*$/ }).first().waitFor();
        await page.locator('#k-modal-variants [data-axis-key="' + colorKey + '"] button[data-option-value="' + color + '"]').click();
      }
      availableSizes = await page.locator(
        '#k-modal-variants [data-axis-key="' + sizeKey + '"] button[data-option-state="AVAILABLE"]'
      ).evaluateAll(nodes => nodes.map(n => n.dataset.optionValue));
      if (availableSizes.length >= 2) break;
    }
    expect(availableSizes.length, 'Il faut deux tailles réellement vendables pour cette recette').toBeGreaterThanOrEqual(2);

    const [sizeA, sizeB] = availableSizes.includes('XL') && availableSizes.includes('M')
      ? ['XL', 'M'] : availableSizes.slice(0, 2);
    const sizeButton = value => page.locator(
      '#k-modal-variants [data-axis-key="' + sizeKey + '"] button[data-option-value="' + value + '"]'
    );
    const add = page.locator('#k-add-cart-btn');
    const rows = page.locator('#k-side-cart #k-sc-items .k-sc-item');

    await sizeButton(sizeA).click();
    await expect(add).toBeVisible();
    await expect(add).toBeEnabled();
    await add.click();
    await expect(rows).toHaveCount(1);

    await sizeButton(sizeB).click();
    await expect(add, 'Ajouter doit réapparaître pour une autre taille').toBeVisible();
    await expect(add).toBeEnabled();
    await add.click();
    await expect(rows).toHaveCount(2);

    const variants = await rows.locator('.k-sc-item-variant').allTextContents();
    expect(variants.some(t => t.includes(sizeA))).toBe(true);
    expect(variants.some(t => t.includes(sizeB))).toBe(true);

    // Desktop side-cart: newest row first. Les deux steppers ciblent des
    // indices de lignes panier distincts, jamais product.id uniquement.
    const qtyBefore = await rows.locator('.k-sc-item-stepper-qty').allTextContents();
    await rows.first().locator('.k-sc-step-plus').click();
    const qtyAfter = await rows.locator('.k-sc-item-stepper-qty').allTextContents();
    expect(Number(qtyAfter[0])).toBe(Number(qtyBefore[0]) + 1);
    expect(qtyAfter[1]).toBe(qtyBefore[1]);

    await page.screenshot({ path: 'test-results/sku-two-sizes-desktop.png' });
    await page.reload();
    await expect(rows).toHaveCount(2);
    const afterReload = await rows.locator('.k-sc-item-variant').allTextContents();
    expect(afterReload.some(t => t.includes(sizeA))).toBe(true);
    expect(afterReload.some(t => t.includes(sizeB))).toBe(true);
  });
});
