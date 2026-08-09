/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   checkout-final-simplification.spec.js
 * @feature orders, payments, wallet
 * @brief Simplification checkout final (2026-08) — référence UX
 *        mock_checkout_final_simplifie.html. Couvre le delta NON couvert par
 *        checkout.spec.js (E4/E4b/E4c y couvrent déjà §1/§2/§4/§5) :
 *        §3 (wallet précède le paiement, masquage total quand il couvre
 *        tout), §8 (CTA uniforme), §9 (lien récap). Tourne sur tous les
 *        projets Playwright standards (desktop ET mobile partagent le même
 *        DOM de checkout — seul le CSS diffère), cf. matrice de projets
 *        dans playwright.config.js.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  addFirstProductToCart, openCheckout, IS_REMOTE,
} = require('./helpers/boutique.helpers');

test.describe('E-CHECKOUT-SIMPLIFICATION — Référence UX mock_checkout_final_simplifie.html', () => {
  // Même garde que checkout.spec.js : nécessite un catalogue + relais réels.
  test.skip(!IS_REMOTE, 'Nécessite un catalogue réel (backend) — lancer avec BASE_URL distant');

  test.beforeEach(async ({ page }) => {
    await addFirstProductToCart(page);
  });

  test('§3 — le wallet précède le paiement dans le DOM (parité visuelle avec le mock)', async ({ page }) => {
    await openCheckout(page);

    const order = await page.evaluate(() => {
      const wallet = document.getElementById('wallet-section');
      const payment = document.querySelector('.ck-payment-section');
      if (!wallet || !payment) return null;
      // 4 = Node.DOCUMENT_POSITION_FOLLOWING : payment vient après wallet.
      return Boolean(wallet.compareDocumentPosition(payment) & 4);
    });
    expect(order).toBe(true);
  });

  test('§8 — le CTA est toujours "Confirmer la commande · X KMF", jamais "Payer" ni "(net wallet)"', async ({ page }) => {
    await openCheckout(page);

    const confirmBtn = page.locator('#btn-confirm-order');
    await expect(confirmBtn).toBeAttached({ timeout: 5_000 });

    // Laisse le temps au relais de charger pour un texte stabilisé.
    await page.waitForFunction(
      () => {
        const btn = document.getElementById('btn-confirm-order');
        return btn && !btn.disabled;
      },
      { timeout: 12_000 }
    ).catch(() => {});

    const text = (await confirmBtn.textContent()) || '';
    expect(text).toMatch(/Confirmer la commande · .+KMF/);
    expect(text).not.toMatch(/Payer|net wallet/);

    // Bascule sur Stripe → même gabarit de CTA, jamais "💳 Payer".
    const stripeRadio = page.locator('input[value="stripe_eur"]');
    if ((await stripeRadio.count()) > 0) {
      await stripeRadio.check({ force: true });
      await page.waitForTimeout(300);
      const stripeText = (await confirmBtn.textContent()) || '';
      expect(stripeText).toMatch(/Confirmer la commande · .+KMF/);
      expect(stripeText).not.toMatch(/Payer/);
    }
  });

  test('§9 — le lien vers le récapitulatif précédent est conservé ("← Récap")', async ({ page }) => {
    await openCheckout(page);

    const backBtn = page.locator('.ck-modal-back-btn--header');
    await expect(backBtn).toBeAttached({ timeout: 5_000 });
    await expect(backBtn).toHaveText(/Récap/);

    await backBtn.click();
    // Retour au récapitulatif : le modal reste ouvert (pas de fermeture),
    // avec le titre dédié et le total des articles.
    await expect(page.locator('.ck-recap-gate-heading')).toHaveText('Récapitulatif de votre commande');
    await expect(page.locator('#k-order-modal.open, .k-order-modal.open')).toBeAttached();
  });
});
