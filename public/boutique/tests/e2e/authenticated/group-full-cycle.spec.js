/**
 * @e2e   authenticated/group-full-cycle.spec.js
 * @feature shared-cart, group
 * @brief F21 — Cycle complet panier partagé : créateur crée → participant
 *        rejoint via la page publique → vérification backend → clôture.
 *
 * Scénario réel multi-contexte Playwright :
 *   1. Contexte CRÉATEUR (session authentifiée) :
 *      - Ajouter un produit au panier
 *      - Cliquer "Partager" → POST /api/shared-carts/from-cart-items
 *      - Récupérer le token depuis sessionStorage['kmrc_share']
 *   2. Contexte PARTICIPANT (nouveau browser context, ANONYME) :
 *      - Charger la page publique /?p=<token> (b-group-view.js:89 lit `p`,
 *        PAS `shared` — un ancien draft de ce test utilisait `?shared=`,
 *        ce qui ne charge jamais la vue groupe)
 *      - Soumettre une vraie estimation via POST /public/:token/estimations
 *        (endpoint public, aucune auth) — c'est l'action métier réelle du
 *        participant, pas juste un chargement de page
 *   3. Vérification backend :
 *      - GET /public/:token/estimations → le compte a bien augmenté
 *      - GET /api/shared-carts/public/:token → panier existe, status 'open'
 *   4. Cleanup : annuler le panier partagé
 *
 * ⚠️ Ce test CRÉE un vrai panier partagé → staging uniquement (ALLOW_GROUP_FLOW).
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, waitForGrid, openFirstCard, addToCartFromModal,
  openCartDrawer,
} = require('../helpers/boutique.helpers');
const {
  verifySharedCart, getClientShareToken, getClientShareState,
  cancelAnyActiveSharedCart, spyOnApi,
} = require('../helpers/api.helpers');
const { getSharePageUrl, submitEstimation, getPublicEstimations } = require('../helpers/business.helpers');

test.describe('FLOW — Panier partagé cycle complet (F21)', () => {

  test.skip(
    !process.env.ALLOW_GROUP_FLOW,
    'F21 nécessite ALLOW_GROUP_FLOW=true — staging uniquement'
  );

  // Nettoyage avant/après : F21 crée un panier 'open' qui doit être annulé
  // sinon le prochain run bifurque vers promptActiveCartChoice().
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await cancelAnyActiveSharedCart(page);
  });

  test.afterEach(async ({ page }) => {
    await cancelAnyActiveSharedCart(page);
  });

  test('F21 — Créateur crée → participant charge la page publique → vérification API', async ({ page }) => {
    // ═══════════════════════════════════════════════════════════════════════
    //  PHASE 1 — CRÉATEUR : créer le panier partagé
    // ═══════════════════════════════════════════════════════════════════════

    await page.goto(BASE_URL);
    await waitForGrid(page);
    await openFirstCard(page);
    await addToCartFromModal(page);

    // Ouvrir le panier puis cliquer "Partager"
    await openCartDrawer(page);

    const shareBtn = page.locator('#k-cart-share, #k-sc-share').first();
    await expect(shareBtn).toBeVisible({ timeout: 10_000 });

    // Intercepter la requête de création
    const createSpy = await spyOnApi(page, '/api/shared-carts/from-cart-items', 'POST');
    await shareBtn.click();

    // Modale promptInit : sélectionner "needs_validation" pour avoir un panier 'open'
    const shareModal = page.locator('.k-share-modal-overlay');
    await expect(shareModal).toBeVisible({ timeout: 8_000 });

    const titleInput = page.locator('#k-sm-title-f');
    if ((await titleInput.count()) > 0) {
      await titleInput.fill('Test F21 Cycle Complet');
    }

    const needsValidation = page.locator('.k-sm-nature-opt[data-mode="needs_validation"]');
    if ((await needsValidation.count()) > 0) {
      await needsValidation.click();
    }

    const submitBtn = page.locator('#k-sm-submit');
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    // Attendre la requête de création
    const createCall = await createSpy.waitForCall(15_000);
    expect(createCall).not.toBeNull();
    expect(createCall.body).toBeTruthy();

    // Récupérer le token et l'id
    await page.waitForFunction(
      () => !!sessionStorage.getItem('kmrc_share'),
      { timeout: 10_000 }
    ).catch(() => {});

    const token = await getClientShareToken(page);
    expect(token, 'Le token du panier partagé doit être posé').toBeTruthy();

    const shareState = await getClientShareState(page);
    const cartId = shareState?.id;
    // eslint-disable-next-line no-console
    console.log(`[F21] Panier créé — token: ${token}, id: ${cartId}`);

    // ═══════════════════════════════════════════════════════════════════════
    //  PHASE 2 — Vérification API : le panier existe et est 'open'
    // ═══════════════════════════════════════════════════════════════════════

    const apiResult = await verifySharedCart(page, token);
    expect(apiResult.exists, 'Le panier doit exister côté API').toBe(true);
    if (apiResult.cart) {
      expect(apiResult.cart.status, 'Le panier doit être en statut open').toBe('open');
      // eslint-disable-next-line no-console
      console.log(`[F21] API vérification : status=${apiResult.cart.status} ✓`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  PHASE 3 — PARTICIPANT : charger la page publique dans un 2e contexte
    // ═══════════════════════════════════════════════════════════════════════

    const participantContext = await page.context().browser().newContext({
      viewport: { width: 390, height: 844 },
      locale: 'fr-FR',
    });
    const participantPage = await participantContext.newPage();

    try {
      // ── Agrégat AVANT — pour comparer après l'action participant, plutôt
      // que de se fier à un texte affiché (une page boutique normale contient
      // déjà le mot "groupe" via l'onglet nav — un match texte peut passer
      // sans que la vraie vue groupe se soit jamais chargée). ──
      const estimationsBefore = await getPublicEstimations(page, token);
      const countBefore = estimationsBefore?.count ?? estimationsBefore?.estimations?.length ?? 0;

      const shareUrl = getSharePageUrl(token); // ?p=<token> — voir b-group-view.js:89
      // eslint-disable-next-line no-console
      console.log(`[F21] Participant charge : ${shareUrl}`);

      await participantPage.goto(shareUrl);

      // Vérification souple de la vue (informative, pas la preuve du test) :
      // la vraie preuve est l'action métier ci-dessous.
      const groupView = participantPage.locator('#k-group-view');
      const groupViewVisible = await groupView.isVisible({ timeout: 8_000 }).catch(() => false);
      // eslint-disable-next-line no-console
      console.log(`[F21] #k-group-view visible côté participant : ${groupViewVisible}`);

      // ── PARTICIPANT : soumettre une vraie estimation via l'endpoint public
      // (POST /public/:token/estimations — aucune auth requise, c'est le vrai
      // point d'entrée participant). C'est la preuve que le cycle créateur→
      // participant fonctionne réellement de bout en bout, indépendamment de
      // ce que le DOM affiche. ──
      const submission = await submitEstimation(participantPage, token, {
        name: 'Participant Test F21',
        amountKmf: 5000,
        phone: '7005555',
      });
      // eslint-disable-next-line no-console
      console.log(`[F21] submitEstimation → status ${submission.status}, ok=${submission.ok}`);

      expect(
        submission.ok,
        `L'estimation participant doit être acceptée (status: ${submission.status}, error: ${submission.error})`
      ).toBe(true);

      // ── Vérifier côté API que l'agrégat a bien augmenté ──
      const estimationsAfter = await getPublicEstimations(page, token);
      const countAfter = estimationsAfter?.count ?? estimationsAfter?.estimations?.length ?? 0;

      expect(
        countAfter,
        `Le nombre d'estimations doit avoir augmenté (avant: ${countBefore}, après: ${countAfter})`
      ).toBeGreaterThan(countBefore);
      // eslint-disable-next-line no-console
      console.log(`[F21] Estimations : ${countBefore} → ${countAfter} ✓`);

      // ═══════════════════════════════════════════════════════════════════════
      //  PHASE 4 — Retour créateur : vérifier que le panier est toujours là
      // ═══════════════════════════════════════════════════════════════════════

      const finalCheck = await verifySharedCart(page, token);
      expect(finalCheck.exists, 'Le panier doit toujours exister après l\'action du participant').toBe(true);

      // eslint-disable-next-line no-console
      console.log('[F21] Cycle complet validé ✓');
    } finally {
      await participantContext.close();
    }
  });
});
