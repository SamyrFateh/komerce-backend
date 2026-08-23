/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/stock-after-order.spec.js
 * @feature orders, inventory
 * @brief F07 — Le stock de l'unité vendable réellement achetée est décrémenté
 *        après paiement wallet.
 *
 * Le test respecte les deux moteurs de stock canoniques :
 *   - SKU              → product_skus.stock de la sellable unit exacte ;
 *   - SIMPLE / legacy  → products.stock.
 *
 * Pour un produit SKU, products.stock est un champ legacy et DOIT rester
 * inchangé : le test vérifie explicitement cette non-mutation.
 *
 * Le test provisionne le wallet staging via une session admin canonique,
 * soumet une vraie commande payée, vérifie le delta de stock puis annule la
 * commande pour restaurer stock + wallet.
 *
 * Prérequis : ALLOW_ORDER_SUBMIT=true + ALLOW_ORDER_CANCEL=true
 *              + TEST_ADMIN_PASSWORD
 *              (+ TEST_ADMIN_EMAIL optionnel, défaut admin@komerce.km).
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
  assertMutantTargetSafe,
  getClientCart,
  verifyOrder,
} = require('../helpers/api.helpers');
const { provisionTestWalletViaAdmin } = require('../helpers/wallet-provision.helpers');

const API_BASE = BASE_URL.replace('/boutique/', '');

/**
 * Lit le Product Detail Contract public et retourne le stock canonique de
 * l'unité SKU sélectionnée. Pour un produit non-SKU, le caller utilise
 * products.stock via getProductStock().
 */
async function getSkuInventorySnapshot(page, productId, skuId) {
  return page.evaluate(async (args) => {
    try {
      const resp = await fetch(new URL(`/api/products/${args.productId}/detail`, args.base).href);
      if (!resp.ok) return null;
      const detail = await resp.json();
      if (detail.inventory_model !== 'SKU') {
        return { inventory_model: detail.inventory_model || null, unit: null };
      }
      if (!args.skuId) {
        return { inventory_model: 'SKU', unit: null, error: 'sku_id absent' };
      }
      const unit = (detail.sellable_units || []).find(
        (candidate) => String(candidate.sku_id) === String(args.skuId)
      );
      if (!unit) {
        return { inventory_model: 'SKU', unit: null, error: `sellable unit ${args.skuId} introuvable` };
      }
      return {
        inventory_model: 'SKU',
        unit: {
          sku_id: unit.sku_id,
          sku: unit.sku || null,
          stock: Number(unit.available_quantity),
          price_kmf: Number(unit.price_kmf || 0),
        },
      };
    } catch (e) {
      return { inventory_model: null, unit: null, error: e.message };
    }
  }, { productId, skuId, base: API_BASE });
}

function cartLineProductId(item) {
  return item?.product?.id ?? item?.id ?? null;
}

