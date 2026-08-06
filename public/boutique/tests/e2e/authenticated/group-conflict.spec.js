/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/group-conflict.spec.js
 * @feature shared-cart, group
 * @brief F24 — Conflit d'achat sur une ligne de liste partagée (mandat §5/§10).
 *
 * Scénario réel, deux comptes de test DISTINCTS :
 *   1. Le compte de test principal (TEST_ACCOUNT_PHONE / storageState
 *      playwright/.auth/user.json) crée une liste avec un seul article et
 *      tente de l'acheter (buyer A — l'organisateur peut acheter sa propre
 *      liste, aucune restriction trouvée côté backend).
 *   2. Un second compte de test (playwright/.auth/user2.json — voir
 *      "comment créer d'autres comptes de tests", OTP_TEST_MODE côté
 *      serveur) ouvre le même lien et tente d'acheter la même ligne
 *      (buyer B), au même moment.
 *   3. Un seul des deux achats doit réussir (le premier commit gagne —
 *      index unique order_items_shared_cart_item_id_unique, migration 123),
 *      l'autre doit recevoir le conflit dédié (code
 *      shared_cart_item_already_claimed, 409) et voir le message
 *      "Cet article vient d'être acheté…" plutôt qu'une erreur générique.
 *   4. La ligne doit ensuite apparaître "Déjà acheté" pour l'acheteur perdant
 *      (rafraîchissement automatique via handleSharedListPurchaseConflict,
 *      voir js/group/group-side-cart.js).
 *
 * ⚠️ LIMITATION ASSUMÉE : les deux clics de confirmation sont déclenchés en
 * parallèle (Promise.all) mais restent soumis à la latence réseau réelle —
 * ce n'est pas une garantie de simultanéité au sens strict, seulement une
 * course best-effort. La preuve stricte de l'arbitrage par contrainte
 * unique (deux INSERT vraiment concurrents dans la même fenêtre de temps)
 * est déjà apportée par le test PostgreSQL direct (tests/integration/
 * v2e-shared-cart-checkout.test.js, scénario 2). Ce test-ci vérifie en plus
 * la réaction UI réelle (message, rafraîchissement, "Déjà acheté"), que le
 * test PostgreSQL ne peut pas couvrir.
 *
 * Prérequis :
 *   - playwright/.auth/user.json  (compte de test principal, posé par le
 *     projet "setup" / auth.setup.js)
 *   - playwright/.auth/user2.json (second compte de test, à créer une fois :
 *     TEST_ACCOUNT_PHONE=<autre numéro> TEST_ACCOUNT_OTP=424242
 *     npx playwright test --project=setup
 *     puis copier playwright/.auth/user.json vers playwright/.auth/user2.json
 *     AVANT de relancer setup avec le premier compte, ou utiliser un
 *     répertoire de session séparé — voir échange de conversation)
 *
 * ⚠️ Ce test CRÉE une vraie liste et une vraie commande cash (statut
 * 'pending', jamais payée) → staging uniquement (ALLOW_GROUP_FLOW).
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const {
  BASE_URL,
  waitForGrid,
  openFirstCard,
  addToCartFromModal,
  closeModal,
  openCartDrawer,
} = require('../helpers/boutique.helpers');
const {
  getClientShareState,
  cancelAnyActiveSharedCart,
  verifySharedCart,
  cancelOrder,
} = require('../helpers/api.helpers');
const { getSharePageUrl } = require('../helpers/business.helpers');

const USER2_STATE_PATH = path.join(__dirname, '..', '..', '..', 'playwright', '.auth', 'user2.json');

