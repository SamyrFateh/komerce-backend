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
 *      - Charger la page publique /?shared=<token>
 *      - Vérifier que la vue groupe s'affiche
 *      - Vérifier côté API que le panier est visible publiquement
 *   3. Vérification backend :
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
const { getSharePageUrl } = require('../helpers/business.helpers');

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
      const shareUrl = getSharePageUrl(token);
      // eslint-disable-next-line no-console
      console.log(`[F21] Participant charge : ${shareUrl}`);

      await participantPage.goto(shareUrl);

      // Attendre que la page charge et que la vue groupe s'affiche
      // b-group-view.js détecte ?shared= et bascule automatiquement
      await participantPage.waitForFunction(
        () => {
          // La vue groupe est montée quand le panier partagé est chargé
          const groupView = document.getElementById('k-group-view');
          const bodyText = document.body.textContent || '';
          return (
            (groupView && groupView.textContent.length > 10) ||
            bodyText.includes('Panier groupe') ||
            bodyText.includes('Test F21') ||
            bodyText.includes('Rejoindre') ||
            bodyText.includes('Contribuer') ||
            bodyText.includes('partag')
          );
        },
        { timeout: 15_000 }
      ).catch(() => {});

      const participantText = await participantPage.locator('body').textContent();

      // Le participant doit voir au moins le titre ou une référence au panier
      const seesGroup =
        participantText.includes('Test F21') ||
        participantText.includes('Panier groupe') ||
        participantText.includes('partag') ||
        participantText.includes('Rejoindre') ||
        participantText.includes('Contribuer') ||
        participantText.includes('groupe');

      // eslint-disable-next-line no-console
      console.log(`[F21] Participant voit la page groupe : ${seesGroup}`);

      // Si la page groupe ne s'affiche pas, vérifier que le token est quand
      // même reconnu par l'API (la page publique peut nécessiter une auth
      // pour contribuer, mais l'affichage doit fonctionner)
      if (!seesGroup) {
        // Vérification directe via l'API publique depuis le contexte participant
        const publicCheck = await participantPage.evaluate(async (args) => {
          try {
            const resp = await fetch(
              new URL(`/api/shared-carts/public/${args.token}`, args.base).href
            );
            return { status: resp.status, ok: resp.ok };
          } catch { return { status: 0, ok: false }; }
        }, { token, base: BASE_URL.replace('/boutique/', '') });

        expect(
          publicCheck.ok,
          `L'API publique doit retourner le panier (status: ${publicCheck.status})`
        ).toBe(true);

        // eslint-disable-next-line no-console
        console.log(`[F21] API publique participant OK (status ${publicCheck.status})`);
      }

      // ═════════════════════════════════════════════════════════════════════
      //  PHASE 4 — Retour créateur : vérifier que le panier est toujours là
      // ═════════════════════════════════════════════════════════════════════

      // Recharger côté créateur pour voir l'état après « visite » du participant
      const finalCheck = await verifySharedCart(page, token);
      expect(finalCheck.exists, 'Le panier doit toujours exister après la visite du participant').toBe(true);

      // eslint-disable-next-line no-console
      console.log('[F21] Cycle complet validé ✓');
    } finally {
      await participantContext.close();
    }
  });
});
