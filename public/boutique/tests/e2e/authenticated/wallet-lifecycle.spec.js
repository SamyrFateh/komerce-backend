/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/wallet-lifecycle.spec.js
 * @feature wallet, orders, refunds
 * @brief Cycle de vie complet wallet : F02 (paiement) → F03 (annulation) → F11 (solde vérifié).
 *
 * Ce test résout le problème de dépendance circulaire entre F02 et F03 en
 * les enchaînant dans un seul scénario séquentiel :
 *
 *   1. Partir d'un panier local vide et lire le prix réel du produit choisi
 *   2. Provisionner le wallet via une session admin canonique staging
 *   3. Passer une commande avec use_wallet=true → payment_status='paid'
 *   4. Vérifier que le solde a baissé (F02)
 *   5. Annuler cette commande → wallet re-crédité (F03)
 *   6. Vérifier que le solde est revenu au niveau provisionné (F11)
 *
 * C'est le test le plus complet du cycle wallet : il vérifie la cohérence
 * financière de bout en bout (débit + crédit = solde inchangé).
 *
 * ⚠️ Staging uniquement. Nécessite ALLOW_ORDER_SUBMIT + ALLOW_ORDER_CANCEL
 *    + TEST_ADMIN_PASSWORD (+ TEST_ADMIN_EMAIL optionnel).
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
const { getOrderByRef } = require('../helpers/business.helpers');
const { provisionTestWalletViaAdmin } = require('../helpers/wallet-provision.helpers');

const API_BASE = (process.env.BASE_URL || 'http://localhost:3000/boutique/').replace('/boutique/', '');

