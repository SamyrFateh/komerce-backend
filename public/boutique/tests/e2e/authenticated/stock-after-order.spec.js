/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/stock-after-order.spec.js
 * @feature orders, inventory
 * @brief F07 — Le stock d'un produit est décrémenté après paiement wallet.
 *
 * Le test provisionne explicitement le wallet staging, soumet une vraie
 * commande payée, vérifie le delta de stock puis annule la commande pour
 * restaurer stock + wallet. Aucun skip conditionnel sur le solde.
 *
 * Prérequis : ALLOW_ORDER_SUBMIT=true + ALLOW_ORDER_CANCEL=true + TEST_ADMIN_TOKEN.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, waitForGrid, addToCartFromModal,
  openCheckout, selectRecipientOther,
} = require('../helpers/boutique.helpers');
const { getProductStock } = require('../helpers/business.helpers');
const {
  cancelOrder,
  provisionTestWallet,
  assertMutantTargetSafe,
} = require('../helpers/api.helpers');

test.describe('FLOW — Stock décrémenté après commande (F07)', () => {
  let createdOrderId = null;

  test.beforeAll(async () => {
    await assertMutantTargetSafe();
    if (!process.env.ALLOW_ORDER_SUBMIT || !process.env.ALLOW_ORDER_CANCEL) {
      throw new Error(
        '[R5] F07 nécessite ALLOW_ORDER_SUBMIT=true + ALLOW_ORDER_CANCEL=true — staging uniquement.'
      );
    }
  });

  test.afterEach(async ({ page }) => {
    if (createdOrderId) {
      const ok = await cancelOrder(page, createdOrderId, 'e2e-cleanup-F07');
      expect(ok, 'Le cleanup F07 doit restaurer stock + wallet').toBe(true);
      createdOrderId = null;
    }
  });

  test('F07 — Stock décrémenté d\'exactement la quantité commandée', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);

    // Trouver un produit réellement suivi en stock.
    const cards = page.locator('#k-grid .k-promo-card, #k-grid .k-card');
    const count = await cards.count();
    let selected = null;

    for (let i = 0; i < Math.min(count, 12); i += 1) {
      const card = cards.nth(i);
      const productId = await card.getAttribute('data-id');
      if (!productId) continue;
      const product = await getProductStock(page, productId);
      if (!product) continue;
      if (product.stock !== null && product.stock !== undefined && product.stock > 0) {
        selected = { card, productId, product };
        break;
      }
    }

    expect(selected, 'F07 nécessite au moins un produit avec stock fini > 0').toBeTruthy();

    const { card, productId, product: before } = selected;
    // eslint-disable-next-line no-console
    console.log(`[F07] Produit "${before.name}" (${productId}) — stock avant : ${before.stock}`);

    // Provisionner juste au-dessus du prix du produit, avec un plancher de 50k.
    const targetBalance = Math.max(50_000, Number(before.price_kmf || 0) + 5_000);
    const walletBefore = await provisionTestWallet(page, targetBalance);
    expect(walletBefore.balance).toBeGreaterThanOrEqual(Number(before.price_kmf || 0));

    await card.click();
    await page.waitForSelector('#k-modal-overlay.open, .k-modal-overlay.open', { timeout: 6_000 });
    await expect(page.locator('#k-modal-name')).not.toBeEmpty({ timeout: 5_000 });
    await addToCartFromModal(page);

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
    await expect(walletCb, 'Le wallet doit être proposé après provisionnement').toHaveCount(1);
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
    expect(orderResp.status(), 'La commande doit être créée (201)').toBe(201);
    expect(orderBody?.order?.id, 'La réponse doit contenir order.id').toBeTruthy();
    createdOrderId = orderBody.order.id;

    const creditApplied = Number(orderBody.credit_applied_kmf || 0);
    expect(creditApplied, 'Le wallet doit couvrir la commande').toBeGreaterThan(0);
    expect(orderBody.order.total_kmf, 'Wallet 100% → reste à payer nul').toBe(0);
    expect(orderBody.order.payment_status, 'Wallet 100% → paiement confirmé').toBe('paid');

    await page.waitForTimeout(1_000);
    const after = await getProductStock(page, productId);
    expect(after, 'Le produit doit toujours être accessible').not.toBeNull();

    // eslint-disable-next-line no-console
    console.log(`[F07] Stock après : ${after.stock} (attendu : ${before.stock - 1})`);
    expect(
      after.stock,
      `Le stock doit avoir diminué de 1 (avant=${before.stock}, après=${after.stock})`
    ).toBe(before.stock - 1);
  });
});
