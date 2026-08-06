/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/group-coexistence.spec.js
 * @feature shared-cart, group
 * @brief F22 — Isolation panier personnel / liste partagée (mandat §4/§10).
 *
 * Scénario (mandat §10, bloc COEXISTENCE + §4 ISOLATION) :
 *   1. Le créateur partage une sélection → sa propre session bascule
 *      automatiquement en surface "shared-list" (activateSharedListContext,
 *      voir js/b-share-cart.js).
 *   2. Depuis un article de la liste, il ouvre la fiche produit
 *      (.k-shared-item-open → modal:open, voir
 *      js/group/group-side-cart.js::handleOpenItemProduct).
 *   3. Il ajoute ce produit à son panier PERSONNEL depuis la modale.
 *   4. Il ferme la modale → la surface "shared-list" doit se restaurer
 *      automatiquement (state.modalReturnSurface, consommé par le listener
 *      bus.on('modal:closed') dans group-side-cart.js).
 *   5. Le panier personnel contient le nouvel article, la liste et sa
 *      sélection restent strictement inchangées, aucune route shared-cart
 *      n'a été appelée par cette action.
 *
 * ⚠️ Ce test CRÉE une vraie liste → staging uniquement (ALLOW_GROUP_FLOW).
 */
'use strict';

const { test, expect } = require('@playwright/test');
const {
  BASE_URL,
  waitForGrid,
  openFirstCard,
  addToCartFromModal,
  closeModal,
  openCartDrawer,
} = require('../helpers/boutique.helpers');
const {
  verifySharedCart,
  getClientShareState,
  cancelAnyActiveSharedCart,
  spyOnApi,
} = require('../helpers/api.helpers');
const { getSharePageUrl } = require('../helpers/business.helpers');

async function readSharedListState(page) {
  return page
    .locator('#k-side-cart .k-shared-list-item')
    .evaluateAll((rows) =>
      rows.map((row) => ({
        id: row.dataset.itemId || null,
        name:
          row.querySelector('.k-cart-item-name')?.textContent?.trim() || '',
        quantity:
          row
            .querySelector('.k-shared-item-qty-val')
            ?.textContent?.trim() || null,
        selected: row.classList.contains('is-selected'),
        claimed: row.classList.contains('is-claimed'),
        selectionPressed:
          row
            .querySelector('.k-shared-item-select')
            ?.getAttribute('aria-pressed') || null,
      })),
    );
}

