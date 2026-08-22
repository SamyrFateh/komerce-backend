/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/business-resilience.spec.js
 * @feature checkout, orders, wallet
 * @brief Robustesse des flux business réels : scénarios d'erreur qu'un vrai
 *        utilisateur rencontrerait sur son téléphone.
 *
 * Scénarios :
 *   R1 — Double clic sur "Confirmer" : pas de doublon de commande
 *   R2 — Réseau coupé pendant le checkout : erreur claire, retry possible
 *   R3 — Wallet 0 : section masquée proprement, jamais bloquée sur Chargement…
 *   R4 — Checkout avec panier vide : ouverture bloquée ou confirmation impossible
 *   R5 — Checkout canonique : aucune identité bénéficiaire distincte collectée
 *
 * Aucun de ces tests ne soumet une vraie commande : les POST /api/orders sont
 * interceptés ou bloqués lorsque le scénario atteint la soumission.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, waitForGrid, openFirstCard, addToCartFromModal,
  openCheckout,
} = require('../helpers/boutique.helpers');
const { verifySession, verifyWalletBalance } = require('../helpers/api.helpers');

/**
 * Le catalogue réel peut exposer en première position un produit simple OU un
 * produit SKU. Le runtime refuse volontairement l'ajout d'un SKU tant que tous
 * les axes [data-axis-key] ne sont pas résolus. Pour les scénarios dont la
 * variante n'est pas l'objet du test, choisir une option réellement disponible
 * par axe rend le prérequis panier déterministe sans contourner le contrat UI.
 */
async function ensureModalPurchaseReady(page) {
  const addBtn = page.locator('#k-add-cart-btn');
  if (await addBtn.isEnabled().catch(() => false)) return;

  const axes = page.locator('#k-modal-overlay [data-axis-key]');
  const axisCount = await axes.count();

  for (let i = 0; i < axisCount; i += 1) {
    const axis = axes.nth(i);
    const alreadySelected = axis.locator('button[aria-pressed="true"]');
    if ((await alreadySelected.count()) > 0) continue;

    const options = axis.locator('button[data-option-value]');
    const optionCount = await options.count();
    let chosen = false;

    for (let j = 0; j < optionCount; j += 1) {
      const option = options.nth(j);
      const optionState = String(
        (await option.getAttribute('data-option-state')) || ''
      ).toUpperCase();
      const unavailable = optionState === 'OUT_OF_STOCK'
        || optionState === 'INCOMPATIBLE';

      if (!unavailable && await option.isEnabled().catch(() => false)) {
        await option.click();
        chosen = true;
        break;
      }
    }

    if (!chosen) {
      throw new Error(
        `[E2E] Aucun choix disponible pour l'axe ${i + 1}/${axisCount}`
      );
    }
  }

  await expect(
    addBtn,
    'Le produit doit devenir achetable après sélection des options disponibles'
  ).toBeEnabled({ timeout: 5_000 });
}

async function openPurchasableFirstProduct(page) {
  await waitForGrid(page);
  await openFirstCard(page);
  await ensureModalPurchaseReady(page);
  await addToCartFromModal(page);
}

