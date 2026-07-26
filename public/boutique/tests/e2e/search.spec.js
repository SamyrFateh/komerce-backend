/**
 * @e2e   search.spec.js
 * @feature catalog-search
 * @brief Recherche catalogue : saisie, dropdown résultats, clic → modale,
 *        aucun résultat, fermeture dropdown au clic extérieur.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, IS_REMOTE, waitForGrid, waitForModalOpen, closeModal, cardCount,
} = require('./helpers/boutique.helpers');

test.describe('E-SEARCH — Recherche catalogue', () => {

  test.beforeEach(async ({ page }) => {
    test.skip(!IS_REMOTE, 'Recherche nécessite un catalogue réel (backend)');
    await page.goto(BASE_URL);
    await waitForGrid(page);
  });

  test('E20 — Le champ recherche est visible et focusable', async ({ page }) => {
    const input = page.locator('#k-search-input');
    await expect(input).toBeVisible({ timeout: 5_000 });
    await input.focus();
    await expect(input).toBeFocused();
  });

  test('E20b — Saisie d\'un terme → dropdown avec au moins 1 résultat', async ({ page }) => {
    const input = page.locator('#k-search-input');
    const dropdown = page.locator('#k-search-dropdown');

    // Récupère le nom de la première carte pour chercher un terme réel
    const firstCardName = await page.locator('#k-grid .k-promo-card .k-card-name, #k-grid .k-card .k-card-name').first().textContent();
    const searchTerm = firstCardName.trim().split(/\s+/)[0]; // premier mot

    await input.fill(searchTerm);
    await expect(dropdown).toHaveClass(/open/, { timeout: 5_000 });

    const items = dropdown.locator('.k-search-item');
    await expect(items.first()).toBeVisible({ timeout: 5_000 });
    expect(await items.count()).toBeGreaterThanOrEqual(1);
  });

  test('E20c — Clic sur un résultat de recherche → ouvre la modale produit', async ({ page }) => {
    const input = page.locator('#k-search-input');
    const dropdown = page.locator('#k-search-dropdown');

    const firstCardName = await page.locator('#k-grid .k-promo-card .k-card-name, #k-grid .k-card .k-card-name').first().textContent();
    const searchTerm = firstCardName.trim().split(/\s+/)[0];

    await input.fill(searchTerm);
    await expect(dropdown).toHaveClass(/open/, { timeout: 5_000 });
    await dropdown.locator('.k-search-item').first().click();
    await waitForModalOpen(page);

    await expect(page.locator('#k-modal-name')).not.toBeEmpty();
  });

  // P0-A #2 — verrouille le correctif « grille vide après recherche + clic modal ».
  // Bug : _resetSearchFilter() n'était pas appelé au clic sur un résultat ;
  // state.filtered restait la liste étroite et _balancedPick() produisait 0 carte.
  test('E20c-bis — grille toujours peuplée après fermeture modale ouverte via recherche', async ({ page }) => {
    const input = page.locator('#k-search-input');
    const dropdown = page.locator('#k-search-dropdown');

    const firstCardName = await page.locator('#k-grid .k-promo-card .k-card-name, #k-grid .k-card .k-card-name').first().textContent();
    const searchTerm = firstCardName.trim().split(/\s+/)[0];

    await input.fill(searchTerm);
    await expect(dropdown).toHaveClass(/open/, { timeout: 5_000 });
    await dropdown.locator('.k-search-item').first().click();
    await waitForModalOpen(page);

    // Fermer la modale
    await closeModal(page);
    await expect(page.locator('#k-modal-overlay')).not.toHaveClass(/open/, { timeout: 5_000 });

    // La grille DOIT être peuplée — jamais vide après ce parcours
    await waitForGrid(page);
    const count = await cardCount(page);
    expect(count).toBeGreaterThan(0);
  });

  test('E20d — Terme sans résultat → message "Aucun résultat"', async ({ page }) => {
    const input = page.locator('#k-search-input');
    const dropdown = page.locator('#k-search-dropdown');

    await input.fill('xyznonexistent99999');
    await expect(dropdown).toHaveClass(/open/, { timeout: 5_000 });
    await expect(dropdown).toContainText('Aucun résultat', { timeout: 5_000 });
  });

  test('E20e — Clic extérieur ferme la dropdown de recherche', async ({ page }) => {
    const input = page.locator('#k-search-input');
    const dropdown = page.locator('#k-search-dropdown');

    const firstCardName = await page.locator('#k-grid .k-promo-card .k-card-name, #k-grid .k-card .k-card-name').first().textContent();
    await input.fill(firstCardName.trim().split(/\s+/)[0]);
    await expect(dropdown).toHaveClass(/open/, { timeout: 5_000 });

    // Clic en dehors du champ de recherche
    await page.locator('#k-hero').click({ force: true });
    await expect(dropdown).not.toHaveClass(/open/, { timeout: 3_000 });
  });
});
