/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   authenticated/group-library.spec.js
 * @feature shared-cart, group
 * @brief F23 — Bibliothèque "Mes listes" (mandat §10 BIBLIOTHÈQUE, amendement V2 §D).
 *
 * ⚠️ LIMITATION CONNUE : ce projet Playwright n'a qu'UN SEUL compte de test
 * (TEST_ACCOUNT_PHONE/OTP). Le scénario complet du mandat — un DEUXIÈME
 * participant authentifié distinct sauvegarde la liste dans SA PROPRE
 * bibliothèque ("Partagées avec moi") — n'est donc pas testable tel quel ici.
 * Un second couple TEST_ACCOUNT_PHONE_2/OTP_2 (compte de test staging dédié)
 * serait nécessaire pour couvrir ce cas complet.
 *
 * Ce que ce test couvre réellement, avec le seul compte disponible :
 *   1. Le créateur revisite son propre lien → aucun bouton "Sauvegarder"
 *      (ctx.isCreator === true, voir js/group/group-side-cart.js::saveActionHtml
 *      — "le créateur voit déjà sa liste dans Créées par moi").
 *   2. La liste créée apparaît bien dans "Créées par moi" via
 *      GET /api/shared-carts/library.
 *   3. Un visiteur NON authentifié (contexte sans session) voit le bouton
 *      "Sauvegarder cette liste" (vue destinataire, pas de sauvegarde
 *      automatique à l'ouverture — POST /api/shared-carts/save n'est JAMAIS
 *      appelé tant qu'on ne clique pas), mais la tentative de sauvegarde sans
 *      identité échoue proprement (401 côté backend, middleware "authenticate"
 *      sur POST /save) — le bouton ne bascule jamais en "Liste sauvegardée"
 *      et aucun droit n'est obtenu.
 *
 * ⚠️ ÉCART CONNU vs mandat §10 : aucune action "retirer de Mes listes" n'existe
 * ni côté UI (pas de bouton dans .k-library-item) ni côté backend (aucune
 * route DELETE dans services/shared-cart-library.js / routes/shared-cart.js).
 * Ce sous-scénario n'est donc pas testable tel quel — à implémenter d'abord.
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
  acceptConfirms,
} = require('../helpers/boutique.helpers');
const {
  getClientShareState,
  cancelAnyActiveSharedCart,
} = require('../helpers/api.helpers');
const { getSharePageUrl } = require('../helpers/business.helpers');

test.describe('FLOW — Bibliothèque "Mes listes" (F23)', () => {
  test.skip(
    !process.env.ALLOW_GROUP_FLOW,
    'F23 nécessite ALLOW_GROUP_FLOW=true — staging uniquement',
  );

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await cancelAnyActiveSharedCart(page);
  });

  test.afterEach(async ({ page }) => {
    await cancelAnyActiveSharedCart(page);
  });

  test('F23 — pas de sauvegarde auto, pas de bouton pour le créateur, pas de droit sans identité', async ({ page }) => {
    // ── PHASE 1 — Créer une liste avec le compte de test (créateur) ───────
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
    acceptConfirms(page); // É5 — window.confirm avant création
    await shareBtn.click();
    await page.waitForFunction(
      () => !!sessionStorage.getItem('kmrc_share'),
      { timeout: 15_000 },
    ).catch(() => {});
    const shareState = await getClientShareState(page);
    expect(shareState?.token).toBeTruthy();
    const token = shareState.token;

    // ── PHASE 2 — Le créateur ne voit jamais de bouton "Sauvegarder" ──────
    // Le rendu fire-and-forget après création (openSharedListInCanonicalCart)
    // s'est révélé pas assez fiable pour un test (voir F22-1/F22-2 dans
    // group-shared-list.spec.js, qui a remplacé group-coexistence.spec.js
    // et couvre ce même contrat). On navigue explicitement vers son
    // propre lien de partage — le même mécanisme déjà prouvé fiable par F21
    // (group-full-cycle.spec.js) pour un participant, ici avec
    // is_creator=true puisque même compte.
    const publicResponsePromise = page.waitForResponse(
      (r) => r.url().includes(`/api/shared-carts/public/${token}`) && r.request().method() === 'GET',
      { timeout: 15_000 },
    );
    await page.goto(getSharePageUrl(token));
    await publicResponsePromise;

    const sharedListPanel = page.locator('#k-cart-body .k-cart-snapshot-item, #k-side-cart .k-cart-snapshot-item').first();
    await expect(sharedListPanel).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#k-side-cart #k-sc-snap-save, #k-side-cart #k-cart-snap-save')).toHaveCount(0);

    // ── PHASE 3 — La liste apparaît dans "Créées par moi" ─────────────────
    const library = await page.evaluate(async (base) => {
      const resp = await fetch(new URL('/api/shared-carts/library', base).href, { credentials: 'include' });
      if (!resp.ok) return null;
      return resp.json();
    }, BASE_URL.replace('/boutique/', ''));
    expect(library).toBeTruthy();
    expect((library.created || []).some((c) => c.token === token)).toBe(true);

    // ── PHASE 4 — Visiteur non authentifié : pas de sauvegarde auto,
    //    tentative de sauvegarde sans identité échoue proprement ──────────
    const anonContext = await page.context().browser().newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'fr-FR',
    });
    // Garde-fou explicite : dans certaines configurations Playwright (projet
    // avec storageState au niveau du fichier de config), un nouveau contexte
    // créé via browser().newContext() peut hériter du cookie de session du
    // contexte principal au lieu de démarrer vide — vérifié en pratique
    // (capture directe : le cookie kmrc_jwt du créateur était présent sur ce
    // contexte "anonyme" avant même la navigation, ce qui faisait remonter
    // is_creator=true côté backend et masquait le bouton Sauvegarder qu'on
    // veut justement tester). On force l'isolation au lieu de la supposer.
    await anonContext.clearCookies();
    const anonPage = await anonContext.newPage();

    try {
      await anonPage.goto(getSharePageUrl(token));

      // Pas de sauvegarde automatique à l'ouverture : le bouton doit
      // apparaître dans son état initial "à sauvegarder", jamais appelé tout seul.
      const saveBtn = anonPage.locator('#k-side-cart #k-sc-snap-save, #k-side-cart #k-cart-snap-save').first();
      await expect(saveBtn).toBeVisible({ timeout: 10_000 });
      await expect(saveBtn).toHaveText(/Sauvegarder/);

      // L'écouteur est posé juste avant le clic, pas en tête de bloc : créé
      // trop tôt, son timeout interne (15s) peut expirer avant même d'être
      // await plus bas (le goto + les attentes de visibilité ci-dessus
      // peuvent à eux seuls s'approcher de 15s sur un réseau réel) — la
      // promesse rejette alors "dans le vide", ce que Playwright traite
      // comme une erreur non gérée et ferme le contexte (bug trouvé en
      // reproduisant l'échec réel : "Target page, context or browser has
      // been closed", exactement à ce timing).
      const saveCallPromise = anonPage.waitForResponse(
        (r) => r.url().includes('/api/shared-carts/save') && r.request().method() === 'POST',
        { timeout: 15_000 },
      );
      await saveBtn.click();
      const saveResponse = await saveCallPromise;
      expect(saveResponse.status(), 'POST /save sans identité doit être refusé (401)').toBe(401);

      // Le bouton ne doit JAMAIS basculer en "Liste sauvegardée" suite à un refus backend.
      await expect(saveBtn).toHaveText(/Sauvegarder/);
      await expect(saveBtn).not.toHaveText(/Sauvegardée/);
    } finally {
      await anonContext.close();
    }
  });
});
