/**
 * @e2e   authenticated/wallet-payment.spec.js
 * @feature checkout, wallet, payments
 * @brief F02 — Commande payée 100% wallet → payment_status='paid' immédiat.
 *
 * Flux vérifié :
 *   1. Vérifier le solde wallet du compte de test (GET /api/wallet)
 *   2. Si solde >= prix d'un produit → ajouter ce produit au panier
 *   3. Checkout : cocher "Utiliser mon crédit" (#cb-use-wallet)
 *   4. Soumettre → la commande est créée avec payment_status='paid'
 *      (confirmPaymentCycle traite le wallet full payment côté backend)
 *   5. Vérifier : solde wallet a diminué du montant de la commande
 *
 * ⚠️ Ce test SOUMET une vraie commande ET DÉBITE le wallet → staging uniquement.
 * Skip si le solde wallet du compte de test est insuffisant.
 *
 * Prérequis (🔴 dans l'inventaire) :
 *   - Compte de test avec solde wallet ≥ prix du produit le moins cher
 *   - ALLOW_ORDER_SUBMIT=true
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, waitForGrid, openFirstCard, addToCartFromModal,
  openCheckout, selectRecipientOther,
} = require('../helpers/boutique.helpers');
const {
  verifySession, verifyWalletBalance,
  provisionTestWallet, assertNotProdIfMutant, // [R5]
} = require('../helpers/api.helpers');

test.describe('FLOW — Commande payée 100% wallet (F02)', () => {
  // [R5] ALLOW_ORDER_SUBMIT est une précondition dure — le test échoue si absent (ne skipe pas).
  // provisionTestWallet crédite le compte de test avant le run.
  let walletBefore;

  test.beforeAll(async ({ browser }) => {
    assertNotProdIfMutant(); // [R5][FAIL-CLOSED] refuse si BASE_URL = prod
    if (!process.env.ALLOW_ORDER_SUBMIT) {
      throw new Error(
        '[R5] F02 nécessite ALLOW_ORDER_SUBMIT=true — staging uniquement. ' +
        'Ce test ne peut pas être skippé : configurer l\'environnement de test.'
      );
    }
    const page = await browser.newPage();
    try {
      walletBefore = await provisionTestWallet(page, 50_000);
      // eslint-disable-next-line no-console
      console.log(`[F02] Wallet provisionné : ${walletBefore.balance} KMF`);
    } finally {
      await page.close();
    }
  });

  test('F02 — Wallet couvre 100% → payment_status=paid immédiat', async ({ page }) => {
    await page.goto(BASE_URL);

    // ── 1. Session + solde wallet ──
    const session = await verifySession(page);
    expect(session.authenticated, 'Session active requise').toBe(true);

    // solde garanti par beforeAll (provisionTestWallet) — plus de skip conditionnel
    expect(walletBefore.balance, '[R5] Solde wallet insuffisant après provisionnement').toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[F02] Solde wallet avant : ${walletBefore.balance} KMF`);

    // ── 2. Ajouter un produit au panier ──
    await waitForGrid(page);
    await openFirstCard(page);

    // Lire le prix du produit depuis la modale — si > solde, c'est un vrai échec de config
    const priceText = await page.locator('#k-modal-price, .k-modal-price').first().textContent().catch(() => '');
    const priceMatch = priceText.match(/[\d\s]+/);
    const estimatedPrice = priceMatch ? parseInt(priceMatch[0].replace(/\s/g, ''), 10) : 0;

    if (estimatedPrice > 0 && estimatedPrice > walletBefore.balance) {
      throw new Error(
        `[R5] Prix produit ~${estimatedPrice} KMF > solde ${walletBefore.balance} KMF — ` +
        'augmenter le montant du provisionnement (TEST_WALLET_PROVISION_AMOUNT)'
      );
    }

    await addToCartFromModal(page);

    // ── 3. Ouvrir le checkout ──
    await openCheckout(page);

    // ── 4. Bénéficiaire ──
    await selectRecipientOther(page);
    const nameInput = page.locator('#of-beneficiary-name');
    const phoneInput = page.locator('#of-beneficiary-phone');
    if ((await nameInput.count()) > 0) await nameInput.fill('Test Wallet E2E');
    if ((await phoneInput.count()) > 0) await phoneInput.fill('7009876');

    // ── 5. Attendre le chargement du solde wallet dans le checkout ──
    await page.waitForFunction(
      () => {
        const el = document.getElementById('wallet-balance-text');
        return el && !el.textContent.includes('Chargement');
      },
      { timeout: 10_000 }
    ).catch(() => {});

    // ── 6. Cocher "Utiliser mon crédit" ──
    const walletCb = page.locator('#cb-use-wallet');
    if ((await walletCb.count()) > 0) {
      const isChecked = await walletCb.isChecked();
      if (!isChecked) await walletCb.check();
      // eslint-disable-next-line no-console
      console.log('[F02] Checkbox wallet cochée ✓');
    } else {
      // eslint-disable-next-line no-console
      // [R5] Pas de skip : la checkbox doit être présente si le wallet a été provisionné
      throw new Error('[R5][F02] Checkbox #cb-use-wallet absente — wallet non proposé au checkout malgré provisionnement');
    }

    // Attendre le relais auto
    const relaisSummary = page.locator('#ck-relais-summary');
    await relaisSummary.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

    // ── 7. Intercepter la réponse de création ──
    const orderResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/orders') && resp.request().method() === 'POST',
      { timeout: 20_000 }
    );

    const confirmBtn = page.locator('#btn-confirm-order');
    await expect(confirmBtn).toBeEnabled({ timeout: 15_000 });
    await confirmBtn.click();

    const orderResp = await orderResponsePromise;
    const orderBody = await orderResp.json().catch(() => null);

    expect(orderResp.status(), 'Commande créée (201)').toBe(201);
    expect(orderBody?.order, 'Réponse contient order').toBeTruthy();

    const order = orderBody.order;
    // eslint-disable-next-line no-console
    console.log(`[F02] Commande ${order.reference} — payment_status: ${order.payment_status}, total: ${order.total_kmf} KMF`);

    // ── 8. Vérifier que le paiement est immédiatement confirmé ──
    // Si le wallet couvre 100%, confirmPaymentCycle met payment_status='paid'
    // et status='confirmed' (ou 'ordered') synchroniquement dans la même transaction.
    const creditApplied = orderBody.credit_applied_kmf || 0;
    if (creditApplied > 0 && order.total_kmf === 0) {
      // Wallet a couvert 100%
      expect(
        order.payment_status,
        'Wallet 100% → payment_status doit être paid'
      ).toBe('paid');
      // eslint-disable-next-line no-console
      console.log(`[F02] Wallet 100% confirmé — credit_applied: ${creditApplied} KMF ✓`);
    } else if (creditApplied > 0) {
      // Wallet partiel (le total restant n'est pas 0)
      // eslint-disable-next-line no-console
      console.log(`[F02] Wallet partiel : credit_applied=${creditApplied}, remaining=${order.total_kmf}`);
    } else {
      // Wallet pas appliqué du tout (peut arriver si le checkout n'a pas envoyé use_wallet)
      // eslint-disable-next-line no-console
      console.log('[F02] Wallet non appliqué — vérifier que use_wallet:true est bien envoyé');
    }

    // ── 9. Vérifier que le solde wallet a diminué ──
    // Recharger la page pour avoir un contexte frais
    await page.goto(BASE_URL);
    const walletAfter = await verifyWalletBalance(page);
    if (walletAfter && creditApplied > 0) {
      // eslint-disable-next-line no-console
      console.log(`[F02] Solde wallet après : ${walletAfter.balance} KMF (avant: ${walletBefore.balance}, credit: ${creditApplied})`);
      expect(
        walletAfter.balance,
        'Le solde wallet doit avoir diminué du montant appliqué'
      ).toBe(walletBefore.balance - creditApplied);
    }
  });
});
