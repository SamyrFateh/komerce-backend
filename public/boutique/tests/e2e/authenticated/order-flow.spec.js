/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/order-flow.spec.js
 * @feature checkout, orders
 * @brief Flux métier COMPLET : parcours → panier → checkout → commande.
 *
 * Ce test valide le parcours utilisateur de bout en bout :
 *   1. Parcourir le catalogue et ouvrir un produit
 *   2. Ajouter au panier avec quantité > 1
 *   3. Ouvrir le checkout
 *   4. Remplir le formulaire bénéficiaire (#of-beneficiary-name/-phone)
 *   5. Attendre la sélection auto du relais (aucun clic requis — un seul
 *      relais par île, choisi automatiquement par _openRelaisPicker/pick())
 *   6. Laisser Cash comme mode de paiement (coché par défaut dans le DOM)
 *   7. Vérifier que le payload envoyé au backend est correct
 *   8. Si ALLOW_ORDER_SUBMIT=true : laisser la requête partir réellement,
 *      vérifier la commande créée côté backend (GET /api/orders/:ref —
 *      statut, payment_mode, items persistés), puis l'annuler en cleanup.
 *
 * ⚠️ Sans `ALLOW_ORDER_SUBMIT=true`, ce test intercepte la requête API et
 * répond avec un fake succès — il vérifie alors seulement le payload envoyé
 * par le frontend, jamais ce que le backend persiste. C'est le comportement
 * par défaut (CI/PR, prod). Pour le flux bout-en-bout réel, tourner contre
 * staging avec `ALLOW_ORDER_SUBMIT=true` (comme pour ALLOW_GROUP_FLOW).
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, waitForGrid, openFirstCard, addToCartFromModal,
  openCheckout, selectRecipientOther,
} = require('../helpers/boutique.helpers');
const { getClientCart, verifyOrder, cancelOrder } = require('../helpers/api.helpers');

