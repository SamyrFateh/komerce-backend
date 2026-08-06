/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/order-confirmation.spec.js
 * @feature checkout, orders, tracking
 * @brief F04 (partiel) + écran de confirmation — Après commande, vérifier
 *        que l'écran de confirmation affiche :
 *          - la référence de commande (format K + 6 alphanum, ex: K8WIZKS)
 *          - le code cash relais (si cash_relais)
 *          - le bouton "Suivre ma commande"
 *          - le bouton "Continuer mes achats"
 *
 * Contrat fonctionnel testé pour le clic "Suivre ma commande" (2026-07-11) :
 *   Confirmation → clic Suivre → onglet Suivi actif → la commande qui vient
 *   d'être créée est visible dans la liste des commandes du client.
 *   Pas de champ de recherche à pré-remplir : renderMyOrdersList() trie par
 *   created_at DESC, la commande fraîche apparaît naturellement en tête,
 *   identifiable via l'attribut stable `data-ref` déjà posé sur
 *   `.k-myorder-card` (aucun nouveau data-testid nécessaire).
 *
 * Historique : l'ancienne version de ce test attendait un `#k-otp-ref`
 * pré-rempli et un `#k-track-view` peuplé via waitForFunction — IDs morts
 * côté b-checkout.js (jamais importés : renderTrackView()/switchView()
 * étaient des identifiants nus, silencieusement no-op). Corrigé dans
 * b-checkout.js (bus.emit('nav:goto-track')) + b-nav.js (bus.on associé).
 * Ce test vérifie désormais le comportement utilisateur réel, pas les
 * anciens rouages internes.
 *
 * ⚠️ Soumet une vraie commande → staging uniquement (ALLOW_ORDER_SUBMIT).
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, waitForGrid, openFirstCard, addToCartFromModal,
  openCheckout, selectRecipientOther,
} = require('../helpers/boutique.helpers');
const { cancelOrder } = require('../helpers/api.helpers');

