/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   favorites.spec.js
 * @feature favorites
 * @brief Favoris : ajout depuis la grille catalogue, apparition dans l'onglet
 *        Favoris, retrait, état vide. Couvre js/b-favs.js (renderFavView,
 *        toggleFav dans b-cart.js).
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, waitForGrid, navigateToTab,
  IS_REMOTE,
} = require('./helpers/boutique.helpers');

test.describe('E-FAV — Favoris', () => {
  // Nécessite un catalogue réel (données produit du backend).
  test.skip(!IS_REMOTE, 'Nécessite un catalogue réel (backend) — lancer avec BASE_URL distant');

  test('E17 — Ajouter un produit aux favoris → cœur plein + toast', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);

    const firstCard = page.locator('#k-grid .k-promo-card, #k-grid .k-card').first();
    const favBtn = firstCard.locator('.k-card-fav');
    await expect(favBtn).toBeVisible({ timeout: 5_000 });

    // État initial : pas encore favori (sinon un run précédent a laissé un
    // résidu localStorage — on retire d'abord pour repartir propre)
    if (await favBtn.evaluate(el => el.classList.contains('liked'))) {
      await favBtn.click();
      await page.waitForTimeout(200);
    }

    await favBtn.click();
    await expect(favBtn).toHaveClass(/liked/, { timeout: 3_000 });
  });

  test('E17b — Le produit favori apparaît dans l\'onglet Favoris', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);

    const firstCard = page.locator('#k-grid .k-promo-card, #k-grid .k-card').first();
    const productId = await firstCard.getAttribute('data-id');
    const favBtn = firstCard.locator('.k-card-fav');
    await expect(favBtn).toBeVisible({ timeout: 5_000 });
    if (!(await favBtn.evaluate(el => el.classList.contains('liked')))) {
      await favBtn.click();
      await expect(favBtn).toHaveClass(/liked/, { timeout: 3_000 });
    }

    await navigateToTab(page, 'fav');

    const favGrid = page.locator('#k-fav-grid');
    await expect(favGrid).toBeVisible({ timeout: 5_000 });
    const favCard = favGrid.locator(`.k-card[data-id="${productId}"]`);
    await expect(favCard).toBeVisible({ timeout: 5_000 });
  });

  test('E17c — Retirer un favori depuis l\'onglet Favoris → carte disparaît', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);

    const firstCard = page.locator('#k-grid .k-promo-card, #k-grid .k-card').first();
    const productId = await firstCard.getAttribute('data-id');
    const favBtn = firstCard.locator('.k-card-fav');
    await expect(favBtn).toBeVisible({ timeout: 5_000 });
    if (!(await favBtn.evaluate(el => el.classList.contains('liked')))) {
      await favBtn.click();
      await expect(favBtn).toHaveClass(/liked/, { timeout: 3_000 });
    }

    await navigateToTab(page, 'fav');
    const favCard = page.locator(`#k-fav-grid .k-card[data-id="${productId}"]`);
    await expect(favCard).toBeVisible({ timeout: 5_000 });

    // renderFavView() se re-rend 100ms après le clic (setTimeout dans b-favs.js)
    await favCard.locator('.k-card-fav').click();
    await page.waitForTimeout(300);

    await expect(favCard).toHaveCount(0);
  });

  test('E17d — Favoris vides → message + invitation à ajouter', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);

    // S'assurer qu'aucun favori ne subsiste depuis un run précédent
    await page.evaluate(() => localStorage.removeItem('k_favs'));
    await page.reload();
    await waitForGrid(page);

    await navigateToTab(page, 'fav');

    const emptyState = page.locator('.k-fav-empty');
    await expect(emptyState).toBeVisible({ timeout: 5_000 });
    await expect(emptyState).toContainText('Aucun favori');
  });
});
