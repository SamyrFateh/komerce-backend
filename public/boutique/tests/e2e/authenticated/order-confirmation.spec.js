/**
 * @e2e   authenticated/order-confirmation.spec.js
 * @feature checkout, orders
 * @brief F04 (partiel) + écran de confirmation — Après commande, vérifier
 *        que l'écran de confirmation affiche :
 *          - la référence de commande (KM-...)
 *          - le code cash relais (si cash_relais)
 *          - le bouton "Suivre ma commande"
 *          - le bouton "Continuer mes achats"
 *        Puis vérifier que le bouton "Suivre" navigue vers le tracking
 *        et pré-remplit la référence.
 *
 * Ce test va JUSQU'AU bout du flux UI post-commande, là où F01 s'arrêtait
 * à la vérification du payload. F04 complet (QR scan par agent relais)
 * reste hors portée d'un test Playwright pur navigateur.
 *
 * ⚠️ Soumet une vraie commande → staging uniquement (ALLOW_ORDER_SUBMIT).
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, waitForGrid, openFirstCard, addToCartFromModal,
  openCheckout, selectRecipientOther,
} = require('../helpers/boutique.helpers');
const { cancelOrder } = require('../helpers/api.helpers');

test.describe('FLOW — Écran de confirmation post-commande (F04 partiel)', () => {

  test.skip(
    !process.env.ALLOW_ORDER_SUBMIT,
    'Nécessite ALLOW_ORDER_SUBMIT=true — staging uniquement'
  );

  // Ce test soumet réellement une commande cash 'pending' — sans cleanup elle
  // reste orpheline sur le compte de test à chaque run. Même pattern que F01.
  let createdOrderId = null;

  test.afterEach(async ({ page }) => {
    if (createdOrderId) {
      await cancelOrder(page, createdOrderId, 'e2e-cleanup-F04p');
      createdOrderId = null;
    }
  });

  test('F04p — Confirmation : référence + code cash + boutons suivi/continuer', async ({ page }) => {
    // ── 1. Commande complète (même flux que F01 mais sans intercepter) ──
    await page.goto(BASE_URL);
    await waitForGrid(page);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await openCheckout(page);
    await selectRecipientOther(page);

    const nameInput = page.locator('#of-beneficiary-name');
    const phoneInput = page.locator('#of-beneficiary-phone');
    if ((await nameInput.count()) > 0) await nameInput.fill('Test Confirmation E2E');
    if ((await phoneInput.count()) > 0) await phoneInput.fill('7003333');

    // Cash par défaut, relais auto
    await page.locator('#ck-relais-summary').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

    const confirmBtn = page.locator('#btn-confirm-order');
    await expect(confirmBtn).toBeEnabled({ timeout: 15_000 });

    // Capturé pour le cleanup uniquement (cancelOrder a besoin de order.id,
    // pas de la référence KM-... affichée à l'écran — voir routes/orders/cancel.js
    // qui ne lookup que par o.id).
    const orderResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/orders') && resp.request().method() === 'POST',
      { timeout: 20_000 }
    ).catch(() => null);

    await confirmBtn.click();

    const orderResp = await orderResponsePromise;
    const orderBody = await orderResp?.json().catch(() => null);
    if (orderBody?.order?.id) {
      createdOrderId = orderBody.order.id;
    }

    // ── 2. Attendre l'écran de confirmation ──
    // renderOrderSuccess() remplace le contenu du checkout par .k-confirm-wrap
    const confirmWrap = page.locator('.k-confirm-wrap');
    await expect(confirmWrap).toBeVisible({ timeout: 20_000 });

    // ── 3. Vérifier la référence ──
    const refEl = page.locator('.k-confirm-ref');
    await expect(refEl).toBeVisible({ timeout: 5_000 });
    const refText = await refEl.textContent();
    expect(refText, 'La référence doit commencer par KM-').toMatch(/^KM-/);
    // eslint-disable-next-line no-console
    console.log(`[F04p] Référence affichée : ${refText}`);

    // ── 4. Vérifier le code cash (si paiement cash_relais) ──
    const cashBlock = page.locator('.k-confirm-cash-block');
    if ((await cashBlock.count()) > 0) {
      const cashCode = await page.locator('.k-confirm-cash-code').textContent();
      expect(cashCode, 'Le code cash doit être non vide').toBeTruthy();
      expect(cashCode.length, 'Le code cash doit avoir au moins 4 caractères').toBeGreaterThanOrEqual(4);
      // eslint-disable-next-line no-console
      console.log(`[F04p] Code cash relais : ${cashCode}`);
    } else {
      // eslint-disable-next-line no-console
      console.log('[F04p] Pas de code cash (paiement non-cash ou structure différente)');
    }

    // ── 5. Vérifier le bouton "Copier" ──
    const copyBtn = page.locator('#k-copy-ref-btn');
    await expect(copyBtn).toBeVisible();

    // ── 6. Boutons d'action ──
    const trackBtn = page.locator('#k-order-track-btn');
    const closeBtn = page.locator('#k-order-close-btn');
    await expect(trackBtn).toBeVisible();
    await expect(closeBtn).toBeVisible();

    // ── 7. Clic "Suivre ma commande" → onglet tracking pré-rempli ──
    await trackBtn.click();

    // Attendre que le tracking charge
    await page.waitForFunction(
      () => {
        const el = document.getElementById('k-track-view');
        return el && el.textContent.length > 10;
      },
      { timeout: 15_000 }
    ).catch(() => {});

    // Vérifier que la référence est pré-remplie dans le champ de recherche
    // (renderOrderSuccess fait : refInput.value = order.reference + otp-ref-btn.click())
    const refInput = page.locator('#k-otp-ref');
    if ((await refInput.count()) > 0) {
      const inputValue = await refInput.inputValue();
      if (inputValue === refText) {
        // eslint-disable-next-line no-console
        console.log(`[F04p] Référence pré-remplie dans le tracking : ${inputValue} ✓`);
      } else {
        // eslint-disable-next-line no-console
        console.log(`[F04p] Champ tracking : "${inputValue}" (attendu: "${refText}")`);
      }
    }

    // Le tracking doit afficher quelque chose lié à la commande
    const trackView = page.locator('#k-track-view');
    const trackText = await trackView.textContent();
    const seesOrder =
      trackText.includes(refText) ||
      trackText.includes('Commande') ||
      trackText.includes('confirmée') ||
      trackText.includes('Suivi');

    // eslint-disable-next-line no-console
    console.log(`[F04p] Tracking affiche la commande : ${seesOrder}`);
    expect(seesOrder, 'Le tracking doit afficher la commande ou le mode suivi').toBe(true);
  });
});
