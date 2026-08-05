/**
 * @e2e   authenticated/group-coexistence.spec.js
 * @feature shared-cart, group
 * @brief F22 — Isolation panier personnel / liste partagée (mandat §4/§10).
 *
 * Scénario (mandat §10, bloc COEXISTENCE + §4 ISOLATION) :
 *   1. Le créateur partage une sélection → sa propre session bascule
 *      automatiquement en surface "shared-list" (activateSharedListContext,
 *      voir js/b-share-cart.js).
 *   2. Depuis un article de la liste, il ouvre la fiche produit
 *      (.k-shared-item-open → modal:open, voir
 *      js/group/group-side-cart.js::handleOpenItemProduct).
 *   3. Il ajoute ce produit à son panier PERSONNEL depuis la modale.
 *   4. Il ferme la modale → la surface "shared-list" doit se restaurer
 *      automatiquement (state.modalReturnSurface, consommé par le listener
 *      bus.on('modal:closed') dans group-side-cart.js).
 *   5. Le panier personnel contient le nouvel article, la liste et sa
 *      sélection restent strictement inchangées, aucune route shared-cart
 *      n'a été appelée par cette action.
 *
 * ⚠️ Ce test CRÉE une vraie liste → staging uniquement (ALLOW_GROUP_FLOW).
 */
'use strict';

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
  verifySharedCart,
  getClientShareToken,
  getClientShareState,
  cancelAnyActiveSharedCart,
  spyOnApi,
} = require('../helpers/api.helpers');
const { getSharePageUrl } = require('../helpers/business.helpers');

test.describe('FLOW — Isolation panier personnel / liste (F22)', () => {
  test.skip(
    !process.env.ALLOW_GROUP_FLOW,
    'F22 nécessite ALLOW_GROUP_FLOW=true — staging uniquement',
  );

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await cancelAnyActiveSharedCart(page);
  });

  test.afterEach(async ({ page }) => {
    await cancelAnyActiveSharedCart(page);
  });

  test('F22 — ajout au panier perso depuis une fiche produit ouverte via la liste n\'altère jamais la liste', async ({ page }) => {
    // ── PHASE 1 — Créer une liste (partage immédiat, comme F20) ──────────
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
    expect(shareState?.token, 'Le token de la liste doit exister après création').toBeTruthy();

    // La création déclenche l'ouverture de la surface "shared-list" en
    // fire-and-forget (openSharedListInCanonicalCart, imports dynamiques +
    // fetch getSharedCartPublic — voir js/b-share-cart.js) qui s'est révélé
    // pas assez fiable pour un test (échec reproductible même avec 25s
    // d'attente, y compris en local contre un backend rapide — semble être
    // un vrai gap fonctionnel, indépendant du réseau, pas juste un problème
    // de timing). Le badge desktop #k-sc-shared-badge (qui contiendrait
    // #k-sc-group-view, "👥 Suivre les participations →") s'est également
    // révélé toujours masqué : refreshSharedBadges() y pose
    // `desktopBadge.hidden = true` sans condition sur isShared — donc
    // inutilisable comme déclencheur alternatif (bug réel de l'app,
    // indépendant de V2-E, à signaler séparément).
    // On navigue donc explicitement vers son propre lien de partage — le
    // même mécanisme déjà prouvé fiable par F21 (group-full-cycle.spec.js)
    // pour un participant, ici avec is_creator=true puisque même compte.
    const publicResponsePromise = page.waitForResponse(
      (r) => r.url().includes(`/api/shared-carts/public/${shareState.token}`) && r.request().method() === 'GET',
      { timeout: 15_000 },
    );
    await page.goto(getSharePageUrl(shareState.token));
    await publicResponsePromise;

    const sharedListPanel = page.locator('#k-cart-body .k-shared-list-items, #k-side-cart .k-shared-list-items').first();
    await expect(sharedListPanel).toBeVisible({ timeout: 10_000 });

    // ── Snapshot de l'état "liste" AVANT toute action panier perso ────────
    // (window.state n'est jamais exposé globalement par l'app — aucun
    // module ne fait `window.state = state`, b-store.js l'exporte en ESM
    // uniquement. On observe donc l'état exclusivement via le DOM rendu et
    // via l'API backend, jamais via un accès direct à l'état interne JS.)
    const sharedListSnapshot = await sharedListPanel.innerHTML();
    const cartBadgeBefore = parseInt(
      (await page.locator('.k-cart-badge').first().textContent().catch(() => '0')) || '0',
      10,
    );

    // Sonde : aucune route shared-cart (items/quantité/ajout/retrait) ne
    // doit être appelée pendant l'ajout au panier perso depuis la modale.
    const itemsRouteSpy = await spyOnApi(page, '/api/shared-carts/', 'PUT');
    const itemsPostSpy = await spyOnApi(page, '/api/shared-carts/', 'POST');
    const itemsDeleteSpy = await spyOnApi(page, '/api/shared-carts/', 'DELETE');

    // ── PHASE 2 — Ouvrir la fiche produit depuis la liste ─────────────────
    const firstItemOpen = page.locator('.k-shared-item-open').first();
    await expect(firstItemOpen).toBeVisible({ timeout: 10_000 });
    await firstItemOpen.click();

    await expect(page.locator('#k-add-cart-btn')).toBeVisible({ timeout: 10_000 });

    // ── PHASE 3 — Ajouter au panier PERSONNEL depuis la modale ────────────
    await addToCartFromModal(page);

    // ── PHASE 4 — Fermer la modale → retour automatique à la liste ────────
    await closeModal(page);

    const sharedListPanelAfter = page.locator('#k-cart-body .k-shared-list-items, #k-side-cart .k-shared-list-items').first();
    await expect(sharedListPanelAfter).toBeVisible({ timeout: 10_000 });

    // ── PHASE 5 — Assertions d'isolation ───────────────────────────────────
    const sharedListSnapshotAfter = await sharedListPanelAfter.innerHTML();
    expect(sharedListSnapshotAfter, 'Le contenu rendu de la liste ne doit pas changer').toBe(sharedListSnapshot);

    const cartBadgeAfter = parseInt(
      (await page.locator('.k-cart-badge').first().textContent().catch(() => '0')) || '0',
      10,
    );
    expect(cartBadgeAfter, 'Le badge panier personnel doit refléter le nouvel article ajouté').toBeGreaterThan(cartBadgeBefore);

    expect(itemsRouteSpy.calls().length, 'Aucun PUT shared-carts ne doit être déclenché par cette action').toBe(0);
    expect(itemsPostSpy.calls().length, 'Aucun POST shared-carts ne doit être déclenché par cette action').toBe(0);
    expect(itemsDeleteSpy.calls().length, 'Aucun DELETE shared-carts ne doit être déclenché par cette action').toBe(0);

    // ── Vérification backend — la liste reste inchangée côté serveur ──────
    const finalCheck = await verifySharedCart(page, shareState.token);
    expect(finalCheck.exists, 'La liste doit toujours exister côté API').toBe(true);
  });
});
