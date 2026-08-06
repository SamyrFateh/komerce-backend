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
 *   1. Lire solde wallet initial
 *   2. Passer une commande avec use_wallet=true → payment_status='paid'
 *   3. Vérifier que le solde a baissé (F02)
 *   4. Annuler cette commande → wallet re-crédité (F03)
 *   5. Vérifier que le solde est revenu au niveau initial (F11)
 *
 * C'est le test le plus complet du cycle wallet : il vérifie la cohérence
 * financière de bout en bout (débit + crédit = solde inchangé).
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
  verifySession, verifyWalletBalance,
  provisionTestWallet, assertNotProdIfMutant, // [R5]
} = require('../helpers/api.helpers');
const { getOrderByRef } = require('../helpers/business.helpers');

const API_BASE = (process.env.BASE_URL || 'http://localhost:3000/boutique/').replace('/boutique/', '');

test.describe('FLOW — Cycle de vie wallet complet (F02 → F03 → F11)', () => {
  // [R5] Préconditions dures — throw si absent, pas de skip
  let initialBalance;

  test.beforeAll(async ({ browser }) => {
    assertNotProdIfMutant(); // [R5][FAIL-CLOSED]
    if (!process.env.ALLOW_ORDER_SUBMIT || !process.env.ALLOW_ORDER_CANCEL) {
      throw new Error(
        '[R5] wallet-lifecycle nécessite ALLOW_ORDER_SUBMIT=true ET ALLOW_ORDER_CANCEL=true — ' +
        'staging uniquement. Ce test ne peut pas être skippé.'
      );
    }
    const page = await browser.newPage();
    try {
      await page.goto(BASE_URL);
      const wallet = await provisionTestWallet(page, 50_000);
      initialBalance = wallet.balance;
      // eslint-disable-next-line no-console
      console.log(`[LIFECYCLE] Wallet provisionné : ${initialBalance} KMF`);
    } finally {
      await page.close();
    }
  });

  // Timeout élevé : le cycle complet enchaîne commande + annulation
  test.setTimeout(90_000);

  test('Wallet lifecycle : paiement → annulation → solde restauré', async ({ page }) => {
    await page.goto(BASE_URL);

    // ════════════════════════════════════════════════════════════════════════
    //  ÉTAPE 0 — Préconditions (garanties par beforeAll)
    // ════════════════════════════════════════════════════════════════════════

    const session = await verifySession(page);
    expect(session.authenticated, 'Session active requise').toBe(true);
    // solde garanti par provisionTestWallet — plus de skip conditionnel
    expect(initialBalance, '[R5] Solde wallet insuffisant après provisionnement').toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[LIFECYCLE] Solde initial : ${initialBalance} KMF`);

    // ════════════════════════════════════════════════════════════════════════
    //  ÉTAPE 1 — F02 : Commande payée wallet
    // ════════════════════════════════════════════════════════════════════════

    await waitForGrid(page);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await openCheckout(page);
    await selectRecipientOther(page);

    const nameInput = page.locator('#of-beneficiary-name');
    const phoneInput = page.locator('#of-beneficiary-phone');
    if ((await nameInput.count()) > 0) await nameInput.fill('Test Lifecycle E2E');
    if ((await phoneInput.count()) > 0) await phoneInput.fill('7005555');

    // Attendre le wallet dans le checkout
    await page.waitForFunction(
      () => {
        const el = document.getElementById('wallet-balance-text');
        return el && !el.textContent.includes('Chargement');
      },
      { timeout: 10_000 }
    ).catch(() => {});

    // Cocher le wallet
    const walletCb = page.locator('#cb-use-wallet');
    if ((await walletCb.count()) === 0) {
      // eslint-disable-next-line no-console
      throw new Error('[R5][LIFECYCLE] Checkbox #cb-use-wallet absente — wallet non proposé au checkout malgré provisionnement');
    }
    if (!(await walletCb.isChecked())) await walletCb.check();

    // Attendre le relais
    await page.locator('#ck-relais-summary').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

    // Soumettre
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

    const order = orderBody.order;
    const creditApplied = orderBody.credit_applied_kmf || 0;
    const ref = order.reference;
    // eslint-disable-next-line no-console
    console.log(`[LIFECYCLE] Commande ${ref} créée — credit: ${creditApplied} KMF, payment: ${order.payment_status}`);

    if (creditApplied === 0) {
      // eslint-disable-next-line no-console
      throw new Error('[R5][LIFECYCLE] credit_applied_kmf=0 — wallet non déduit malgré provisionnement (bug checkout ?).');
    }

    // Vérifier le débit wallet
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

    // L'annulation doit passer par l'API (pas de bouton UI dans toutes les versions)
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
    // eslint-disable-next-line no-console
    console.log(`[LIFECYCLE] Annulation ${ref} → ${cancelResult.status}`);

    // Vérifier le statut
    const cancelledOrder = await getOrderByRef(page, ref);
    expect(cancelledOrder.status, 'Statut doit être cancelled').toBe('cancelled');

    // ════════════════════════════════════════════════════════════════════════
    //  ÉTAPE 3 — F11 : Solde wallet restauré
    // ════════════════════════════════════════════════════════════════════════

    await page.waitForTimeout(1_000); // laisser le remboursement se propager

    const walletFinal = await verifyWalletBalance(page);
    const finalBalance = walletFinal?.balance ?? 0;
    // eslint-disable-next-line no-console
    console.log(`[LIFECYCLE] Solde final : ${finalBalance} KMF (attendu: ${initialBalance})`);

    // Le remboursement dans la fenêtre de 24h est normalement 100%
    // Si le test tourne juste après la commande, c'est garanti dans la fenêtre
    expect(
      finalBalance,
      `Le solde wallet doit être restauré au niveau initial (${initialBalance} KMF)`
    ).toBe(initialBalance);

    // eslint-disable-next-line no-console
    console.log(`[LIFECYCLE] ✅ Cycle complet validé : ${initialBalance} → ${afterOrderBalance} → ${finalBalance} KMF`);
  });
});
