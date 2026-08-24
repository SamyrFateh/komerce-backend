/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/cancel-refund.spec.js
 * @feature orders, refunds, wallet
 * @brief F03 — Annulation d'une commande payée → wallet re-crédité.
 *
 * Scénario déterministe : le test crée sa propre commande 100% wallet,
 * mesure le débit, annule exactement cette commande, puis exige la restauration
 * intégrale du solde. Il ne cherche et n'annule jamais une ancienne commande
 * du compte de test.
 *
 * ⚠️ Staging uniquement. Nécessite ALLOW_ORDER_SUBMIT + ALLOW_ORDER_CANCEL.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, waitForGrid, openFirstCard, addToCartFromModal,
  openCheckout, selectRecipientOther,
} = require('../helpers/boutique.helpers');
const {
  verifySession,
  verifyWalletBalance,
  assertMutantTargetSafe,
  cancelOrder,
} = require('../helpers/api.helpers');
const { getOrderByRef } = require('../helpers/business.helpers');
const { provisionTestWalletViaAdmin } = require('../helpers/wallet-provision.helpers');

const API_BASE = BASE_URL.replace('/boutique/', '');

test.describe('FLOW — Annulation avec remboursement wallet (F03)', () => {
  let createdOrderId = null;

  test.beforeAll(async () => {
    await assertMutantTargetSafe();
    if (!process.env.ALLOW_ORDER_SUBMIT || !process.env.ALLOW_ORDER_CANCEL) {
      throw new Error(
        '[R5] F03 nécessite ALLOW_ORDER_SUBMIT=true + ALLOW_ORDER_CANCEL=true — staging uniquement.'
      );
    }
  });

  test.afterEach(async ({ page }) => {
    if (createdOrderId) {
      const ok = await cancelOrder(page, createdOrderId, 'e2e-cleanup-F03');
      expect(ok, 'Le cleanup F03 doit annuler/rembourser la commande créée par le test').toBe(true);
      createdOrderId = null;
    }
  });

  test('F03 — Annulation commande payée → wallet re-crédité', async ({ page }) => {
    await page.goto(BASE_URL);

    const session = await verifySession(page);
    expect(session.authenticated, 'Session active requise').toBe(true);

    // Partir d'un panier personnel vide pour que la commande cible soit
    // exclusivement celle créée par ce scénario.
    await page.evaluate(() => localStorage.removeItem('kmrc_cart'));
    await page.reload();
    await waitForGrid(page);
    await openFirstCard(page);

    const priceText = await page.locator('#k-modal-price, .k-modal-price').first().textContent().catch(() => '');
    const priceMatch = priceText.match(/[\d\s]+/);
    const estimatedPrice = priceMatch ? parseInt(priceMatch[0].replace(/\s/g, ''), 10) : 0;
    expect(estimatedPrice, 'Le prix du produit F03 doit être lisible').toBeGreaterThan(0);

    const targetBalance = Math.max(100_000, estimatedPrice + 100_000);
    const walletBefore = await provisionTestWalletViaAdmin(page, targetBalance);
    const initialBalance = walletBefore.balance;
    expect(initialBalance).toBeGreaterThanOrEqual(estimatedPrice);
    // eslint-disable-next-line no-console
    console.log(`[F03] Produit ~${estimatedPrice} KMF — wallet avant : ${initialBalance} KMF`);

    await addToCartFromModal(page);
    await openCheckout(page);
    await selectRecipientOther(page);

    const nameInput = page.locator('#of-beneficiary-name');
    const phoneInput = page.locator('#of-beneficiary-phone');
    if ((await nameInput.count()) > 0) await nameInput.fill('Test Refund E2E');
    if ((await phoneInput.count()) > 0) await phoneInput.fill('7004444');

    await page.waitForFunction(
      () => {
        const el = document.getElementById('wallet-balance-text');
        return el && !el.textContent.includes('Chargement');
      },
      { timeout: 10_000 }
    ).catch(() => {});

    const walletCb = page.locator('#cb-use-wallet');
    await expect(walletCb, 'Le wallet doit être proposé après provisionnement').toHaveCount(1);
    if (!(await walletCb.isChecked())) await walletCb.check();

    await page.locator('#ck-relais-summary')
      .waitFor({ state: 'visible', timeout: 10_000 })
      .catch(() => {});

    const orderRespPromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/orders') && resp.request().method() === 'POST',
      { timeout: 20_000 }
    );

    const confirmBtn = page.locator('#btn-confirm-order');
    await expect(confirmBtn).toBeEnabled({ timeout: 15_000 });
    await confirmBtn.click();

    const orderResp = await orderRespPromise;
    const orderBody = await orderResp.json().catch(() => null);
    expect(orderResp.status(), 'Commande créée (201)').toBe(201);
    expect(orderBody?.order?.id, 'La commande F03 doit exposer son id').toBeTruthy();

    const order = orderBody.order;
    createdOrderId = order.id;
    const ref = order.reference;
    const creditApplied = Number(orderBody.credit_applied_kmf || 0);

    expect(creditApplied, 'Le wallet doit financer la commande F03').toBeGreaterThan(0);
    expect(order.total_kmf, 'Wallet 100% → reste à payer nul').toBe(0);
    expect(order.payment_status, 'Wallet 100% → payment_status=paid').toBe('paid');
    // eslint-disable-next-line no-console
    console.log(`[F03] Commande ${ref} payée — credit: ${creditApplied} KMF`);

    await page.goto(BASE_URL);
    const walletAfterOrder = await verifyWalletBalance(page);
    expect(walletAfterOrder, 'Wallet accessible après commande').toBeTruthy();
    expect(
      walletAfterOrder.balance,
      'Le wallet doit être débité exactement du crédit appliqué'
    ).toBe(initialBalance - creditApplied);

    const cancelResult = await page.evaluate(async (args) => {
      try {
        const resp = await fetch(new URL(`/api/orders/${args.orderId}/cancel`, args.base).href, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ reason: 'e2e-test-F03' }),
        });
        const body = await resp.json().catch(() => ({}));
        return { status: resp.status, body };
      } catch (e) {
        return { status: 0, error: e.message };
      }
    }, { orderId: createdOrderId, base: API_BASE });

    expect(
      cancelResult.status,
      `L'annulation F03 doit réussir (200) — reçu ${cancelResult.status}`
    ).toBe(200);

    // La commande vient d'être annulée avec succès : afterEach ne doit pas
    // refaire une deuxième mutation nominale.
    createdOrderId = null;

    const cancelledOrder = await getOrderByRef(page, ref);
    expect(cancelledOrder, 'La commande annulée doit rester accessible').not.toBeNull();
    expect(cancelledOrder.status, 'Statut après annulation').toBe('cancelled');

    const walletFinal = await verifyWalletBalance(page);
    expect(walletFinal, 'Wallet accessible après remboursement').toBeTruthy();
    expect(
      walletFinal.balance,
      `Le remboursement F03 doit restaurer le solde initial (${initialBalance} KMF)`
    ).toBe(initialBalance);

    // eslint-disable-next-line no-console
    console.log(
      `[F03] ✅ ${ref} annulée : ${initialBalance} → ${walletAfterOrder.balance} → ${walletFinal.balance} KMF`
    );
  });
});
