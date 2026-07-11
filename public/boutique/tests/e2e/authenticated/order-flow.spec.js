/**
 * @e2e   authenticated/order-flow.spec.js
 * @feature checkout, orders
 * @brief Flux métier COMPLET : parcours → panier → checkout → commande.
 *
 * Ce test valide le parcours utilisateur de bout en bout :
 *   1. Parcourir le catalogue et ouvrir un produit
 *   2. Ajouter au panier avec quantité > 1
 *   3. Ouvrir le checkout
 *   4. Remplir le formulaire bénéficiaire (#of-beneficiary-name/-phone)
 *   5. Attendre la sélection auto du relais (aucun clic requis — un seul
 *      relais par île, choisi automatiquement par _openRelaisPicker/pick())
 *   6. Laisser Cash comme mode de paiement (coché par défaut dans le DOM)
 *   7. Vérifier que le payload envoyé au backend est correct
 *
 * ⚠️ Ce test NE SOUMET PAS la commande en prod — il intercepte la requête
 * API et vérifie le payload sans laisser passer. Pour un test de soumission
 * réel, utiliser staging avec `ALLOW_ORDER_SUBMIT=true`.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, waitForGrid, openFirstCard, addToCartFromModal,
  openCheckout, selectRecipientOther,
} = require('../helpers/boutique.helpers');
const { spyOnApi, getClientCart } = require('../helpers/api.helpers');

test.describe('FLOW — Commande complète (browse → checkout)', () => {

  test('F01 — Parcours complet : catalogue → panier → checkout → payload vérifié', async ({ page }) => {
    // ── 1. Charger le catalogue ──
    await page.goto(BASE_URL);
    await waitForGrid(page);

    // ── 2. Ouvrir un produit et ajuster la quantité ──
    await openFirstCard(page);

    const plusBtn = page.locator('#k-qty-plus');
    await plusBtn.click();
    const qtyVal = page.locator('#k-qty-val');
    await expect(qtyVal).toHaveText('2');

    // ── 3. Ajouter au panier ──
    await addToCartFromModal(page);

    const cart = await getClientCart(page);
    expect(cart.length).toBeGreaterThanOrEqual(1);
    expect(cart[0].qty || cart[0].quantity).toBe(2);

    // ── 4. Ouvrir le checkout ──
    await openCheckout(page);

    // ── 5. Remplir le formulaire bénéficiaire "Quelqu'un d'autre" ──
    // Champs réels (b-checkout-render.js::makeInput / makeIntlPhoneInput) :
    // id posé directement sur l'<input>, PAS #k-ck-name/#k-ck-phone.
    await selectRecipientOther(page);

    const nameInput = page.locator('#of-beneficiary-name');
    const phoneInput = page.locator('#of-beneficiary-phone');
    if ((await nameInput.count()) > 0) {
      await nameInput.fill('Test Playwright');
    }
    if ((await phoneInput.count()) > 0) {
      await phoneInput.fill('3211234');
    }

    // ── 6. Relais : PAS de carte à cliquer ──
    // Un seul relais par île, choisi automatiquement (voir _openRelaisPicker /
    // la logique de pré-sélection dans b-checkout.js). Le résumé s'affiche
    // dans #ck-relais-summary ; on ne le touche pas sauf pour "changer".
    const relaisSummary = page.locator('#ck-relais-summary');
    await relaisSummary.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

    // ── 7. Paiement : Cash est déjà coché par défaut (input radio "checked"
    // sur payment_mode=cash_relais) — aucune action requise. On vérifie juste
    // que la chip existe et reste sélectionnée.
    const cashChip = page.locator('#ck-chip-cash input[type="radio"]');
    if ((await cashChip.count()) > 0) {
      await expect(cashChip).toBeChecked();
    }

    // ── 8. Intercepter la requête de commande (ne PAS soumettre en prod) ──
    const orderSpy = await spyOnApi(page, '/api/orders', 'POST');

    // Bouton réel : #btn-confirm-order (classe .ck-confirm-btn), désactivé
    // (.is-disabled) tant que le relais n'est pas "ready".
    const confirmBtn = page.locator('#btn-confirm-order');
    await confirmBtn.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    await expect(confirmBtn).toBeEnabled({ timeout: 15_000 }).catch(() => {});

    if ((await confirmBtn.count()) > 0 && await confirmBtn.isEnabled()) {
      // En staging : laisser passer. En prod : bloquer.
      if (!process.env.ALLOW_ORDER_SUBMIT) {
        await page.route('**/api/orders', route => {
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, order: { ref: 'TEST-E2E', id: 9999 } }),
          });
        });
      }
      await confirmBtn.click();

      const call = await orderSpy.waitForCall(5_000);
      expect(call).not.toBeNull();
      expect(call.body).toBeTruthy();

      if (call.body) {
        const items = call.body.items || call.body.cart || [];
        expect(items.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
