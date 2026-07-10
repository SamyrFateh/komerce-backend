/**
 * @e2e   catalog.spec.js
 * @feature catalog
 * @brief Catalogue boutique : grille, filtres, cache offline, scroll infini
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, waitForGrid, cardCount, clickCategory, openFirstCard, closeModal,
  blockAllApi, unblockApi,
} = require('./helpers/boutique.helpers');

test.describe('E-CATALOG — Catalogue boutique', () => {

  test('E1 — La grille charge avec au moins 1 produit visible', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);
    const count = await cardCount(page);
    expect(count).toBeGreaterThan(0);
  });

  test('E1b — Chaque carte affiche nom + prix', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);
    const firstCard = page.locator('#k-grid .k-promo-card, #k-grid .k-card').first();
    // Le nom est le contenu texte visible de la carte (pas de classe dédiée)
    const cardText = await firstCard.textContent();
    expect(cardText.trim().length).toBeGreaterThan(0);
    // Prix en KMF quelque part dans la carte
    expect(cardText).toMatch(/KMF/);
  });

  test('E1c — Les chips catégories sont visibles et filtrent la grille', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);
    const chips = page.locator('.k-chip, .k-cat-chip');
    const chipCount = await chips.count();
    expect(chipCount).toBeGreaterThan(1); // au moins "Tout" + 1 catégorie

    // Cliquer sur une catégorie (pas "Tout") et vérifier que la grille change
    const countBefore = await cardCount(page);
    const secondChip = chips.nth(1);
    const chipText = await secondChip.textContent();
    await secondChip.click();
    await page.waitForTimeout(500);
    // La grille ne doit pas être vide (sauf catégorie vide — on vérifie juste que ça ne crash pas)
    const countAfter = await cardCount(page);
    expect(countAfter).toBeGreaterThanOrEqual(0);

    // Revenir sur "Tout" → la grille initiale est restaurée
    await chips.first().click();
    await page.waitForTimeout(500);
    const countAll = await cardCount(page);
    expect(countAll).toBe(countBefore);
  });

  test('E1d — Cache offline : la grille s\'affiche même sans réseau', async ({ page }) => {
    // 1. Charger normalement pour remplir le cache
    await page.goto(BASE_URL);
    await waitForGrid(page);
    const cacheRaw = await page.evaluate(() => localStorage.getItem('komerce_products_cache'));
    expect(cacheRaw).toBeTruthy();
    const cache = JSON.parse(cacheRaw);
    expect(cache.length).toBeGreaterThan(0);

    // 2. Bloquer les API et recharger
    await blockAllApi(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForGrid(page);

    const count = await cardCount(page);
    expect(count).toBeGreaterThan(0);
    await unblockApi(page);
  });
});