test.describe('FLOW — Cycle de vie wallet complet (F02 → F03 → F11)', () => {
  let createdOrderId = null;

  test.beforeAll(async () => {
    await assertMutantTargetSafe(); // [R5][FAIL-CLOSED]
    if (!process.env.ALLOW_ORDER_SUBMIT || !process.env.ALLOW_ORDER_CANCEL) {
      throw new Error(
        '[R5] wallet-lifecycle nécessite ALLOW_ORDER_SUBMIT=true ET ALLOW_ORDER_CANCEL=true — ' +
        'staging uniquement. Ce test ne peut pas être skippé.'
      );
    }
  });

  test.afterEach(async ({ page }) => {
    if (createdOrderId) {
      const ok = await cancelOrder(page, createdOrderId, 'e2e-cleanup-wallet-lifecycle');
      expect(ok, 'Le cleanup lifecycle doit annuler/rembourser toute commande résiduelle').toBe(true);
      createdOrderId = null;
    }
  });

  // Timeout élevé : le cycle complet enchaîne commande + annulation
  test.setTimeout(90_000);

  test('Wallet lifecycle : paiement → annulation → solde restauré', async ({ page }) => {
    await page.goto(BASE_URL);

    // Partir d'un panier local déterministe : aucun article résiduel d'un run
    // précédent ne doit participer au débit/remboursement observé.
    await page.evaluate(() => {
      localStorage.removeItem('kmrc_cart');
      sessionStorage.removeItem('kmrc_share');
    });
    await page.reload();

    const session = await verifySession(page);
    expect(session.authenticated, 'Session active requise').toBe(true);

    // ════════════════════════════════════════════════════════════════════════
    //  ÉTAPE 0 — Produit réel + provisionnement déterministe
    // ════════════════════════════════════════════════════════════════════════

    await waitForGrid(page);
    await openFirstCard(page);

    const priceText = await page.locator('#k-modal-price, .k-modal-price').first().textContent().catch(() => '');
    const priceMatch = priceText.match(/[\d\s]+/);
    const estimatedPrice = priceMatch ? parseInt(priceMatch[0].replace(/\s/g, ''), 10) : 0;
    expect(estimatedPrice, 'Le prix réel du produit doit être lisible').toBeGreaterThan(0);

    // Prix produit + marge pour transport/frais éventuels, sans plafond arbitraire.
    const targetBalance = Math.max(100_000, estimatedPrice + 100_000);
    const provisionedWallet = await provisionTestWalletViaAdmin(page, targetBalance);
    const initialBalance = provisionedWallet.balance;
    expect(initialBalance, '[R5] Solde wallet insuffisant après provisionnement').toBeGreaterThanOrEqual(targetBalance);
    // eslint-disable-next-line no-console
    console.log(`[LIFECYCLE] Produit ~${estimatedPrice} KMF — wallet provisionné à ${initialBalance} KMF`);

    // ════════════════════════════════════════════════════════════════════════
    //  ÉTAPE 1 — F02 : Commande payée wallet
    // ════════════════════════════════════════════════════════════════════════

    await addToCartFromModal(page);
    await openCheckout(page);
    await selectRecipientOther(page);

    const nameInput = page.locator('#of-beneficiary-name');
    const phoneInput = page.locator('#of-beneficiary-phone');
    if ((await nameInput.count()) > 0) await nameInput.fill('Test Lifecycle E2E');
    if ((await phoneInput.count()) > 0) await phoneInput.fill('7005555');

    await page.waitForFunction(
      () => {
        const el = document.getElementById('wallet-balance-text');
        return el && !el.textContent.includes('Chargement');
      },
      { timeout: 10_000 }
    ).catch(() => {});

    const walletCb = page.locator('#cb-use-wallet');
    if ((await walletCb.count()) === 0) {
      throw new Error('[R5][LIFECYCLE] Checkbox #cb-use-wallet absente — wallet non proposé au checkout malgré provisionnement');
    }
    if (!(await walletCb.isChecked())) await walletCb.check();

    await page.locator('#ck-relais-summary').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

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
    expect(orderBody?.order?.id, 'La commande lifecycle doit exposer son id').toBeTruthy();

    const order = orderBody.order;
    createdOrderId = order.id;
    const creditApplied = Number(orderBody.credit_applied_kmf || 0);
    const ref = order.reference;
    // eslint-disable-next-line no-console
    console.log(`[LIFECYCLE] Commande ${ref} créée — credit: ${creditApplied} KMF, payment: ${order.payment_status}`);

    expect(creditApplied, 'Le wallet doit être réellement débité').toBeGreaterThan(0);
    expect(order.total_kmf, 'Wallet 100% → reste à payer nul').toBe(0);
    expect(order.payment_status, 'Wallet 100% → payment_status=paid').toBe('paid');

    await page.goto(BASE_URL);
    const walletAfterOrder = await verifyWalletBalance(page);
    const afterOrderBalance = walletAfterOrder?.balance ?? 0;
    // eslint-disable-next-line no-console
    console.log(`[LIFECYCLE] Solde après commande : ${afterOrderBalance} KMF (attendu: ${initialBalance - creditApplied})`);

    expect(
      afterOrderBalance,
      'Le solde doit avoir diminué du crédit appliqué'
    ).toBe(initialBalance - creditApplied);

    // ════════════════════════════════════════════════════════════════════════
    //  ÉTAPE 2 — F03 : Annulation avec remboursement
    // ════════════════════════════════════════════════════════════════════════

    const cancelResult = await page.evaluate(async (args) => {
      try {
        const resp = await fetch(
          new URL(`/api/orders/${args.orderId}/cancel`, args.base).href,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ reason: 'e2e-lifecycle-test' }),
          }
        );
        const body = await resp.json().catch(() => ({}));
        return { status: resp.status, body };
      } catch (e) { return { status: 0, error: e.message }; }
    }, { orderId: order.id, base: API_BASE });

    expect(cancelResult.status, 'L\'annulation doit réussir (200)').toBe(200);
    createdOrderId = null; // annulation nominale effectuée, plus de cleanup de secours nécessaire
    // eslint-disable-next-line no-console
    console.log(`[LIFECYCLE] Annulation ${ref} → ${cancelResult.status}`);

    const cancelledOrder = await getOrderByRef(page, ref);
    expect(cancelledOrder, 'La commande annulée doit rester relisible').toBeTruthy();
    expect(cancelledOrder.status, 'Statut doit être cancelled').toBe('cancelled');

    // ════════════════════════════════════════════════════════════════════════
    //  ÉTAPE 3 — F11 : Solde wallet restauré
    // ════════════════════════════════════════════════════════════════════════

    await page.waitForTimeout(1_000);

    const walletFinal = await verifyWalletBalance(page);
    const finalBalance = walletFinal?.balance ?? 0;
    // eslint-disable-next-line no-console
    console.log(`[LIFECYCLE] Solde final : ${finalBalance} KMF (attendu: ${initialBalance})`);

    expect(
      finalBalance,
      `Le solde wallet doit être restauré au niveau initial (${initialBalance} KMF)`
    ).toBe(initialBalance);

    // eslint-disable-next-line no-console
    console.log(`[LIFECYCLE] ✅ Cycle complet validé : ${initialBalance} → ${afterOrderBalance} → ${finalBalance} KMF`);
  });
});
