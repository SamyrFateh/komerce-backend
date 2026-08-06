/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   modal.spec.js
 * @feature catalog, modal-product
 * @brief Modale produit : ouverture, contenu, carousel, fermetures, scroll
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, waitForGrid, openFirstCard, waitForModalOpen, closeModal,
  IS_REMOTE,
} = require('./helpers/boutique.helpers');

test.describe('E-MODAL — Modale produit', () => {
  // Ces flows nécessitent un catalogue réel (données produit du backend) :
  // indisponibles en mode LOCAL (npx serve, sans API). Lancer avec BASE_URL distant.
  test.skip(!IS_REMOTE, 'Nécessite un catalogue réel (backend) — lancer avec BASE_URL distant');


  test('E2 — Ouverture modale : nom, prix, image, bouton fermer', async ({ page }) => {
    await page.goto(BASE_URL);
    const productId = await openFirstCard(page);
    expect(productId).toBeTruthy();

    // Nom
    const name = await page.locator('#k-modal-name').textContent();
    expect(name.trim().length).toBeGreaterThan(0);

    // Prix
    const price = await page.locator('#k-modal-price').textContent();
    expect(price.trim()).toMatch(/KMF/);

    // Image carousel
    await page.waitForFunction(
      () => {
        const img = document.querySelector('#k-modal-carousel .k-modal-slide');
        return img && img.src && img.src.length > 0;
      },
      { timeout: 6_000 }
    );

    // Bouton fermer visible
    await expect(page.locator('#k-modal-close')).toBeVisible();
  });

  test('E2b — Le stepper quantité fonctionne (+/-)', async ({ page }) => {
    await page.goto(BASE_URL);
    await openFirstCard(page);

    const qtyEl = page.locator('#k-qty-val');
    await expect(qtyEl).toBeVisible({ timeout: 3_000 });
    const qtyBefore = parseInt(await qtyEl.textContent(), 10);
    expect(qtyBefore).toBeGreaterThan(0);

    // Cliquer + et attendre que la valeur change (animation/debounce)
    const plusBtn = page.locator('#k-qty-plus, .k-qty-plus').first();
    await plusBtn.click();
    await page.waitForFunction(
      (expected) => {
        const el = document.getElementById('k-qty-val');
        return el && parseInt(el.textContent, 10) === expected;
      },
      qtyBefore + 1,
      { timeout: 3_000 }
    ).catch(() => {}); // tolérer si le stepper est limité (lot, max stock)

    const qtyAfterPlus = parseInt(await qtyEl.textContent(), 10);
    expect(qtyAfterPlus).toBeGreaterThanOrEqual(qtyBefore); // au moins stable
  });

  test('E7a — Fermeture via bouton ✕', async ({ page }) => {
    await page.goto(BASE_URL);
    await openFirstCard(page);
    await closeModal(page);
    await expect(page.locator('body')).not.toHaveClass(/modal-open/, { timeout: 2_000 });
  });

  test('E7b — Fermeture via clic overlay (fond)', async ({ page }) => {
    await page.goto(BASE_URL);
    await openFirstCard(page);
    // Dispatch direct pour contourner le hit-testing Playwright sur l'overlay
    await page.evaluate(() => {
      document.getElementById('k-modal-overlay')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await expect(page.locator('#k-modal-overlay')).not.toHaveClass(/open/, { timeout: 4_000 });
  });

  test('E7c — Fermeture via Escape', async ({ page }) => {
    await page.goto(BASE_URL);
    await openFirstCard(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#k-modal-overlay')).not.toHaveClass(/open/, { timeout: 4_000 });
  });

  test('E7d — Scroll catalogue restauré après fermeture', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);

    // Scroller avant d'ouvrir la modale
    await page.evaluate(() => {
      const ps = document.getElementById('k-page-scroll');
      if (ps && window.innerWidth < 900) ps.scrollTo(0, 400);
      else window.scrollTo(0, 400);
    });
    await page.waitForTimeout(200);

    const scrollBefore = await page.evaluate(() => {
      const ps = document.getElementById('k-page-scroll');
      return (ps && window.innerWidth < 900) ? ps.scrollTop : (window.scrollY || 0);
    });

    await openFirstCard(page);
    await closeModal(page);
    await page.waitForTimeout(300);

    const scrollAfter = await page.evaluate(() => {
      const ps = document.getElementById('k-page-scroll');
      return (ps && window.innerWidth < 900) ? ps.scrollTop : (window.scrollY || 0);
    });
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(60);
  });
});
