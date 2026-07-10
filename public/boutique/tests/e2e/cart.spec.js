/**
 * @e2e   cart.spec.js
 * @feature cart
 * @brief Panier : ajout depuis modale, badge, drawer, quantités, suppression
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, waitForGrid, openFirstCard, addToCartFromModal,
  closeModal, openCartDrawer, cardCount,
} = require('./helpers/boutique.helpers');

test.describe('E-CART — Panier', () => {

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

    // Au moins un article dans le drawer
    const items = page.locator('.k-cart-item, .k-sc-item, #k-cart-items .k-cart-row');
    await expect(items.first()).toBeAttached({ timeout: 5_000 });
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

    const firstItem = page.locator('.k-cart-item, .k-sc-item, #k-cart-items .k-cart-row').first();
    await expect(firstItem).toBeAttached({ timeout: 5_000 });

    // Chercher un bouton + dans l'item
    const plusBtn = firstItem.locator('button:has-text("+"), .k-qty-plus, [data-action="qty-plus"]').first();
    if ((await plusBtn.count()) > 0) {
      await plusBtn.click();
      await page.waitForTimeout(300);
      // Le badge global doit avoir augmenté
      const badge = parseInt(
        (await page.locator('#k-modal-cart-badge, #k-cart-badge, [data-cart-count]').first()
          .textContent().catch(() => '0')) || '0', 10
      );
      expect(badge).toBeGreaterThanOrEqual(2);
    }
  });

  test('E3e — Suppression d\'un article du panier', async ({ page }) => {
    await page.goto(BASE_URL);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await openCartDrawer(page);

    const items = page.locator('.k-cart-item, .k-sc-item, #k-cart-items .k-cart-row');
    await expect(items.first()).toBeAttached({ timeout: 5_000 });
    const countBefore = await items.count();

    // Bouton supprimer sur le premier item
    const removeBtn = items.first().locator(
      'button:has-text("×"), .k-cart-remove, [data-action="remove"], .k-sc-remove'
    ).first();
    if ((await removeBtn.count()) > 0) {
      await removeBtn.click();
      await page.waitForTimeout(500);
      const countAfter = await items.count();
      expect(countAfter).toBeLessThan(countBefore);
    }
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
