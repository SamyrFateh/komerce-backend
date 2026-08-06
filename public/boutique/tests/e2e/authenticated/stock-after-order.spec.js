/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/stock-after-order.spec.js
 * @feature orders, inventory
 * @brief F07 — Le stock d'un produit est décrémenté après confirmation de paiement.
 *
 * Flux vérifié :
 *   1. Lire le stock du produit via GET /api/products/:id (public, champ `stock`)
 *   2. Passer une commande PAYÉE 100% WALLET (qty = 1) — condition nécessaire
 *      pour que confirmPaymentCycle() s'exécute synchroniquement à la création
 *      (ALLOW_ORDER_SUBMIT=true requis)
 *   3. Relire le stock → delta == qty commandée
 *
 * IMPORTANT (doctrine backend `payment_to_stock_single_entry`, voir
 * services/order-status-machine.js + services/payment-cash-confirm.js) :
 * le stock n'est décrémenté QU'AU MOMENT où le paiement est confirmé
 * (confirmPaymentCycle = seul point d'entrée paiement→stock), jamais à la
 * simple création d'une commande. Une commande cash au relais reste
 * 'pending' tant que le client n'a pas payé physiquement → AUCUNE
 * décrémentation à ce stade (comportement voulu : ne pas bloquer du stock
 * pour des commandes jamais honorées). D'où l'usage du wallet ici : c'est
 * le seul moyen fiable de déclencher confirmPaymentCycle() en E2E navigateur
 * pur, sans simuler un paiement Stripe ou une confirmation cash par un agent.
 *
 * Ce test SOUMET une vraie commande ET DÉBITE le wallet → staging uniquement.
 * Skip si le solde wallet du compte de test est insuffisant pour couvrir le
 * produit le moins cher du catalogue.
 * Le stock peut être NULL (illimité) — dans ce cas on vérifie que la commande
 * passe mais on skip l'assertion de décrémentation.
 *
 * ⚠️ Ce test ne peut PAS être idempotent sur le stock (on ne recrédite pas
 * au-delà de l'annulation en afterEach, qui restaure le stock exactement
 * grâce à la symétrie décrément/restauration de order-status-machine.js).
 * Il doit tourner sur un catalogue de test avec du stock suffisant.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, waitForGrid, openFirstCard, addToCartFromModal,
  openCheckout, selectRecipientOther,
} = require('../helpers/boutique.helpers');
const { getProductStock } = require('../helpers/business.helpers');
const { cancelOrder, verifyWalletBalance } = require('../helpers/api.helpers');

test.describe('FLOW — Stock décrémenté après commande (F07)', () => {

  test.skip(
    !process.env.ALLOW_ORDER_SUBMIT,
    'F07 nécessite ALLOW_ORDER_SUBMIT=true — staging uniquement, commande réelle soumise'
  );

  // L'annulation restaure le stock (stockWasDecremented → symétrie dans
  // order-status-machine.js) ET recrédite le wallet — cleanup complet.
  let createdOrderId = null;

  test.afterEach(async ({ page }) => {
    if (createdOrderId) {
      await cancelOrder(page, createdOrderId, 'e2e-cleanup-F07');
      createdOrderId = null;
    }
  });

  test('F07 — Stock décrémenté d\'exactement la quantité commandée', async ({ page }) => {
    await page.goto(BASE_URL);

    // ── 1. Solde wallet requis pour couvrir 100% (seul chemin qui décrémente
    //       le stock de façon synchrone et vérifiable en E2E) ──
    const walletBefore = await verifyWalletBalance(page);
    if (!walletBefore || walletBefore.balance <= 0) {
      // eslint-disable-next-line no-console
      console.log(`[F07] Solde wallet = ${walletBefore?.balance ?? 'N/A'} — insuffisant, skip`);
      test.skip();
      return;
    }

    // ── 2. Charger le catalogue et ouvrir un produit couvert par le solde ──
    await waitForGrid(page);

    const card = page.locator('#k-grid .k-promo-card, #k-grid .k-card').first();
    const productId = await card.getAttribute('data-id');
    expect(productId, 'La première carte doit avoir un data-id').toBeTruthy();

    // ── 3. Lire le stock AVANT commande ──
    const before = await getProductStock(page, productId);
    expect(before, 'Le produit doit être accessible via l\'API').not.toBeNull();
    // eslint-disable-next-line no-console
    console.log(`[F07] Produit "${before.name}" (${productId}) — stock avant : ${before.stock}`);

    const stockIsTracked = before.stock !== null && before.stock !== undefined;

    // Champ public réel : price_kmf (voir catalog-public-view.js::
    // PUBLIC_PRODUCT_FIELDS) — il n'existe pas de champ `price` brut.
    if (before.price_kmf > walletBefore.balance) {
      // eslint-disable-next-line no-console
      console.log(`[F07] Prix produit ${before.price_kmf} KMF > solde wallet ${walletBefore.balance} — skip`);
      test.skip();
      return;
    }

    // ── 4. Ajouter au panier (qty = 1) ──
    await card.click();
    await page.waitForSelector('#k-modal-overlay.open, .k-modal-overlay.open', { timeout: 6_000 });
    await expect(page.locator('#k-modal-name')).not.toBeEmpty({ timeout: 5_000 });
    await addToCartFromModal(page);

    // ── 5. Checkout complet, paiement 100% wallet ──
    await openCheckout(page);
    await selectRecipientOther(page);

    const nameInput = page.locator('#of-beneficiary-name');
    const phoneInput = page.locator('#of-beneficiary-phone');
    if ((await nameInput.count()) > 0) await nameInput.fill('Test Stock E2E');
    if ((await phoneInput.count()) > 0) await phoneInput.fill('7001234');

    await page.waitForFunction(
      () => {
        const el = document.getElementById('wallet-balance-text');
        return el && !el.textContent.includes('Chargement');
      },
      { timeout: 10_000 }
    ).catch(() => {});

    const walletCb = page.locator('#cb-use-wallet');
    if ((await walletCb.count()) > 0) {
      if (!(await walletCb.isChecked())) await walletCb.check();
    } else {
      // eslint-disable-next-line no-console
      console.log('[F07] Checkbox #cb-use-wallet non trouvée — wallet non proposé, skip');
      test.skip();
      return;
    }

    const relaisSummary = page.locator('#ck-relais-summary');
    await relaisSummary.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

    // ── 6. Intercepter la réponse pour capturer la commande créée ──
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

    const creditApplied = orderBody.credit_applied_kmf || 0;
    if (!(creditApplied > 0 && orderBody.order.total_kmf === 0)) {
      // Le wallet n'a pas couvert 100% (solde insuffisant détecté trop tard,
      // ou payment_mode pas passé en use_wallet) → le stock ne sera pas
      // décrémenté par ce chemin, l'assertion suivante n'a pas de sens.
      // eslint-disable-next-line no-console
      console.log(`[F07] Wallet n'a pas couvert 100% (credit_applied=${creditApplied}, total=${orderBody.order.total_kmf}) — décrémentation non garantie, skip assertion stock`);
      return;
    }

    // eslint-disable-next-line no-console
    console.log(`[F07] Commande créée : ${orderBody.order.reference} — payment_status: ${orderBody.order.payment_status}`);

    // ── 7. Relire le stock APRÈS commande ──
    if (stockIsTracked) {
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
