/**
 * contracts.spec.js — Étage DYNAMIQUE de l'audit feature-par-feature.
 *
 * Le `feature-audit.js` (statique) vérifie que la RÈGLE est présente dans le
 * bundle. Ce spec vérifie qu'elle PREND EFFET dans un vrai navigateur : il ouvre
 * la modal et lit le `display` *calculé* du product-zone. C'est l'assertion qui
 * manquait — l'ancien boutique.spec.js testait « la modal s'ouvre / le nom est
 * là », jamais « le layout est en grille ». La modal cassée passait donc même
 * un e2e restauré : elle s'ouvrait, mal disposée. Ici, FAIL si pas grid.
 *
 * Source de vérité du contrat : public/boutique/features/modal-product.feature.js
 * (champ contracts['render-static']). Ce spec en est le miroir runtime.
 */
'use strict';
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

async function openFirstProduct(page) {
  await page.goto(BASE_URL);
  await page.waitForSelector('#k-grid .k-promo-card, #k-grid .k-card', { timeout: 10_000 });
  await page.locator('#k-grid .k-promo-card, #k-grid .k-card').first().click();
  await expect(page.locator('#k-modal-overlay')).toBeVisible({ timeout: 5_000 });
}

test.describe('Contrat de rendu — modal-product', () => {

  test('CONTRAT desktop : .k-modal-product-zone est en display:grid', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });   // ≥900px = desktop
    await openFirstProduct(page);

    const display = await page.locator('#k-modal .k-modal-product-zone').evaluate(
      el => getComputedStyle(el).display
    );
    // Le cœur du contrat : sans grid, l'image et les détails s'effondrent.
    expect(display, 'product-zone doit calculer display:grid en desktop').toBe('grid');

    // Et la grille doit avoir 2 pistes de colonnes (image | détails).
    const cols = await page.locator('#k-modal .k-modal-product-zone').evaluate(
      el => getComputedStyle(el).gridTemplateColumns.split(' ').length
    );
    expect(cols, 'product-zone doit avoir 2 colonnes desktop').toBeGreaterThanOrEqual(2);
  });

  test('CONTRAT : image et colonne détails sont toutes deux visibles (non effondrées)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openFirstProduct(page);

    const imgBox    = await page.locator('#k-modal .k-modal-img-wrap').first().boundingBox();
    const detailBox = await page.locator('#k-modal .k-modal-details').first().boundingBox();

    expect(imgBox && imgBox.width,    'colonne image doit avoir une largeur').toBeGreaterThan(50);
    expect(detailBox && detailBox.width, 'colonne détails doit avoir une largeur').toBeGreaterThan(50);
    // Deux colonnes côte-à-côte : l'image commence à gauche des détails.
    expect(imgBox.x, 'image à gauche des détails (2 colonnes)').toBeLessThan(detailBox.x);
  });
});
