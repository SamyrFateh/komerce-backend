/**
 * @e2e   authenticated/group-flow.spec.js
 * @feature shared-cart, group
 * @brief Flux métier panier partagé : création → vérification backend.
 *
 * Scénario réel (vérifié dans js/b-share-cart.js) :
 *   1. Créateur : ajouter au panier
 *   2. Créateur : cliquer "📤 Partager" (#k-cart-share mobile / #k-sc-share
 *      desktop) → ouvre la modale promptInit (titre + nature, PAS de
 *      nom/téléphone — needsAuth est toujours false pour le créateur)
 *   3. Soumettre → POST /api/shared-carts/from-cart-items
 *      (PAS /api/shared-carts — l'ancien pattern ne matchait jamais ce
 *      endpoint imbriqué)
 *   4. Le token créé est posé en sessionStorage['kmrc_share'], PAS affiché
 *      dans le DOM (le lien part directement en clipboard, jamais en HTML,
 *      hors flux "reshare"). On le lit depuis là pour vérifier côté API.
 *   5. Vérifier que le panier existe bien côté backend.
 *
 * ⚠️ Ce test CRÉE un vrai panier partagé en staging.
 * Ne pas exécuter contre la production (voir ALLOW_GROUP_FLOW).
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { BASE_URL, waitForGrid, openFirstCard, addToCartFromModal,
        openCartDrawer } = require('../helpers/boutique.helpers');
const { verifySharedCart, getClientShareToken, spyOnApi } = require('../helpers/api.helpers');

test.describe('FLOW — Panier partagé (créateur)', () => {

  test.skip(!process.env.ALLOW_GROUP_FLOW, 'Flux groupe désactivé (ALLOW_GROUP_FLOW non défini) — staging uniquement');

  test('F20 — Créer un panier partagé → vérifier son existence côté API', async ({ page }) => {
    // ── 1. Ajouter un produit au panier ──
    await page.goto(BASE_URL);
    await waitForGrid(page);
    await openFirstCard(page);
    await addToCartFromModal(page);

    // ── 2. Ouvrir le panier (le bouton "Partager" y vit, pas dans l'onglet groupe) ──
    await openCartDrawer(page);

    // Mobile : #k-cart-share · Desktop : #k-sc-share (voir b-share-cart.js::install)
    const shareBtn = page.locator('#k-cart-share, #k-sc-share').first();
    await expect(shareBtn).toBeVisible({ timeout: 10_000 });

    // Intercepter la vraie requête de création (endpoint imbriqué — pathPattern
    // doit matcher exactement, un glob '/api/shared-carts*' ne suffit pas ici
    // car '*' ne traverse pas les '/').
    const createSpy = await spyOnApi(page, '/api/shared-carts/from-cart-items', 'POST');
    await shareBtn.click();

    // ── 3. Modale promptInit : titre optionnel, pas de nom/tél (needsAuth=false) ──
    const shareModal = page.locator('.k-share-modal-overlay');
    await expect(shareModal).toBeVisible({ timeout: 8_000 });

    const titleInput = page.locator('#k-sm-title-f');
    if ((await titleInput.count()) > 0) {
      await titleInput.fill('Test Panier Groupe E2E');
    }

    const submitBtn = page.locator('#k-sm-submit');
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    // ── 4. Attendre la requête de création (peut être précédée de
    // requireIdentity() — instantané si la session est déjà active, ce qui
    // est le cas ici via storageState du projet "authenticated") ──
    const call = await createSpy.waitForCall(15_000);
    expect(call).not.toBeNull();
    expect(call.body).toBeTruthy();
    expect(Array.isArray(call.body.cart_items)).toBe(true);
    expect(call.body.cart_items.length).toBeGreaterThanOrEqual(1);

    // ── 5. Récupérer le token côté client (sessionStorage, pas le DOM) ──
    // switchToGroup() est appelé après coup ; laisser le temps à applyCartToState()
    // de poser sessionStorage avant de le lire.
    await page.waitForFunction(
      () => !!sessionStorage.getItem('kmrc_share'),
      { timeout: 10_000 }
    ).catch(() => {});

    const token = await getClientShareToken(page);
    expect(token, 'Le token du panier partagé doit être posé côté client après création').toBeTruthy();

    // ── 6. Vérifier côté API que le panier existe bien ──
    if (token) {
      const result = await verifySharedCart(page, token);
      expect(result.exists, 'Le panier partagé doit exister côté API').toBe(true);
      if (result.cart) {
        expect(result.cart.status).toBe('open');
      }
    }
  });
});