test.describe('FLOW — Écran de confirmation post-commande (F04 partiel)', () => {

  test.skip(
    !process.env.ALLOW_ORDER_SUBMIT,
    'Nécessite ALLOW_ORDER_SUBMIT=true — staging uniquement'
  );

  // Ce test soumet réellement une commande cash 'pending' — sans cleanup elle
  // reste orpheline sur le compte de test à chaque run. Même pattern que F01.
  let createdOrderId = null;

  test.afterEach(async ({ page }, testInfo) => {
    if (createdOrderId) {
      const observeMs = Number(process.env.E2E_OBSERVE_MS || 0);

      if (Number.isFinite(observeMs) && observeMs > 0) {
        testInfo.setTimeout(testInfo.timeout + observeMs);
        // eslint-disable-next-line no-console
        console.log(
          `[F04p] Observation dashboard pendant ${observeMs} ms — order.id=${createdOrderId}`
        );
        await page.waitForTimeout(observeMs);
      }

      await cancelOrder(page, createdOrderId, 'e2e-cleanup-F04p');
      createdOrderId = null;
    }
  });

  test('F04p — Confirmation : référence + code cash + boutons suivi/continuer', async ({ page }) => {
    // Filet de sécurité non-régression : si un futur changement recasse le
    // câblage checkout→tracking, on veut une trace explicite plutôt qu'un
    // hang muet de 60s comme celui qui a motivé cette réécriture.
    const t0 = Date.now();
    const cp = (label) => console.log(`[F04p][+${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`);
    page.on('pageerror', (err) => console.log(`[F04p][pageerror] ${err.message}`));
    page.on('requestfailed', (req) => {
      if (req.url().includes('/api/')) {
        console.log(`[F04p][net✗] ${req.url()} — ${req.failure()?.errorText}`);
      }
    });

    // ── 1. Commande complète (même flux que F01 mais sans intercepter) ──
    await page.goto(BASE_URL);
    await waitForGrid(page);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await openCheckout(page);
    await selectRecipientOther(page);

    const nameInput = page.locator('#of-beneficiary-name');
    const phoneInput = page.locator('#of-beneficiary-phone');
    if ((await nameInput.count()) > 0) await nameInput.fill('Test Confirmation E2E');
    if ((await phoneInput.count()) > 0) await phoneInput.fill('7003333');

    // Cash par défaut, relais auto
    await page.locator('#ck-relais-summary').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

    const confirmBtn = page.locator('#btn-confirm-order');
    await expect(confirmBtn).toBeEnabled({ timeout: 15_000 });

    // Capturé pour le cleanup uniquement (cancelOrder a besoin de order.id,
    // pas de la référence affichée à l'écran — voir routes/orders/cancel.js
    // qui ne lookup que par o.id).
    const orderResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/orders') && resp.request().method() === 'POST',
      { timeout: 20_000 }
    ).catch(() => null);

    await confirmBtn.click();

    const orderResp = await orderResponsePromise;
    const orderBody = await orderResp?.json().catch(() => null);
    if (orderBody?.order?.id) {
      createdOrderId = orderBody.order.id;
    }

    // ── 2. Attendre l'écran de confirmation ──
    // renderOrderSuccess() remplace le contenu du checkout par .k-confirm-wrap
    const confirmWrap = page.locator('.k-confirm-wrap');
    await expect(confirmWrap).toBeVisible({ timeout: 20_000 });

    // ── 3. Vérifier la référence ──
    // Format réel généré par services/order-service.js::generateRef() :
    // 'K' + 6 caractères alphanumériques aléatoires (ex: K8WIZKS). Il n'y a
    // JAMAIS eu de préfixe "KM-" dans le code métier (backend ni frontend).
    const refEl = page.locator('.k-confirm-ref');
    await expect(refEl).toBeVisible({ timeout: 5_000 });
    const refText = await refEl.textContent();
    expect(refText, 'La référence doit suivre le format K + 6 alphanumériques').toMatch(/^K[A-Z0-9]{6}$/);
    cp(`Référence affichée : ${refText}`);

    // ── 4. Vérifier le code cash (si paiement cash_relais) ──
    const cashBlock = page.locator('.k-confirm-cash-block');
    if ((await cashBlock.count()) > 0) {
      const cashCode = await page.locator('.k-confirm-cash-code').textContent();
      expect(cashCode, 'Le code cash doit être non vide').toBeTruthy();
      expect(cashCode.length, 'Le code cash doit avoir au moins 4 caractères').toBeGreaterThanOrEqual(4);
      cp(`Code cash relais : ${cashCode}`);
    } else {
      cp('Pas de code cash (paiement non-cash ou structure différente)');
    }

    // ── 5. Vérifier le bouton "Copier" ──
    const copyBtn = page.locator('#k-copy-ref-btn');
    await expect(copyBtn).toBeVisible();

    // ── 6. Boutons d'action ──
    const trackBtn = page.locator('#k-order-track-btn');
    const closeBtn = page.locator('#k-order-close-btn');
    await expect(trackBtn).toBeVisible();
    await expect(closeBtn).toBeVisible();

    // ── 7. Clic "Suivre ma commande" → onglet Suivi → commande visible ──
    await trackBtn.click();
    cp('après clic trackBtn');

    // Onglet actif : contrat DOM porté par switchView() dans b-nav.js.
    await expect(page.locator('body')).toHaveClass(/k-view-track/, { timeout: 5_000 });
    cp('onglet Suivi actif (k-view-track)');

    // La commande qu'on vient de créer doit apparaître dans la liste —
    // c'est le vrai comportement utilisateur attendu, pas un ID interne.
    const orderCard = page.locator(`.k-myorder-card[data-ref="${refText}"]`);
    await expect(orderCard, 'La commande créée doit apparaître dans "Mes commandes"').toBeVisible({ timeout: 10_000 });
    cp('commande visible dans la liste de suivi ✓');
  });
});