function cartLineSkuId(item) {
  return item?.sku_id
    ?? item?.product?.sku_id
    ?? item?.product?.selected_sku_id
    ?? null;
}

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

    // F07 doit être déterministe : aucune ligne panier résiduelle d'un run
    // précédent ne peut participer à la commande testée.
    await page.evaluate(() => localStorage.removeItem('kmrc_cart'));
    await page.reload();
    await waitForGrid(page);

    // Prendre une ligne réellement achetable via la modale. La modale résout
    // elle-même une sellable unit AVAILABLE pour les produits SKU.
    const card = page.locator('#k-grid .k-promo-card, #k-grid .k-card').first();
    const productId = await card.getAttribute('data-id');
    expect(productId, 'La première carte doit exposer data-id').toBeTruthy();

    const parentBefore = await getProductStock(page, productId);
    expect(parentBefore, 'Le produit doit être accessible via l\'API publique').not.toBeNull();

    await card.click();
    await page.waitForSelector('#k-modal-overlay.open, .k-modal-overlay.open', { timeout: 6_000 });
    await expect(page.locator('#k-modal-name')).not.toBeEmpty({ timeout: 5_000 });
    await addToCartFromModal(page);

    // Identifier l'unité exacte ajoutée : le frontend persiste sku_id dans le
    // snapshot produit de la ligne panier pour les produits SKU.
    const cart = await getClientCart(page);
    expect(cart, 'F07 doit soumettre exactement une ligne panier').toHaveLength(1);
    const cartLine = cart[0];
    expect(
      String(cartLineProductId(cartLine)),
      'La ligne panier unique doit être le produit testé'
    ).toBe(String(productId));

    const selectedSkuId = cartLineSkuId(cartLine);
    const skuBefore = await getSkuInventorySnapshot(page, productId, selectedSkuId);
    expect(skuBefore, 'Le Product Detail Contract doit être accessible').not.toBeNull();

    const isSku = skuBefore.inventory_model === 'SKU';
    let stockBefore;
    let unitPrice;

    if (isSku) {
      expect(selectedSkuId, 'Un produit SKU doit porter le sku_id sélectionné dans le panier').toBeTruthy();
      expect(skuBefore.unit, skuBefore.error || 'Sellable unit SKU introuvable').toBeTruthy();
      expect(skuBefore.unit.stock, 'Le SKU choisi doit avoir du stock').toBeGreaterThan(0);
      stockBefore = skuBefore.unit.stock;
      unitPrice = skuBefore.unit.price_kmf;
      // eslint-disable-next-line no-console
      console.log(
        `[F07] SKU "${parentBefore.name}" (${productId}) sku=${selectedSkuId} — stock avant : ${stockBefore} ; parent legacy=${parentBefore.stock}`
      );
    } else {
      expect(
        parentBefore.stock,
        `F07 nécessite un stock suivi pour le produit ${skuBefore.inventory_model || 'legacy'}`
      ).not.toBeNull();
      expect(parentBefore.stock).toBeGreaterThan(0);
      stockBefore = parentBefore.stock;
      unitPrice = Number(parentBefore.price_kmf || 0);
      // eslint-disable-next-line no-console
      console.log(`[F07] Produit legacy "${parentBefore.name}" (${productId}) — stock avant : ${stockBefore}`);
    }

    // Prix réel de l'unité + marge pour transport/frais éventuels.
    const targetBalance = Math.max(100_000, Number(unitPrice || 0) + 100_000);
    const walletBefore = await provisionTestWalletViaAdmin(page, targetBalance);
    expect(walletBefore.balance).toBeGreaterThanOrEqual(Number(unitPrice || 0));

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

    // Le contrat GET /api/orders/:id n'expose volontairement pas product_id
    // ni sku_id dans items. On vérifie donc seulement que la commande payée
    // est relisible et qu'elle contient exactement la ligne unique soumise.
    // L'identité de l'unité vendable est ensuite prouvée par le delta du stock
    // canonique mesuré sur product_skus (SKU) ou products (legacy).
    const persisted = await verifyOrder(page, createdOrderId);
    expect(persisted.exists, 'La commande créée doit être relisible').toBe(true);
    expect(persisted.items, 'La commande persistée doit contenir une ligne').toHaveLength(1);

    if (isSku) {
      const skuAfter = await getSkuInventorySnapshot(page, productId, selectedSkuId);
      expect(skuAfter?.unit, 'Le SKU doit toujours être exposé après commande').toBeTruthy();
      // eslint-disable-next-line no-console
      console.log(`[F07] Stock SKU après : ${skuAfter.unit.stock} (attendu : ${stockBefore - 1})`);
      expect(
        skuAfter.unit.stock,
        `Le stock SKU doit avoir diminué de 1 (avant=${stockBefore}, après=${skuAfter.unit.stock})`
      ).toBe(stockBefore - 1);

      // Doctrine SKU : le parent legacy n'est jamais écrit.
      const parentAfter = await getProductStock(page, productId);
      expect(parentAfter, 'Le produit parent doit rester accessible').not.toBeNull();
      expect(
        parentAfter.stock,
        'inventory_model=SKU → products.stock legacy doit rester inchangé'
      ).toBe(parentBefore.stock);
    } else {
      const parentAfter = await getProductStock(page, productId);
      expect(parentAfter, 'Le produit doit toujours être accessible').not.toBeNull();
      // eslint-disable-next-line no-console
      console.log(`[F07] Stock legacy après : ${parentAfter.stock} (attendu : ${stockBefore - 1})`);
      expect(
        parentAfter.stock,
        `Le stock produit doit avoir diminué de 1 (avant=${stockBefore}, après=${parentAfter.stock})`
      ).toBe(stockBefore - 1);
    }
  });
});
