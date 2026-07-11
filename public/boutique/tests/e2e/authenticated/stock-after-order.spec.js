/**
 * @e2e   authenticated/stock-after-order.spec.js
 * @feature orders, inventory
 * @brief F07 — Le stock d'un produit est décrémenté après une commande réelle.
 *
 * Flux vérifié :
 *   1. Lire le stock du produit via GET /api/products/:id (public, champ `stock`)
 *   2. Passer une commande cash avec qty = 1 (ALLOW_ORDER_SUBMIT=true requis)
 *   3. Relire le stock → delta == qty commandée
 *
 * Ce test SOUMET une vraie commande → staging uniquement (ALLOW_ORDER_SUBMIT).
 * Le stock peut être NULL (illimité) — dans ce cas on vérifie que la commande
 * passe mais on skip l'assertion de décrémentation.
 *
 * ⚠️ Ce test ne peut PAS être idempotent sur le stock (on ne recrédite pas).
 * Il doit tourner sur un catalogue de test avec du stock suffisant.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, waitForGrid, openFirstCard, addToCartFromModal,
  openCheckout, selectRecipientOther,
} = require('../helpers/boutique.helpers');
const { getProductStock } = require('../helpers/business.helpers');
const { cancelOrder } = require('../helpers/api.helpers');

test.describe('FLOW — Stock décrémenté après commande (F07)', () => {

  test.skip(
    !process.env.ALLOW_ORDER_SUBMIT,
    'F07 nécessite ALLOW_ORDER_SUBMIT=true — staging uniquement, commande réelle soumise'
  );

  // Sans cleanup, la commande cash 'pending' reste orpheline ET le stock
  // décrémenté n'est jamais restauré (transitionOrderStatus vers 'cancelled'
  // restaure le stock — voir routes/orders/cancel.js). Sans ça, chaque run
  // de ce test épuise un peu plus le stock du produit de test en staging.
  let createdOrderId = null;

  test.afterEach(async ({ page }) => {
    if (createdOrderId) {
      await cancelOrder(page, createdOrderId, 'e2e-cleanup-F07');
      createdOrderId = null;
    }
  });

  test('F07 — Stock décrémenté d\'exactement la quantité commandée', async ({ page }) => {
    // ── 1. Charger le catalogue et ouvrir un produit ──
    await page.goto(BASE_URL);
    await waitForGrid(page);

    const card = page.locator('#k-grid .k-promo-card, #k-grid .k-card').first();
    const productId = await card.getAttribute('data-id');
    expect(productId, 'La première carte doit avoir un data-id').toBeTruthy();

    // ── 2. Lire le stock AVANT commande ──
    const before = await getProductStock(page, productId);
    expect(before, 'Le produit doit être accessible via l\'API').not.toBeNull();
    // eslint-disable-next-line no-console
    console.log(`[F07] Produit "${before.name}" (${productId}) — stock avant : ${before.stock}`);

    const stockIsTracked = before.stock !== null && before.stock !== undefined;

    // ── 3. Ajouter au panier (qty = 1) ──
    await card.click();
    await page.waitForSelector('#k-modal-overlay.open, .k-modal-overlay.open', { timeout: 6_000 });
    await expect(page.locator('#k-modal-name')).not.toBeEmpty({ timeout: 5_000 });
    await addToCartFromModal(page);

    // ── 4. Checkout complet → soumission réelle ──
    await openCheckout(page);

    await selectRecipientOther(page);

    const TEST_BENEFICIARY_PHONE = '7001234';
    const nameInput = page.locator('#of-beneficiary-name');
    const phoneInput = page.locator('#of-beneficiary-phone');
    if ((await nameInput.count()) > 0) await nameInput.fill('Test Stock E2E');
    if ((await phoneInput.count()) > 0) await phoneInput.fill(TEST_BENEFICIARY_PHONE);

    // Cash est coché par défaut — attendre le relais auto
    const relaisSummary = page.locator('#ck-relais-summary');
    await relaisSummary.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

    // ── 5. Intercepter la réponse pour capturer la commande créée ──
    const orderResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/orders') && resp.request().method() === 'POST',
      { timeout: 20_000 }
    );

    const confirmBtn = page.locator('#btn-confirm-order');
    await expect(confirmBtn).toBeEnabled({ timeout: 15_000 });
    await confirmBtn.click();

    const orderResp = await orderResponsePromise;
    const orderBody = await orderResp.json().catch(() => null);
    expect(orderResp.status(), 'La commande doit être créée (201)').toBe(201);
    expect(orderBody?.order?.reference, 'La réponse doit contenir une référence').toBeTruthy();
    if (orderBody?.order?.id) {
      createdOrderId = orderBody.order.id; // pour le cleanup en afterEach
    }

    // eslint-disable-next-line no-console
    console.log(`[F07] Commande créée : ${orderBody.order.reference}`);

    // ── 6. Relire le stock APRÈS commande ──
    if (stockIsTracked) {
      // Petit délai pour laisser le backend décrémenter (synchrone normalement,
      // mais un éventuel trigger async ou queue pourrait retarder)
      await page.waitForTimeout(1_000);

      const after = await getProductStock(page, productId);
      expect(after, 'Le produit doit toujours être accessible').not.toBeNull();

      // eslint-disable-next-line no-console
      console.log(`[F07] Stock après : ${after.stock} (attendu : ${before.stock - 1})`);

      expect(
        after.stock,
        `Le stock doit avoir diminué de 1 (avant=${before.stock}, après=${after.stock})`
      ).toBe(before.stock - 1);
    } else {
      // eslint-disable-next-line no-console
      console.log('[F07] Stock NULL (illimité) — décrémentation non vérifiable, commande validée');
    }
  });
});
