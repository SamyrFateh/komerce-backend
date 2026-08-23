/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/group-full-cycle.spec.js
 * @feature shared-cart, group
 * @brief F21 — Créateur partage une sélection puis un participant anonyme
 *        découvre la liste dans la boutique.
 *
 * La création est immédiate : aucun formulaire, aucun mode de paiement,
 * aucune estimation. Le participant arrive par le lien public et reste dans
 * l'expérience boutique.
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
  openCartDrawer,
  clickKomerceConfirm,
} = require('../helpers/boutique.helpers');
const {
  verifySharedCart,
  getClientShareToken,
  getClientShareState,
  cancelAnyActiveSharedCart,
  spyOnApi,
} = require('../helpers/api.helpers');
const { getSharePageUrl } = require('../helpers/business.helpers');
const { assertRemoteMutantTargetSafe } = require('../helpers/environment.helpers');

test.describe('FLOW — Liste partageable, découverte publique (F21)', () => {
  test.skip(
    !process.env.ALLOW_GROUP_FLOW,
    'F21 nécessite ALLOW_GROUP_FLOW=true — staging uniquement',
  );

  test.beforeAll(async () => {
    await assertRemoteMutantTargetSafe();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await cancelAnyActiveSharedCart(page);
  });

  test.afterEach(async ({ page }) => {
    await cancelAnyActiveSharedCart(page);
  });

  test('F21 — Créateur partage → participant anonyme découvre la liste', async ({ page }) => {
    // PHASE 1 — Créateur : partager immédiatement la sélection.
    await page.goto(BASE_URL);
    await waitForGrid(page);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await openCartDrawer(page);

    await page.evaluate(() => {
      window.open = () => null;
      try {
        Object.defineProperty(navigator, 'share', {
          configurable: true,
          value: async () => {},
        });
      } catch (_) {}
    });

    const shareBtn = page.locator('#k-cart-share, #k-sc-share').first();
    await expect(shareBtn).toBeVisible({ timeout: 10_000 });

    const createSpy = await spyOnApi(
      page,
      '/api/shared-carts/from-cart-items',
      'POST',
    );

    await shareBtn.click();
    await clickKomerceConfirm(page); // É5/L7 — modale Komerce « Créer la liste »

    await expect(page.locator('#k-sm-submit')).toHaveCount(0);
    await expect(page.locator('#k-sm-title-f')).toHaveCount(0);
    await expect(page.locator('.k-sm-nature-opt')).toHaveCount(0);

    const createCall = await createSpy.waitForCall(15_000);
    expect(createCall).not.toBeNull();
    expect(createCall.body).toEqual({
      cart_items: expect.any(Array),
    });

    await page.waitForFunction(
      () => !!sessionStorage.getItem('kmrc_share'),
      { timeout: 10_000 },
    ).catch(() => {});

    const token = await getClientShareToken(page);
    expect(token, 'Le token de la liste doit être posé').toBeTruthy();

    const shareState = await getClientShareState(page);
    const cartId = shareState?.id;
    // eslint-disable-next-line no-console
    console.log(`[F21] Liste créée — token: ${token}, id: ${cartId}`);

    const apiResult = await verifySharedCart(page, token);
    expect(apiResult.exists, 'La liste doit exister côté API').toBe(true);
    if (apiResult.cart) expect(apiResult.cart.status).toBe('open');

    // PHASE 2 — Participant anonyme : le lien ouvre la boutique contextualisée.
    const participantContext = await page.context().browser().newContext({
      viewport: { width: 390, height: 844 },
      locale: 'fr-FR',
    });
    // Isolation explicite du visiteur public : le projet authenticated
    // charge le storageState du créateur, qui ne doit jamais contaminer ce
    // contexte participant (sinon GET /public/:token renvoie is_creator=true).
    await participantContext.clearCookies();
    const participantPage = await participantContext.newPage();

    try {
      const shareUrl = getSharePageUrl(token);
      const publicResponsePromise = participantPage.waitForResponse(
        (response) =>
          response.url().includes(`/api/shared-carts/public/${token}`)
          && response.request().method() === 'GET',
        { timeout: 15_000 },
      );

      await participantPage.goto(shareUrl);
      const publicResponse = await publicResponsePromise;

      expect(publicResponse.ok()).toBe(true);
      const publicList = await publicResponse.json();
      expect(publicList).toBeTruthy();
      expect(Array.isArray(publicList.items)).toBe(true);
      expect(publicList.items.length).toBeGreaterThanOrEqual(1);
      expect(publicList.is_creator, 'Le contexte participant doit rester anonyme/non créateur').toBe(false);

      // Le lien participant projette la liste dans le drawer panier canonique
      // (mandat §1/§4 — "la boutique reste affichée, la liste se projette dans
      // le side cart / drawer canonique. Aucun onglet dédié.", voir
      // js/b-nav.js::handleParticipantUrl). L'ancien onglet #k-group-view a
      // été retiré (js/b-nav.js::switchView — "l'onglet 'group' et
      // renderGroupView() ne sont plus jamais atteints"). Sur mobile
      // (viewport de ce contexte participant), le contenu est rendu dans
      // #k-cart-body via panelHtml() (js/group/group-side-cart.js) et le
      // drawer s'ouvre automatiquement (reopenSharedListCart()).
      const sharedListItems = participantPage.locator('#k-cart-body .k-cart-snapshot-item');
      await expect(sharedListItems.first()).toBeVisible({ timeout: 10_000 });

      const cartDrawer = participantPage.locator('#k-cart-drawer');
      await expect(cartDrawer).toHaveAttribute('data-mode', 'shared-list');

      const finalCheck = await verifySharedCart(page, token);
      expect(
        finalCheck.exists,
        'La liste doit rester disponible après sa découverte publique',
      ).toBe(true);
    } finally {
      await participantContext.close();
    }
  });
});