test.describe('ROBUSTESSE — Flux business edge cases', () => {

  // ─── R1 — Double clic "Confirmer" ──────────────────────────────────────────

  test('R1 — Double clic rapide sur confirmer ne crée pas de doublon', async ({ page }) => {
    await page.goto(BASE_URL);
    await openPurchasableFirstProduct(page);
    await openCheckout(page);

    await page.locator('#ck-relais-summary')
      .waitFor({ state: 'visible', timeout: 10_000 })
      .catch(() => {});

    const orderCalls = [];
    await page.route('**/api/orders*', async (route, request) => {
      if (request.method() !== 'POST') {
        await route.continue();
        return;
      }
      orderCalls.push({ timestamp: Date.now() });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          order: {
            id: 'test-r1',
            reference: 'KM-R1TEST',
            status: 'pending',
            total_kmf: 5000,
            payment_mode: 'cash_relais',
            payment_status: 'pending',
          },
        }),
      });
    });

    const confirmBtn = page.locator('#btn-confirm-order');
    await expect(confirmBtn).toBeEnabled({ timeout: 15_000 });

    // Deux événements click dans la MÊME tâche navigateur. Contrairement à
    // deux confirmBtn.click() Playwright successifs, le second ne peut pas se
    // transformer en attente d'actionability sur un bouton déjà retiré par le
    // premier succès. On teste ainsi réellement la course du handler frontend.
    await confirmBtn.evaluate((btn) => {
      btn.click();
      btn.click();
    });

    await expect
      .poll(() => orderCalls.length, {
        message: 'Le double clic doit produire exactement un POST /api/orders',
        timeout: 5_000,
      })
      .toBe(1);
  });

  // ─── R2 — Réseau coupé pendant le checkout ────────────────────────────────

  test('R2 — Coupure réseau pendant soumission → erreur claire, pas de crash', async ({ page }) => {
    await page.goto(BASE_URL);
    await openPurchasableFirstProduct(page);
    await openCheckout(page);

    await page.locator('#ck-relais-summary')
      .waitFor({ state: 'visible', timeout: 10_000 })
      .catch(() => {});

    await page.route('**/api/orders*', (route) => route.abort('connectionrefused'));

    const confirmBtn = page.locator('#btn-confirm-order');
    await expect(confirmBtn).toBeEnabled({ timeout: 15_000 });
    await confirmBtn.click();

    const toast = page.locator('#k-toast');
    await page.waitForFunction(
      () => {
        const el = document.getElementById('k-toast');
        return el && el.textContent.trim().length > 0;
      },
      { timeout: 10_000 }
    ).catch(() => {});

    const toastText = await toast.textContent().catch(() => '');
    // eslint-disable-next-line no-console
    console.log(`[R2] Toast après coupure réseau : "${toastText.trim()}"`);

    expect(
      toastText.trim().length,
      'Un message d\'erreur doit s\'afficher'
    ).toBeGreaterThan(0);

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.waitForTimeout(1_000);

    const btnDisabled = await confirmBtn.isDisabled().catch(() => true);
    const btnText = await confirmBtn.textContent().catch(() => '');
    // eslint-disable-next-line no-console
    console.log(`[R2] Bouton après erreur : disabled=${btnDisabled}, text="${btnText.trim()}"`);

    expect(btnDisabled, 'Le bouton doit se réactiver après erreur réseau').toBe(false);
  });

  // ─── R3 — Wallet solde = 0 ────────────────────────────────────────────────

  test('R3 — Wallet 0 masqué proprement, solde positif visible', async ({ page }) => {
    await page.goto(BASE_URL);

    const session = await verifySession(page);
    expect(session.authenticated, 'La session doit être active').toBe(true);

    await openPurchasableFirstProduct(page);
    await openCheckout(page);

    await page.waitForFunction(
      () => {
        const el = document.getElementById('wallet-balance-text');
        return el && !el.textContent.includes('Chargement');
      },
      { timeout: 10_000 }
    );

    const wallet = await verifyWalletBalance(page);
    const walletSection = page.locator('#wallet-section');
    const balanceText = await page.locator('#wallet-balance-text').textContent();

    expect(balanceText, 'Le wallet ne doit jamais rester sur Chargement').not.toContain('Chargement');
    expect(balanceText, 'Le solde ne doit pas contenir NaN').not.toContain('NaN');
    expect(balanceText, 'Le solde ne doit pas contenir undefined').not.toContain('undefined');

    if (wallet && wallet.balance > 0) {
      await expect(walletSection).toBeVisible();
      expect(balanceText).toContain('Solde disponible');
    } else {
      await expect(walletSection).toBeHidden();
      expect(balanceText).toContain('Aucun crédit disponible');
    }
  });

  // ─── R4 — Checkout avec panier vide ────────────────────────────────────────

  test('R4 — Impossible d\'ouvrir le checkout avec un panier vide', async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForGrid(page);

    await page.evaluate(() => {
      localStorage.removeItem('kmrc_cart');
    });
    await page.reload();
    await waitForGrid(page);

    const checkoutOpened = await page.evaluate(() => {
      if (window.__bus) {
        window.__bus.emit('checkout:open');
        return true;
      }
      return false;
    });

    if (checkoutOpened) {
      await page.waitForTimeout(1_000);

      const orderModal = page.locator('#k-order-modal.open, .k-order-modal.open');
      const isOpen = (await orderModal.count()) > 0;

      if (isOpen) {
        const confirmBtn = page.locator('#btn-confirm-order');
        if ((await confirmBtn.count()) > 0) {
          const disabled = await confirmBtn.isDisabled();
          expect(
            disabled,
            'Un checkout vide ouvert défensivement ne doit jamais être confirmable'
          ).toBe(true);
        }
      }
    }
  });

  // ─── R5 — Identité de retrait canonique ────────────────────────────────────

  test('R5 — Checkout ne collecte aucune identité bénéficiaire distincte', async ({ page }) => {
    await page.goto(BASE_URL);
    await openPurchasableFirstProduct(page);
    await openCheckout(page);

    await expect(page.locator('.ck-recip-seg')).toHaveCount(0);
    await expect(page.locator('#of-beneficiary-name')).toHaveCount(0);
    await expect(page.locator('#of-beneficiary-phone')).toHaveCount(0);

    const secureNotice = page.locator('.ck-secure-pickup-notice').first();
    await expect(secureNotice).toBeVisible();
    await expect(secureNotice).toContainText(/WhatsApp|Retrait sécurisé/i);
  });
});