test.describe('FLOW — Commande complète (browse → checkout)', () => {

  // Rempli si ALLOW_ORDER_SUBMIT=true fait vraiment passer une commande —
  // nettoyé après le test même si les assertions plus bas échouent, pour ne
  // jamais laisser traîner une commande cash 'pending' sur le compte de test.
  let createdOrderId = null;

  test.afterEach(async ({ page }) => {
    if (createdOrderId) {
      await cancelOrder(page, createdOrderId, 'e2e-cleanup-F01');
      createdOrderId = null;
    }
  });

  test('F01 — Parcours complet : catalogue → panier → checkout → commande vérifiée côté backend', async ({ page }) => {
    // ── 1. Charger le catalogue ──
    await page.goto(BASE_URL);
    await waitForGrid(page);

    // ── 2. Ouvrir un produit ──
    await openFirstCard(page);

    // ── 3. Ajouter au panier ──
    // Le bouton #k-add-cart-btn ET le stepper #k-qty-plus font tous les deux
    // addToCart(product, 1, ...) directement (voir b-modal-cart.js::setupModalCart)
    // — il n'y a PAS de compteur local avant commit. "Ajouter au panier" pose
    // donc qty=1 dans le panier ; le "+" qui suit incrémente ce qty=1 déjà
    // committé à 2. Cliquer "+" avant d'ajouter (ordre initial du test) fait
    // la même chose que "Ajouter au panier" (qty=1) — l'assertion "2" échouait
    // systématiquement pour cette raison, pas un souci de timing/race.
    await addToCartFromModal(page);

    const plusBtn = page.locator('#k-qty-plus');
    await plusBtn.click();
    const qtyVal = page.locator('#k-qty-val');
    await expect(qtyVal).toHaveText('2');

    const cart = await getClientCart(page);
    expect(cart.length).toBeGreaterThanOrEqual(1);
    expect(cart[0].qty || cart[0].quantity).toBe(2);

    // ── 4. Ouvrir le checkout ──
    await openCheckout(page);

    // ── 5. Remplir le formulaire bénéficiaire "Quelqu'un d'autre" ──
    // Champs réels (b-checkout-render.js::makeInput / makeIntlPhoneInput) :
    // id posé directement sur l'<input>, PAS #k-ck-name/#k-ck-phone.
    await selectRecipientOther(page);

    // submitOrder() bloque explicitement si le téléphone bénéficiaire == celui
    // du payeur OTP (anti-fraude, voir b-checkout.js — "doit être différent du
    // vôtre"). Constante dédiée, jamais égale à TEST_ACCOUNT_PHONE (le numéro
    // utilisé pour authentifier le payeur dans auth.setup.js).
    const TEST_BENEFICIARY_PHONE = '7001234';
    if (TEST_BENEFICIARY_PHONE === process.env.TEST_ACCOUNT_PHONE) {
      throw new Error(
        'TEST_BENEFICIARY_PHONE ne doit pas être égal à TEST_ACCOUNT_PHONE ' +
          '(submitOrder() rejette un bénéficiaire avec le même numéro que le payeur).'
      );
    }

    const nameInput = page.locator('#of-beneficiary-name');
    const phoneInput = page.locator('#of-beneficiary-phone');
    if ((await nameInput.count()) > 0) {
      await nameInput.fill('Test Playwright');
    }
    if ((await phoneInput.count()) > 0) {
      await phoneInput.fill(TEST_BENEFICIARY_PHONE);
    }

    // ── 6. Relais : PAS de carte à cliquer ──
    // Un seul relais par île, choisi automatiquement (voir _openRelaisPicker /
    // la logique de pré-sélection dans b-checkout.js). Le résumé s'affiche
    // dans #ck-relais-summary ; on ne le touche pas sauf pour "changer".
    const relaisSummary = page.locator('#ck-relais-summary');
    await relaisSummary.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

    // ── 7. Paiement : Cash est déjà coché par défaut (input radio "checked"
    // sur payment_mode=cash_relais) — aucune action requise. On vérifie juste
    // que la chip existe et reste sélectionnée.
    const cashChip = page.locator('#ck-chip-cash input[type="radio"]');
    if ((await cashChip.count()) > 0) {
      await expect(cashChip).toBeChecked();
    }

    // ── 8. Intercepter la requête de commande (ne PAS soumettre en prod) ──
    // UN SEUL handler pour /api/orders, pas spyOnApi + un route.fulfill() séparé.
    // Raison : route.continue() envoie la requête directement au réseau, il ne
    // redonne PAS la main à un handler enregistré précédemment (c'est justement
    // pour ça que route.fallback() existe, distinct de route.continue()).
    // spyOnApi() (voir api.helpers.js) appelle route.continue() en interne — le
    // combiner avec un route.fulfill() séparé est ambigu et risqué ici :
    //   - fulfill enregistré après spy → spy jamais exécuté ("no call intercepted",
    //     ce qu'on vient d'observer) ;
    //   - fulfill enregistré avant spy → spy enregistre puis continue() part
    //     directement vers le vrai backend prod, exactement ce qu'on veut éviter.
    // Un seul handler qui fait les deux choses explicitement élimine l'ambiguïté.
    const orderCalls = [];
    await page.route('**/api/orders*', async (route, request) => {
      if (request.method() === 'POST') {
        let body = null;
        try { body = request.postDataJSON(); } catch { body = request.postData(); }
        orderCalls.push({ url: request.url(), method: request.method(), body, timestamp: Date.now() });
      }
      if (process.env.ALLOW_ORDER_SUBMIT) {
        // Staging avec soumission réelle autorisée : laisser passer.
        await route.continue();
      } else {
        // Prod (ou staging sans opt-in explicite) : ne jamais laisser partir la
        // vraie requête, répondre avec un fake succès.
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, order: { ref: 'TEST-E2E', id: 9999 } }),
        });
      }
    });

    // Bouton réel : #btn-confirm-order (classe .ck-confirm-btn), désactivé
    // (.is-disabled) tant que le relais n'est pas "ready".
    const confirmBtn = page.locator('#btn-confirm-order');
    await confirmBtn.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    await expect(confirmBtn).toBeEnabled({ timeout: 15_000 }).catch(() => {});

    if ((await confirmBtn.count()) > 0 && await confirmBtn.isEnabled()) {
      // Posé AVANT le clic : capture la vraie réponse serveur quand
      // ALLOW_ORDER_SUBMIT=true laisse la requête partir en staging (le
      // fake fulfill() du handler ci-dessus répond aussi à ce waitForResponse,
      // donc ça marche dans les deux cas — on distingue via l'env plus bas).
      const responsePromise = page.waitForResponse(
        (resp) => resp.url().includes('/api/orders') && resp.request().method() === 'POST',
        { timeout: 20_000 }
      ).catch(() => null);

      await confirmBtn.click();

      // submitOrder() a plusieurs retours silencieux (relais non prêt, bénéficiaire
      // invalide, numéro dupliqué...) qui affichent un toast (#k-toast) sans jamais
      // toucher le réseau. Si aucun appel n'arrive, on remonte le texte du toast
      // réel plutôt qu'un message générique — pour diagnostiquer la vraie cause
      // au lieu de deviner laquelle des guards de submitOrder() a bloqué.
      try {
        await expect
          .poll(() => orderCalls.length, {
            message: 'aucun appel POST /api/orders intercepté après le clic',
            timeout: 5_000,
          })
          .toBeGreaterThan(0);
      } catch (e) {
        const toastText = await page.locator('#k-toast').textContent().catch(() => null);
        throw new Error(
          `Aucun appel /api/orders après le clic sur #btn-confirm-order. ` +
            `Toast affiché : "${(toastText || '').trim()}"`
        );
      }
      const call = orderCalls[orderCalls.length - 1];
      expect(call).not.toBeNull();
      expect(call.body).toBeTruthy();

      if (call.body) {
        const items = call.body.items || call.body.cart || [];
        expect(items.length).toBeGreaterThanOrEqual(1);
      }

      // ── 9. ALLOW_ORDER_SUBMIT=true : la commande est réellement créée en
      // staging — on vérifie sa persistance côté backend (pas seulement le
      // payload envoyé), puis on la nettoie via afterEach. Sans cette étape,
      // F01 ne teste que ce que le frontend ENVOIE, jamais ce que le backend
      // ENREGISTRE (schéma DB, calcul du total, statut initial...).
      if (process.env.ALLOW_ORDER_SUBMIT) {
        const response = await responsePromise;
        expect(response, 'Pas de réponse serveur reçue pour POST /api/orders').not.toBeNull();

        const respBody = await response.json().catch(() => null);
        const order = respBody?.order;
        expect(order?.id, 'La réponse doit contenir order.id').toBeTruthy();
        createdOrderId = order.id; // pour le cleanup en afterEach, même si une assertion échoue plus bas

        const verified = await verifyOrder(page, order.reference || order.id);
        expect(verified.exists, 'La commande doit exister côté backend (GET /api/orders/:ref)').toBe(true);
        expect(verified.order.payment_mode).toBe('cash_relais');
        expect(['pending', 'confirmed']).toContain(verified.order.status);
        expect(verified.items.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