test.describe('FLOW — Isolation panier personnel / liste (F22)', () => {
  test.use({
    viewport: {
      width: 1280,
      height: 800,
    },
  });

  test.skip(
    !process.env.ALLOW_GROUP_FLOW,
    'F22 nécessite ALLOW_GROUP_FLOW=true — staging uniquement',
  );

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await cancelAnyActiveSharedCart(page);
  });

  test.afterEach(async ({ page }) => {
    await cancelAnyActiveSharedCart(page);
  });

  test(
    'F22 — ajout au panier perso depuis une fiche produit ouverte via la liste n\'altère jamais la liste',
    async ({ page }) => {
      await page.goto(BASE_URL);
      await waitForGrid(page);
      await openFirstCard(page);
      await addToCartFromModal(page);
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
        'Le token de la liste doit exister après création',
      ).toBeTruthy();

      const publicResponsePromise = page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(`/api/shared-carts/public/${shareState.token}`) &&
          response.request().method() === 'GET',
        { timeout: 15_000 },
      );

      await page.goto(getSharePageUrl(shareState.token));
      await publicResponsePromise;

      const sharedListPanel = page
        .locator(
          '#k-cart-body .k-shared-list-items, ' +
          '#k-side-cart .k-shared-list-items',
        )
        .first();

      await expect(sharedListPanel).toBeVisible({ timeout: 10_000 });

      const sharedListSnapshot = await sharedListPanel.innerHTML();

      const cartBadgeBefore = parseInt(
        (
          await page
            .locator('.k-cart-badge')
            .first()
            .textContent()
            .catch(() => '0')
        ) || '0',
        10,
      );

      const itemsRouteSpy = await spyOnApi(
        page,
        '/api/shared-carts/',
        'PUT',
      );

      const itemsPostSpy = await spyOnApi(
        page,
        '/api/shared-carts/',
        'POST',
      );

      const itemsDeleteSpy = await spyOnApi(
        page,
        '/api/shared-carts/',
        'DELETE',
      );

      const firstItemOpen = page.locator('.k-shared-item-open').first();

      await expect(firstItemOpen).toBeVisible({ timeout: 10_000 });
      await firstItemOpen.click();

      await expect(page.locator('#k-add-cart-btn')).toBeVisible({
        timeout: 10_000,
      });

      await addToCartFromModal(page);
      await closeModal(page);

      const sharedListPanelAfter = page
        .locator(
          '#k-cart-body .k-shared-list-items, ' +
          '#k-side-cart .k-shared-list-items',
        )
        .first();

      await expect(sharedListPanelAfter).toBeVisible({ timeout: 10_000 });

      const sharedListSnapshotAfter =
        await sharedListPanelAfter.innerHTML();

      expect(
        sharedListSnapshotAfter,
        'Le contenu rendu de la liste ne doit pas changer',
      ).toBe(sharedListSnapshot);

      const cartBadgeAfter = parseInt(
        (
          await page
            .locator('.k-cart-badge')
            .first()
            .textContent()
            .catch(() => '0')
        ) || '0',
        10,
      );

      expect(
        cartBadgeAfter,
        'Le badge panier personnel doit refléter le nouvel article ajouté',
      ).toBeGreaterThan(cartBadgeBefore);

      expect(
        itemsRouteSpy.calls().length,
        'Aucun PUT shared-carts ne doit être déclenché par cette action',
      ).toBe(0);

      expect(
        itemsPostSpy.calls().length,
        'Aucun POST shared-carts ne doit être déclenché par cette action',
      ).toBe(0);

      expect(
        itemsDeleteSpy.calls().length,
        'Aucun DELETE shared-carts ne doit être déclenché par cette action',
      ).toBe(0);

      const finalCheck = await verifySharedCart(
        page,
        shareState.token,
      );

      expect(
        finalCheck.exists,
        'La liste doit toujours exister côté API',
      ).toBe(true);
    },
  );

  test(
    'F22b — bascule desktop panier/liste (#k-cart-surface-switch) sans jamais perdre d\'état',
    async ({ page }) => {
      await page.goto(BASE_URL);
      await waitForGrid(page);
      await openFirstCard(page);
      await addToCartFromModal(page);
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
      expect(shareState?.token).toBeTruthy();

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

      await expect(
        page.locator('#k-cart-surface-switch'),
      ).toHaveCount(0);

      const secondCard = page
        .locator('#k-grid .k-promo-card, #k-grid .k-card')
        .nth(1);

      await expect(secondCard).toBeVisible({ timeout: 10_000 });
      await secondCard.click();

      await page.waitForSelector(
        '#k-modal-overlay.open, .k-modal-overlay.open',
        { timeout: 6_000 },
      );

      await addToCartFromModal(page);
      await closeModal(page);

      const switcher = page.locator('#k-cart-surface-switch');

      await expect(switcher).toBeVisible({ timeout: 10_000 });

      const personalBtn = switcher.locator(
        '.k-cart-surface-btn[data-surface="personal"]',
      );

      const listBtn = switcher.locator(
        '.k-cart-surface-btn[data-surface="shared-list"]',
      );

      await expect(personalBtn).toBeVisible();
      await expect(listBtn).toBeVisible();
      await expect(listBtn).toHaveAttribute('aria-pressed', 'true');

      const firstSelectableItem = sharedListPanel
        .locator('.k-shared-item-select:not([disabled])')
        .first();

      await expect(firstSelectableItem).toBeVisible();
      await firstSelectableItem.click();

      await expect(firstSelectableItem).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      const listStateBefore = await readSharedListState(page);

      expect(
        listStateBefore.some((item) => item.selected),
        'Au moins une ligne doit être sélectionnée avant la bascule',
      ).toBe(true);

      await personalBtn.click();

      await expect(personalBtn).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      await expect(listBtn).toHaveAttribute(
        'aria-pressed',
        'false',
      );

      await expect(
        page.locator('#k-side-cart #k-sc-items'),
      ).toBeVisible({ timeout: 10_000 });

      await expect(
        page.locator('#k-side-cart .k-shared-list-items'),
      ).toHaveCount(0);

      await listBtn.click();

      await expect(listBtn).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      const sharedListPanelAfter = page.locator(
        '#k-side-cart .k-shared-list-items',
      );

      await expect(sharedListPanelAfter).toBeVisible({
        timeout: 10_000,
      });

      const listStateAfter = await readSharedListState(page);

      expect(
        listStateAfter,
        'Les articles, quantités, statuts et sélections doivent être conservés après l\'aller-retour',
      ).toEqual(listStateBefore);

      await expect(switcher).toBeVisible();
      await expect(switcher).toContainText('Panier (1)');

      const finalCheck = await verifySharedCart(
        page,
        shareState.token,
      );

      expect(
        finalCheck.exists,
        'La liste doit toujours exister côté API',
      ).toBe(true);
    },
  );
});
