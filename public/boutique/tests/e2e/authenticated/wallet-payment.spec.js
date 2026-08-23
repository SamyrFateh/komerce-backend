/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/wallet-payment.spec.js
 * @feature checkout, wallet, payments
 * @brief F02 — Commande payée 100% wallet → payment_status='paid' immédiat.
 *
 * Flux vérifié :
 *   1. Provisionner le wallet du compte de test via une session admin canonique.
 *   2. Ajouter un produit couvert par le solde.
 *   3. Checkout : cocher "Utiliser mon crédit".
 *   4. Soumettre → payment_status='paid' immédiat.
 *   5. Vérifier le débit wallet.
 *   6. Annuler en cleanup → remboursement + restauration stock.
 *
 * ⚠️ Ce test SOUMET puis ANNULE une vraie commande payée → staging uniquement.
 * Prérequis : ALLOW_ORDER_SUBMIT=true + ALLOW_ORDER_CANCEL=true
 *              + TEST_ADMIN_PASSWORD
 *              (+ TEST_ADMIN_EMAIL optionnel, défaut admin@komerce.km).
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, waitForGrid, openFirstCard, addToCartFromModal,
  openCheckout, selectRecipientOther,
} = require('../helpers/boutique.helpers');
const {
  verifySession, verifyWalletBalance,
  assertMutantTargetSafe, cancelOrder,
} = require('../helpers/api.helpers');
const { provisionTestWalletViaAdmin } = require('../helpers/wallet-provision.helpers');

test.describe('FLOW — Commande payée 100% wallet (F02)', () => {
  let createdOrderId = null;

  test.beforeAll(async () => {
    await assertMutantTargetSafe();
    if (!process.env.ALLOW_ORDER_SUBMIT || !process.env.ALLOW_ORDER_CANCEL) {
      throw new Error(
        '[R5] F02 nécessite ALLOW_ORDER_SUBMIT=true + ALLOW_ORDER_CANCEL=true — staging uniquement.'
      );
    }
  });

  test.afterEach(async ({ page }) => {
    if (createdOrderId) {
      const ok = await cancelOrder(page, createdOrderId, 'e2e-cleanup-F02');
      expect(ok, 'Le cleanup F02 doit annuler/rembourser la commande payée').toBe(true);
      createdOrderId = null;
    }
  });

  test('F02 — Wallet couvre 100% → payment_status=paid immédiat', async ({ page }) => {
    await page.goto(BASE_URL);

    const session = await verifySession(page);
    expect(session.authenticated, 'Session active requise').toBe(true);

    const walletBefore = await provisionTestWalletViaAdmin(page, 50_000);
    expect(walletBefore.balance, '[R5] Solde wallet insuffisant après provisionnement').toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[F02] Solde wallet avant : ${walletBefore.balance} KMF`);

    await waitForGrid(page);
    await openFirstCard(page);

    const priceText = await page.locator('#k-modal-price, .k-modal-price').first().textContent().catch(() => '');
    const priceMatch = priceText.match(/[\d\s]+/);
    const estimatedPrice = priceMatch ? parseInt(priceMatch[0].replace(/\s/g, ''), 10) : 0;

    if (estimatedPrice > 0 && estimatedPrice > walletBefore.balance) {
      throw new Error(
        `[R5] Prix produit ~${estimatedPrice} KMF > solde ${walletBefore.balance} KMF — ` +
        'augmenter le montant du provisionnement'
      );
    }

    await addToCartFromModal(page);
    await openCheckout(page);
    await selectRecipientOther(page);

    const nameInput = page.locator('#of-beneficiary-name');
    const phoneInput = page.locator('#of-beneficiary-phone');
    if ((await nameInput.count()) > 0) await nameInput.fill('Test Wallet E2E');
    if ((await phoneInput.count()) > 0) await phoneInput.fill('7009876');

    await page.waitForFunction(
      () => {
        const el = document.getElementById('wallet-balance-text');
        return el && !el.textContent.includes('Chargement');
      },
      { timeout: 10_000 }
    ).catch(() => {});

    const walletCb = page.locator('#cb-use-wallet');
    if ((await walletCb.count()) === 0) {
      throw new Error('[R5][F02] Checkbox #cb-use-wallet absente malgré provisionnement');
    }
    if (!(await walletCb.isChecked())) await walletCb.check();

    await page.locator('#ck-relais-summary')
      .waitFor({ state: 'visible', timeout: 10_000 })
      .catch(() => {});

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
    createdOrderId = order.id || null;
    expect(createdOrderId, 'La commande F02 doit exposer son id pour cleanup').toBeTruthy();

    const creditApplied = orderBody.credit_applied_kmf || 0;
    expect(creditApplied, 'Le wallet doit être appliqué').toBeGreaterThan(0);
    expect(order.total_kmf, 'Wallet 100% → reste à payer nul').toBe(0);
    expect(order.payment_status, 'Wallet 100% → payment_status=paid').toBe('paid');

    await page.goto(BASE_URL);
    const walletAfter = await verifyWalletBalance(page);
    expect(walletAfter, 'Wallet accessible après commande').toBeTruthy();
    expect(
      walletAfter.balance,
      'Le solde wallet doit avoir diminué du montant appliqué'
    ).toBe(walletBefore.balance - creditApplied);
  });
});
