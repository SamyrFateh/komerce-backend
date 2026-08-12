/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 *
 * Parcours nominal liste partagée : lien reçu (WhatsApp/WebView) ->
 * navigateur externe neuf -> reload. Le lien doit rester autosuffisant :
 * aucun sessionStorage/cookie préalable ne doit être nécessaire pour
 * reconstruire la même liste depuis le backend.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const {
  BASE_URL,
  waitForGrid,
  addToCartFromModal,
  closeModal,
  openCartDrawer,
} = require('../helpers/boutique.helpers');
const {
  getClientShareState,
  cancelAnyActiveSharedCart,
} = require('../helpers/api.helpers');
const { getSharePageUrl } = require('../helpers/business.helpers');

function stubShareChannels(page) {
  return page.evaluate(() => {
    window.open = () => null;
    try {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async () => {},
      });
    } catch (_) {}
  });
}

async function createSharedList(page) {
  await waitForGrid(page);

  const card = page.locator('#k-grid .k-promo-card, #k-grid .k-card').first();
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.click();
  await page.waitForSelector('#k-modal-overlay.open, .k-modal-overlay.open', {
    timeout: 6_000,
  });
  await addToCartFromModal(page);
  await closeModal(page);

  await openCartDrawer(page);
  const shareBtn = page.locator('#k-cart-share:visible, #k-sc-share:visible').first();
  await expect(shareBtn).toBeVisible({ timeout: 10_000 });
  await stubShareChannels(page);
  await shareBtn.click();

  const createBtn = page.getByRole('button', {
    name: 'Créer la liste',
    exact: true,
  });
  await expect(createBtn).toBeVisible({ timeout: 10_000 });
  await createBtn.click();

  await page.waitForFunction(
    () => !!sessionStorage.getItem('kmrc_share'),
    { timeout: 15_000 },
  );

  const shareState = await getClientShareState(page);
  expect(shareState?.token, 'La liste créée doit exposer un token de partage').toBeTruthy();
  return shareState.token;
}

function participantRows(page) {
  return page.locator(
    '#k-side-cart .k-cart-snapshot-item, #k-cart-body .k-cart-snapshot-item',
  );
}

test.describe('FLOW — entrée nominale par lien partagé (WhatsApp)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.skip(
    !process.env.ALLOW_GROUP_FLOW,
    'Ce flow crée une vraie liste sur staging — ALLOW_GROUP_FLOW=true requis',
  );

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await cancelAnyActiveSharedCart(page);
    await page.reload();
  });

  test.afterEach(async ({ page }) => {
    await cancelAnyActiveSharedCart(page);
  });

  test('F22-LINK-1 — WebView WhatsApp -> navigateur externe neuf -> reload conserve exactement la liste reçue', async ({ page, browser }) => {
    const token = await createSharedList(page);
    const shareUrl = getSharePageUrl(token);

    // 1) Simulation WebView WhatsApp : contexte anonyme et mobile, sans état
    // préalable. Le clic sur le lien doit charger directement la liste.
    const webviewContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: 'fr-FR',
    });
    await webviewContext.clearCookies();
    const webviewPage = await webviewContext.newPage();

    // 2) Simulation « Ouvrir dans Chrome/Safari » : nouveau contexte
    // navigateur, donc aucun sessionStorage du WebView ne peut être partagé.
    const externalContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: 'fr-FR',
    });
    await externalContext.clearCookies();
    const externalPage = await externalContext.newPage();

    try {
      const webviewPublic = webviewPage.waitForResponse(
        (r) => r.url().includes(`/api/shared-carts/public/${token}`)
          && r.request().method() === 'GET',
        { timeout: 15_000 },
      );

      await webviewPage.goto(shareUrl);
      const webviewResponse = await webviewPublic;
      expect(webviewResponse.status()).toBe(200);
      const webviewPayload = await webviewResponse.json();
      expect(webviewPayload.is_creator).toBe(false);

      await expect(participantRows(webviewPage)).toHaveCount(1, { timeout: 10_000 });
      await expect(webviewPage.locator('#k-cart-drawer')).toHaveClass(/open/);

      // Invariant transport : l'URL visible reste porteuse du token. Si le
      // WebView la transmet au navigateur externe, elle suffit à elle seule.
      const handoffUrl = webviewPage.url();
      expect(handoffUrl).toContain(`p=${token}`);

      const externalPublic = externalPage.waitForResponse(
        (r) => r.url().includes(`/api/shared-carts/public/${token}`)
          && r.request().method() === 'GET',
        { timeout: 15_000 },
      );

      await externalPage.goto(handoffUrl);
      const externalResponse = await externalPublic;
      expect(externalResponse.status()).toBe(200);
      const externalPayload = await externalResponse.json();
      expect(externalPayload.is_creator).toBe(false);

      await expect(participantRows(externalPage)).toHaveCount(1, { timeout: 10_000 });
      await expect(externalPage.locator('#k-cart-drawer')).toHaveClass(/open/);
      expect(externalPage.url()).toContain(`p=${token}`);

      // Le reload ne doit dépendre ni de /mine ni d'un cache de l'ancien
      // navigateur : le même deep-link reste l'autorité de boot.
      const reloadPublic = externalPage.waitForResponse(
        (r) => r.url().includes(`/api/shared-carts/public/${token}`)
          && r.request().method() === 'GET',
        { timeout: 15_000 },
      );
      await externalPage.reload();
      const reloadResponse = await reloadPublic;
      expect(reloadResponse.status()).toBe(200);

      await expect(participantRows(externalPage)).toHaveCount(1, { timeout: 10_000 });
      await expect(externalPage.locator('#k-cart-drawer')).toHaveClass(/open/);
      expect(externalPage.url()).toContain(`p=${token}`);
    } finally {
      await webviewContext.close();
      await externalContext.close();
    }
  });
});
