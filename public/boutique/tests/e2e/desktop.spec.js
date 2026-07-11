/**
 * @e2e   desktop.spec.js
 * @feature desktop-layout
 * @brief Layout desktop : sidebar, side-cart permanent, header nav,
 *        hero adapté, grille multi-colonnes.
 *
 * Ce fichier ne tourne QUE sur les projets Desktop (viewport ≥ 900px).
 * Sur Mobile Chrome / Mobile Safari, les tests sont automatiquement skipped.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, IS_REMOTE, waitForGrid, openFirstCard,
  addToCartFromModal, closeModal,
} = require('./helpers/boutique.helpers');

test.describe('E-DESK — Layout desktop', () => {

  test.beforeEach(async ({ page }) => {
    test.skip(!IS_REMOTE, 'Nécessite le catalogue réel');
    await page.goto(BASE_URL);
    const isDesktop = await page.evaluate(() => window.innerWidth >= 900);
    if (!isDesktop) { test.skip(); return; }
    await waitForGrid(page);
  });

  test('E30 — Le header desktop affiche les boutons de navigation (pas la bnav mobile)', async ({ page }) => {
    const headerNavBtns = page.locator('.k-header-nav-btn');
    expect(await headerNavBtns.count()).toBeGreaterThanOrEqual(3);
    await expect(headerNavBtns.first()).toBeVisible();

    // La bnav mobile doit être cachée en desktop
    const bnav = page.locator('#k-bnav');
    await expect(bnav).toBeHidden();
  });

  test('E30b — La grille catalogue s\'affiche en multi-colonnes (≥ 2)', async ({ page }) => {
    const grid = page.locator('#k-grid');
    const gridBox = await grid.boundingBox();
    const firstCard = page.locator('#k-grid .k-promo-card, #k-grid .k-card').first();
    const cardBox = await firstCard.boundingBox();

    // Si la grille fait > 800px et une carte < 50% de la grille → multi-colonnes
    expect(cardBox.width).toBeLessThan(gridBox.width * 0.6);
  });

  test('E31 — Ajout au panier → le side-cart permanent apparaît', async ({ page }) => {
    const sideCart = page.locator('#k-side-cart');
    // Avant ajout : pas de classe .has-items
    await expect(sideCart).not.toHaveClass(/has-items/);

    await openFirstCard(page);
    await addToCartFromModal(page);
    await closeModal(page);

    // Après ajout : le side-cart affiche les articles
    await expect(sideCart).toHaveClass(/has-items/, { timeout: 5_000 });
    const items = sideCart.locator('.k-sc-item');
    expect(await items.count()).toBeGreaterThanOrEqual(1);
  });

  test('E31b — Le side-cart affiche le total et le bouton Commander', async ({ page }) => {
    await openFirstCard(page);
    await addToCartFromModal(page);
    await closeModal(page);

    const sideCart = page.locator('#k-side-cart.has-items');
    await expect(sideCart).toBeVisible({ timeout: 5_000 });

    const total = page.locator('#k-sc-total');
    await expect(total).not.toBeEmpty();

    const checkoutBtn = page.locator('#k-sc-checkout');
    await expect(checkoutBtn).toBeVisible();
  });

  test('E32 — La recherche desktop fonctionne (dropdown visible)', async ({ page }) => {
    const input = page.locator('#k-search-input');
    await expect(input).toBeVisible({ timeout: 3_000 });

    const firstCardName = await page.locator('#k-grid .k-promo-card .k-card-name, #k-grid .k-card .k-card-name').first().textContent();
    await input.fill(firstCardName.trim().split(/\s+/)[0]);

    const dropdown = page.locator('#k-search-dropdown');
    await expect(dropdown).toHaveClass(/open/, { timeout: 5_000 });
  });
});