test.describe('FLOW — Conflit d\'achat sur une liste partagée (F24)', () => {
  test.skip(
    !process.env.ALLOW_GROUP_FLOW,
    'F24 nécessite ALLOW_GROUP_FLOW=true — staging uniquement',
  );
  test.skip(
    !fs.existsSync(USER2_STATE_PATH),
    'F24 nécessite un second compte de test : playwright/.auth/user2.json absent. ' +
      'Voir le commentaire en tête de ce fichier pour le créer.',
  );

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await cancelAnyActiveSharedCart(page);
  });

  test.afterEach(async ({ page }) => {
    await cancelAnyActiveSharedCart(page);
  });

  test('F24 — deux comptes ciblent la même ligne : un seul achat réussit, l\'autre voit "Déjà acheté"', async ({ page, browser }) => {
    const createdOrderIds = [];

    try {
      // ── PHASE 1 — Créer une liste à un seul article (compte principal) ──
      await page.goto(BASE_URL);
      await waitForGrid(page);
      await openFirstCard(page);
      await addToCartFromModal(page);
      await closeModal(page);
      await openCartDrawer(page);

      const shareBtn = page.locator('#k-cart-share, #k-sc-share').first();
      await expect(shareBtn).toBeVisible({ timeout: 10_000 });
      await page.evaluate(() => {
        window.open = () => null;
        try {
          Object.defineProperty(navigator, 'share', { configurable: true, value: async () => {} });
        } catch (_) {}
      });
      await shareBtn.click();
      await page.waitForFunction(
        () => !!sessionStorage.getItem('kmrc_share'),
        { timeout: 15_000 },
      ).catch(() => {});
      const shareState = await getClientShareState(page);
      expect(shareState?.token, 'La liste doit être créée avec un token').toBeTruthy();
      const token = shareState.token;

      // ── PHASE 2 — Ouvrir la même liste depuis les deux comptes ──────────
      // Buyer A : le compte principal, sur son propre lien (is_creator=true,
      // mais rien n'empêche l'organisateur d'acheter sa propre liste).
      const publicRespA = page.waitForResponse(
        (r) => r.url().includes(`/api/shared-carts/public/${token}`) && r.request().method() === 'GET',
        { timeout: 15_000 },
      );
      await page.goto(getSharePageUrl(token));
      await publicRespA;

      // Buyer B : second compte de test, contexte entièrement distinct.
      const buyerBContext = await browser.newContext({
        storageState: USER2_STATE_PATH,
        viewport: { width: 1280, height: 800 },
        locale: 'fr-FR',
      });
      const buyerBPage = await buyerBContext.newPage();

      const publicRespB = buyerBPage.waitForResponse(
        (r) => r.url().includes(`/api/shared-carts/public/${token}`) && r.request().method() === 'GET',
        { timeout: 15_000 },
      );
      await buyerBPage.goto(getSharePageUrl(token));
      await publicRespB;

      // ── PHASE 3 — Sélectionner l'article et ouvrir "Acheter la sélection"
      //    sur les deux comptes ────────────────────────────────────────────
      async function prepareCheckout(p) {
        const selectBtn = p.locator('#k-side-cart .k-shared-item-select').first();
        await expect(selectBtn).toBeVisible({ timeout: 10_000 });
        await selectBtn.click();

        const buyBtn = p.locator('#k-side-cart #k-shared-list-buy');
        await expect(buyBtn).toBeEnabled({ timeout: 5_000 });
        await buyBtn.click();

        await p.waitForSelector('#k-order-modal.open, .k-order-modal.open', { timeout: 10_000 });

        // Attend la sélection automatique du relais (un seul relais par île,
        // même mécanisme que order-flow.spec.js) avant de pouvoir confirmer.
        const relaisSummary = p.locator('#ck-relais-summary');
        await relaisSummary.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});

        const confirmBtn = p.locator('#btn-confirm-order');
        await expect(confirmBtn).toBeVisible({ timeout: 10_000 });
        return confirmBtn;
      }

      const confirmBtnA = await prepareCheckout(page);
      const confirmBtnB = await prepareCheckout(buyerBPage);

      // ── PHASE 4 — Confirmer en parallèle (course best-effort — voir
      //    limitation documentée en tête de fichier) ──────────────────────
      const orderCallA = page.waitForResponse(
        (r) => r.url().includes('/api/orders') && r.request().method() === 'POST',
        { timeout: 20_000 },
      );
      const orderCallB = buyerBPage.waitForResponse(
        (r) => r.url().includes('/api/orders') && r.request().method() === 'POST',
        { timeout: 20_000 },
      );

      await Promise.all([confirmBtnA.click(), confirmBtnB.click()]);
      const [respA, respB] = await Promise.all([orderCallA, orderCallB]);

      const statuses = [respA.status(), respB.status()].sort();
      expect(statuses, 'Un achat doit réussir (201), l\'autre doit être refusé (409)').toEqual([201, 409]);

      const [bodyA, bodyB] = await Promise.all([
        respA.json().catch(() => ({})),
        respB.json().catch(() => ({})),
      ]);
      const winnerBody = respA.status() === 201 ? bodyA : bodyB;
      const loserBody = respA.status() === 409 ? bodyA : bodyB;
      const loserPage = respA.status() === 409 ? page : buyerBPage;

      if (winnerBody?.order?.id) createdOrderIds.push(winnerBody.order.id);

      expect(loserBody.code, 'Le perdant doit recevoir le code métier dédié, pas une erreur générique').toBe('shared_cart_item_already_claimed');

      // ── PHASE 5 — Réaction UI côté perdant : message + "Déjà acheté" ────
      const conflictToast = loserPage.locator('.k-toast.show, #k-toast.show');
      await expect(conflictToast).toBeVisible({ timeout: 10_000 }).catch(() => {});

      // handleSharedListPurchaseConflict() rafraîchit la liste automatiquement.
      const claimedItem = loserPage.locator('#k-side-cart .k-shared-list-item.is-claimed').first();
      await expect(claimedItem).toBeVisible({ timeout: 15_000 });
      await expect(claimedItem.locator('.k-shared-item-status')).toHaveText('Déjà acheté');

      // Le contrôle de sélection doit disparaître pour une ligne déjà réclamée
      // (bouton "Sélectionner" remplacé par "Déjà acheté" désactivé — voir
      // itemRowHtml()).
      const disabledControl = claimedItem.locator('.k-shared-item-select[disabled]');
      await expect(disabledControl).toHaveCount(1);

      // ── PHASE 6 — Vérification backend : aucun doublon order_items ──────
      const finalCheck = await verifySharedCart(page, token);
      expect(finalCheck.exists).toBe(true);

      await buyerBContext.close();
    } finally {
      for (const id of createdOrderIds) {
        await cancelOrder(page, id, 'e2e-cleanup-F24').catch(() => {});
      }
    }
  });
});
