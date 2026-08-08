/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/group-flow.spec.js
 * @feature shared-cart, group
 * @brief Flux métier liste partageable : partage immédiat → vérification backend.
 *
 * Scénario :
 *   1. Ajouter une sélection au panier.
 *   2. Cliquer « Partager cette liste ».
 *   3. L'identité est vérifiée puis POST /api/shared-carts/from-cart-items est
 *      envoyé immédiatement, sans formulaire de configuration.
 *   4. Le token créé est posé dans sessionStorage['kmrc_share'].
 *   5. Vérifier que la liste existe côté backend.
 *
 * ⚠️ Ce test CRÉE une vraie liste en staging.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const {
  BASE_URL,
  waitForGrid,
  openFirstCard,
  addToCartFromModal,
  openCartDrawer,
  acceptConfirms,
} = require('../helpers/boutique.helpers');
const {
  verifySharedCart,
  getClientShareToken,
  cancelAnyActiveSharedCart,
  spyOnApi,
} = require('../helpers/api.helpers');

test.describe('FLOW — Liste partageable (créateur)', () => {
  test.skip(
    !process.env.ALLOW_GROUP_FLOW,
    'Flux liste désactivé (ALLOW_GROUP_FLOW non défini) — staging uniquement',
  );

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await cancelAnyActiveSharedCart(page);
  });

  test.afterEach(async ({ page }) => {
    await cancelAnyActiveSharedCart(page);
  });

  test('F20 — Partager une sélection → vérifier son existence côté API', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await openCartDrawer(page);

    const shareBtn = page.locator('#k-cart-share, #k-sc-share').first();
    await expect(shareBtn).toBeVisible({ timeout: 10_000 });

    // Empêcher l'ouverture d'un canal externe pendant le test. Le partage natif
    // est vérifié en test unitaire ; ici on valide le flux création → API.
    await page.evaluate(() => {
      window.open = () => null;
      try {
        Object.defineProperty(navigator, 'share', {
          configurable: true,
          value: async () => {},
        });
      } catch (_) {}
    });

    const createSpy = await spyOnApi(
      page,
      '/api/shared-carts/from-cart-items',
      'POST',
    );

    acceptConfirms(page); // É5 — window.confirm avant création
    await shareBtn.click();

    // Aucun formulaire de création ne doit apparaître.
    await expect(page.locator('#k-sm-submit')).toHaveCount(0);
    await expect(page.locator('#k-sm-title-f')).toHaveCount(0);
    await expect(page.locator('.k-sm-nature-opt')).toHaveCount(0);

    const call = await createSpy.waitForCall(15_000);
    expect(call).not.toBeNull();
    expect(call.body).toBeTruthy();
    expect(call.body).toEqual({
      cart_items: expect.any(Array),
    });
    expect(call.body.cart_items.length).toBeGreaterThanOrEqual(1);

    await page.waitForFunction(
      () => !!sessionStorage.getItem('kmrc_share'),
      { timeout: 10_000 },
    ).catch(() => {});

    const token = await getClientShareToken(page);
    expect(
      token,
      'Le token de la liste doit être posé côté client après création',
    ).toBeTruthy();

    if (token) {
      const result = await verifySharedCart(page, token);
      expect(result.exists, 'La liste doit exister côté API').toBe(true);
      if (result.cart) expect(result.cart.status).toBe('open');
    }
  });
});
