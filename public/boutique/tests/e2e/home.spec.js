/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   home.spec.js
 * @feature home, hero, categories
 * @brief Page d'accueil : hero visible, chips catégories, proverbe/greeting,
 *        WhatsApp FAB, footer, structure globale.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { BASE_URL, IS_REMOTE, waitForGrid } = require('./helpers/boutique.helpers');

test.describe('E-HOME — Page d\'accueil & structure', () => {

  test.beforeEach(async ({ page }) => {
    test.skip(!IS_REMOTE, 'Nécessite le catalogue réel');
    await page.goto(BASE_URL);
  });

  test('E25 — Le hero est visible avec une image ou un contenu', async ({ page }) => {
    const hero = page.locator('#k-hero');
    await expect(hero).toBeVisible({ timeout: 5_000 });

    // Le hero doit avoir une hauteur significative (pas 0px)
    const box = await hero.boundingBox();
    expect(box.height).toBeGreaterThan(50);
  });

  test('E25b — Les chips catégories sont affichées sous le hero', async ({ page }) => {
    await waitForGrid(page);

    const chips = page.locator('#k-cats .k-chip, #k-cats .k-cat-chip');
    await expect(chips.first()).toBeVisible({ timeout: 5_000 });
    expect(await chips.count()).toBeGreaterThanOrEqual(2);
  });

  test('E25c — Le proverbe/greeting est affiché', async ({ page }) => {
    // Le greeting peut être dans le hero ou la sticky bar
    await page.waitForFunction(
      () => {
        const proverb = document.getElementById('k-proverb-text');
        const hero = document.getElementById('k-hero');
        const body = document.body.textContent || '';
        return (proverb && proverb.textContent.length > 3)
            || (hero && hero.textContent.length > 10)
            || body.includes('Bienvenue');
      },
      { timeout: 8_000 }
    );
  });

  test('E26 — Le bouton WhatsApp FAB est présent', async ({ page }) => {
    const fab = page.locator('#k-wa-fab');
    await expect(fab).toBeAttached({ timeout: 5_000 });
    const href = await fab.getAttribute('href');
    expect(href).toContain('wa.me');
  });

  test('E26b — Le header contient le logo', async ({ page }) => {
    const header = page.locator('#k-header');
    await expect(header).toBeVisible({ timeout: 3_000 });

    const logo = header.locator('.k-logo-svg, .k-logo-mini, .k-logo');
    expect(await logo.count()).toBeGreaterThanOrEqual(1);
  });

  test('E27 — Aucune erreur console bloquante au chargement initial', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(BASE_URL);
    await waitForGrid(page);
    await page.waitForTimeout(1_000);

    // Ignorer les erreurs ResizeObserver (bruit Chromium non bloquant)
    const real = errors.filter(m => !m.includes('ResizeObserver'));
    expect(real).toHaveLength(0);
  });
});
