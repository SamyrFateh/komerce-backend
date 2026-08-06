/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/group-price-variation.spec.js
 * @feature shared-cart, group, checkout
 * @brief F26 — Variation de prix entre le partage et le checkout (mandat §3/§10).
 *
 * Scénario réel :
 *   1. Un produit de test dédié est créé via l'API admin (prix initial
 *      6 500 KMF) — jamais un produit réel du catalogue, pour ne rien
 *      polluer côté staging.
 *   2. Le compte de test l'ajoute à son panier et partage une liste
 *      (snapshot figé à 6 500 KMF au moment du partage).
 *   3. Le prix catalogue du produit est modifié à 7 200 KMF via l'API
 *      admin (simule une hausse après le partage).
 *   4. Le compte de test rouvre sa propre liste, sélectionne l'article et
 *      clique "Acheter la sélection" → le checkout doit afficher l'ancien
 *      prix (6 500) barré/référencé et le nouveau (7 200) comme dominant,
 *      avec le message "Le prix d'un article a été actualisé depuis le
 *      partage."
 *   5. Le total du checkout doit être calculé avec le prix ACTUEL
 *      (7 200), jamais le snapshot.
 *
 * Couvre en E2E navigateur ce que group-price-variation.test.js couvre déjà
 * en unitaire (logique pure) — ici on vérifie le rendu réel dans le DOM du
 * checkout, contre un vrai backend.
 *
 * ⚠️ PRÉREQUIS : TEST_ADMIN_TOKEN (JWT d'un compte admin sur ce staging,
 * même pattern que provisionTestWallet() dans helpers/api.helpers.js).
 * Sans lui, ce test échoue explicitement plutôt que de se skipper —
 * comme documenté pour provisionTestWallet, l'absence n'est pas traitée
 * comme un cas normal.
 *
 * ⚠️ Ce test crée un produit de test, une vraie liste, et ouvre un
 * checkout réel (jamais soumis — aucune commande n'est créée par ce test)
 * → staging uniquement (ALLOW_GROUP_FLOW).
 */
'use strict';

const { test, expect } = require('@playwright/test');
const {
  BASE_URL,
  waitForGrid,
  closeModal,
  openCartDrawer,
} = require('../helpers/boutique.helpers');
const {
  getClientShareState,
  cancelAnyActiveSharedCart,
} = require('../helpers/api.helpers');
const { getSharePageUrl } = require('../helpers/business.helpers');

const TEST_PRODUCT_NAME = 'E2E Price Variation Test Product — ne pas commander';
const SNAPSHOT_PRICE_KMF = 6500;
const CURRENT_PRICE_KMF = 7200;

async function adminFetch(page, path, options = {}) {
  const adminToken = process.env.TEST_ADMIN_TOKEN;
  if (!adminToken) {
    throw new Error(
      '[F26] TEST_ADMIN_TOKEN absent — configurer un JWT admin staging pour ce test. ' +
      'Ce test ne peut pas être skippé (même doctrine que provisionTestWallet, voir api.helpers.js).'
    );
  }

  const base = BASE_URL.replace('/boutique/', '');

  return page.evaluate(async (args) => {
    const resp = await fetch(new URL(args.path, args.base).href, {
      method: args.method || 'GET',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${args.token}`,
      },
      body: args.body ? JSON.stringify(args.body) : undefined,
    });

    const data = await resp.json().catch(() => ({}));

    return {
      ok: resp.ok,
      status: resp.status,
      data,
    };
  }, {
    path,
    base,
    token: adminToken,
    method: options.method,
    body: options.body,
  });
}

test.describe('FLOW — Variation de prix au checkout (F26)', () => {
  test.skip(
    !process.env.ALLOW_GROUP_FLOW,
    'F26 nécessite ALLOW_GROUP_FLOW=true — staging uniquement',
  );

  let productId = null;

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await cancelAnyActiveSharedCart(page);
  });

  test.afterEach(async ({ page }) => {
    await cancelAnyActiveSharedCart(page);

    if (productId) {
      await adminFetch(page, `/api/products/${productId}`, {
        method: 'DELETE',
      }).catch(() => {});

      productId = null;
    }
  });

  test(
    'F26 — le checkout affiche la variation de prix et calcule le total au prix actuel',
    async ({ page }) => {
      const createResult = await adminFetch(page, '/api/products', {
        method: 'POST',
        body: {
          name: TEST_PRODUCT_NAME,
          category: 'mode',
          price_kmf: SNAPSHOT_PRICE_KMF,
          stock: 100,
          is_active: true,
        },
      });

      expect(
        createResult.ok,
        `Création produit admin échouée : ${JSON.stringify(createResult.data)}`,
      ).toBe(true);

      productId = createResult.data?.id || createResult.data?.product?.id;

      expect(
        productId,
        'id du produit créé introuvable dans la réponse',
      ).toBeTruthy();

      await page.goto(BASE_URL);
      await waitForGrid(page);

      await page
        .locator('#k-grid')
        .getByText(TEST_PRODUCT_NAME, { exact: false })
        .first()
        .click();

      await page.waitForSelector(
        '#k-modal-overlay.open, .k-modal-overlay.open',
        { timeout: 10_000 },
      );

      const addBtn = page.locator('#k-add-cart-btn');
      await expect(addBtn).toBeEnabled({ timeout: 5_000 });
      await addBtn.click();

      await page.waitForFunction(
        (selector) => {
          const element = document.querySelector(selector);
          return element && parseInt(element.textContent || '0', 10) > 0;
        },
        '#k-modal-cart-badge',
        { timeout: 6_000 },
      );

      await closeModal(page);
      await openCartDrawer(page);

      const shareBtn = page.locator('#k-cart-share, #k-sc-share').first();
      await expect(shareBtn).toBeVisible({ timeout: 10_000 });

      await page.evaluate(() => {
        window.open = () => null;

        try {
          Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: async () => {},
          });
        } catch (_) {}
      });

      await shareBtn.click();

      await page.waitForFunction(
        () => !!sessionStorage.getItem('kmrc_share'),
        { timeout: 15_000 },
      ).catch(() => {});

      const shareState = await getClientShareState(page);

      expect(
        shareState?.token,
        'Le token de la liste doit exister',
      ).toBeTruthy();

      const updateResult = await adminFetch(
        page,
        `/api/products/${productId}`,
        {
          method: 'PUT',
          body: {
            price_kmf: CURRENT_PRICE_KMF,
          },
        },
      );

      expect(
        updateResult.ok,
        `Mise à jour prix admin échouée : ${JSON.stringify(updateResult.data)}`,
      ).toBe(true);

      const publicResp = page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(`/api/shared-carts/public/${shareState.token}`) &&
          response.request().method() === 'GET',
        { timeout: 15_000 },
      );

      await page.goto(getSharePageUrl(shareState.token));
      await publicResp;

      const sharedListPanel = page.locator(
        '#k-side-cart .k-shared-list-items',
      );

      await expect(sharedListPanel).toBeVisible({ timeout: 10_000 });

      const selectBtn = page
        .locator('#k-side-cart .k-shared-item-select')
        .first();

      await expect(selectBtn).toBeVisible({ timeout: 10_000 });
      await selectBtn.click();

      const buyBtn = page.locator('#k-side-cart #k-shared-list-buy');

      await expect(buyBtn).toBeEnabled({ timeout: 5_000 });
      await buyBtn.click();

      await page.waitForSelector(
        '#k-order-modal.open, .k-order-modal.open',
        { timeout: 10_000 },
      );

      const snapshotPricePattern =
        /6[\s\u00a0\u202f]*500\s*KMF/i;
      const currentPricePattern =
        /7[\s\u00a0\u202f]*200\s*KMF/i;

      const recap = page.locator('#ck-price-variation-recap');

      await expect(recap).toBeVisible({ timeout: 10_000 });
      await expect(recap).toContainText(/actualisé depuis le partage/i);
      await expect(recap).toContainText(snapshotPricePattern);
      await expect(recap).toContainText(currentPricePattern);

      await expect(
        recap.locator('.ck-price-variation-summary'),
      ).toContainText(/prix d.un article a été actualisé/i);

      await expect(
        recap.locator('.ck-price-variation-prices s'),
      ).toContainText(snapshotPricePattern);

      await expect(
        recap.locator('.ck-price-variation-prices strong'),
      ).toContainText(currentPricePattern);

      const confirmMain = page.locator(
        '#btn-confirm-order .ck-confirm-main',
      );

      await expect(confirmMain).toBeVisible({ timeout: 15_000 });
      await expect(confirmMain).toContainText(currentPricePattern);
      await expect(confirmMain).not.toContainText(snapshotPricePattern);
    },
  );
});
