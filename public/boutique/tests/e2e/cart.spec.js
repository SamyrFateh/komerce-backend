/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   cart.spec.js
 * @feature cart
 * @brief Panier : ajout depuis modale, badge, drawer, quantités, suppression
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, waitForGrid, openFirstCard, addToCartFromModal,
  closeModal, openCartDrawer, getCartItems, cardCount,
  IS_REMOTE,
} = require('./helpers/boutique.helpers');

test.describe('E-CART — Panier', () => {
  // Ces flows nécessitent un catalogue réel (données produit du backend) :
  // indisponibles en mode LOCAL (npx serve, sans API). Lancer avec BASE_URL distant.
  test.skip(!IS_REMOTE, 'Nécessite un catalogue réel (backend) — lancer avec BASE_URL distant');


  test('E3 — Ajout au panier → badge incrémenté + bouton in-cart', async ({ page }) => {
    await page.goto(BASE_URL);
    await openFirstCard(page);

    const badgeBefore = parseInt(
      (await page.locator('#k-modal-cart-badge').textContent().catch(() => '0')) || '0', 10
    );

    await addToCartFromModal(page);

    const badgeAfter = parseInt(await page.locator('#k-modal-cart-badge').textContent(), 10);
    expect(badgeAfter).toBeGreaterThan(badgeBefore);

    // Le bouton reflète « dans le panier »
    const btnClass = await page.locator('#k-add-cart-btn').getAttribute('class');
    expect(btnClass).toContain('in-cart');
  });

  test('E3b — Le drawer panier affiche l\'article ajouté', async ({ page }) => {
    await page.goto(BASE_URL);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await openCartDrawer(page);

    // Au moins un article dans le drawer (scopé desktop/mobile — cf. getCartItems)
    const items = await getCartItems(page);
    await expect(items.first()).toBeVisible({ timeout: 5_000 });
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
  });

  test('E3c — Le total du panier est > 0 KMF', async ({ page }) => {
    await page.goto(BASE_URL);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await openCartDrawer(page);

    // Le total est quelque part dans le drawer — chercher le texte « KMF » après « Total »
    const totalVisible = await page.evaluate(() => {
      const body = document.body.textContent || '';
      const match = body.match(/Total[\s\S]*?([\d\s]+)\s*KMF/);
      return match ? parseInt(match[1].replace(/\s/g, ''), 10) : 0;
    });
    expect(totalVisible).toBeGreaterThan(0);
  });

  test('E3d — Quantité modifiable depuis le drawer (+/-)', async ({ page }) => {
    await page.goto(BASE_URL);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await openCartDrawer(page);

    const firstItem = (await getCartItems(page)).first();
    await expect(firstItem).toBeVisible({ timeout: 5_000 });

    // Bouton + : desktop = .k-sc-step-plus, mobile = .k-qty-btn (distingué par le texte "+")
    const plusBtn = firstItem.locator(
      '.k-sc-step-plus, button:has-text("+"), .k-qty-plus, [data-action="qty-plus"]'
    ).first();
    await expect(plusBtn).toBeVisible({ timeout: 5_000 });
    await plusBtn.click();
    await page.waitForTimeout(300);
    // Le badge global doit avoir augmenté
    const badge = parseInt(
      (await page.locator('#k-modal-cart-badge, #k-cart-badge, [data-cart-count]').first()
        .textContent().catch(() => '0')) || '0', 10
    );
    expect(badge).toBeGreaterThanOrEqual(2);
  });

  test('E3e — Suppression d\'un article du panier', async ({ page }) => {
    await page.goto(BASE_URL);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await openCartDrawer(page);

    const items = await getCartItems(page);
    await expect(items.first()).toBeVisible({ timeout: 5_000 });
    const countBefore = await items.count();

    // Bouton supprimer : desktop = .k-sc-item-remove, mobile = .k-cart-item-remove
    // (texte réel "✕", pas "×" — cf. b-cart.js)
    const removeBtn = items.first().locator(
      'button:has-text("✕"), button:has-text("×"), .k-cart-item-remove, .k-sc-item-remove, [data-action="remove"]'
    ).first();
    await expect(removeBtn).toBeVisible({ timeout: 5_000 });
    await removeBtn.click();
    await page.waitForTimeout(500);
    const countAfter = await items.count();
    expect(countAfter).toBeLessThan(countBefore);
  });

  test('E3f — Le bouton Commander est présent dans le drawer', async ({ page }) => {
    await page.goto(BASE_URL);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await openCartDrawer(page);

    const checkoutBtn = page.locator(
      '#k-cart-checkout, [data-action="checkout"], button:has-text("Commander")'
    ).first();
    await expect(checkoutBtn).toBeAttached({ timeout: 5_000 });
  });
});

// Campagne P0 : données de staging imposées explicitement, pas de faux vert sur fixture absente.
const MULTISIZE_TARGET = process.env.E2E_MULTI_VARIANT_PRODUCT_NAME || '';
test.describe('P0 variantes — parcours vrai Chromium desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.skip(!IS_REMOTE || !MULTISIZE_TARGET,
    'Campagne staging explicite : BASE_URL distant et E2E_MULTI_VARIANT_PRODUCT_NAME requis (un skip ne vaut pas PASS)');

  test('même produit en deux tailles : ajout, quantités isolées, libellés et persistance', async ({ page }) => {
    page.on('response', async (response) => {
      if (!response.url().includes('/api/products/') || !response.url().includes('/detail')) return;
      try {
        const detail = await response.json();
        console.log('[P0 DETAIL]', JSON.stringify({
          status: response.status(), product_id: response.url().split('/').slice(-2)[0],
          inventory_model: detail.inventory_model,
          option_axes: (detail.option_axes || []).map(a => a.key),
          sellable_count: detail.sellable_units?.length || 0,
          units: (detail.sellable_units || []).slice(0, 4).map(u => ({
            sku_id: u.sku_id, combo: u.variant_combo, stock_status: u.stock_status,
          })),
        }));
      } catch (err) { console.log('[P0 DETAIL ERROR]', String(err)); }
    });
    await page.goto(BASE_URL);
    await page.locator('#k-search-input').fill(MULTISIZE_TARGET);
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
    console.log('[P0 BUTTON]', JSON.stringify(await page.locator('#k-modal-variants').evaluate(root => ({
      axes: Array.from(root.querySelectorAll('[data-axis-key]')).map(el => ({
        key: el.dataset.axisKey,
        selected: Array.from(el.querySelectorAll('button[aria-pressed="true"]')).map(b => b.dataset.optionValue),
      })),
      buttonClass: document.querySelector('#k-add-cart-btn')?.className,
      ariaDisabled: document.querySelector('#k-add-cart-btn')?.getAttribute('aria-disabled'),
      purchaseMessage: document.querySelector('#k-modal-selection-message')?.textContent,
    }))));
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

    await page.screenshot({ path: test.info().outputPath('sku-two-sizes-desktop.png') });
    await page.reload();
    await expect(rows).toHaveCount(2);
    const afterReload = await rows.locator('.k-sc-item-variant').allTextContents();
    expect(afterReload.some(t => t.includes(sizeA))).toBe(true);
    expect(afterReload.some(t => t.includes(sizeB))).toBe(true);
  });
});
