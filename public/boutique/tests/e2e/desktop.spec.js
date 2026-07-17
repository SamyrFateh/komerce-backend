/**
 * @e2e   desktop.spec.js
 * @feature desktop-layout
 * @brief Layout desktop : sidebar, side-cart permanent, header nav,
 *        hero adapté, grille multi-colonnes.
 *
 * Ce fichier ne tourne QUE sur les projets Desktop (viewport ≥ 900px).
 * Sur Mobile Chrome / Mobile Safari, les tests sont automatiquement skipped.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, IS_REMOTE, waitForGrid, openFirstCard,
  addToCartFromModal, closeModal,
} = require('./helpers/boutique.helpers');

test.describe('E-DESK — Layout desktop', () => {

  test.beforeEach(async ({ page }) => {
    test.skip(!IS_REMOTE, 'Nécessite le catalogue réel');
    await page.goto(BASE_URL);
    const isDesktop = await page.evaluate(() => window.innerWidth >= 900);
    if (!isDesktop) { test.skip(); return; }
    await waitForGrid(page);
  });

  test('E30 — Le header desktop affiche les boutons de navigation (pas la bnav mobile)', async ({ page }) => {
    const headerNavBtns = page.locator('.k-header-nav-btn');
    expect(await headerNavBtns.count()).toBeGreaterThanOrEqual(3);
    await expect(headerNavBtns.first()).toBeVisible();

    // La bnav mobile doit être cachée en desktop
    const bnav = page.locator('#k-bnav');
    await expect(bnav).toBeHidden();
  });

  test('E30b — La grille catalogue s\'affiche en multi-colonnes (≥ 2)', async ({ page }) => {
    const grid = page.locator('#k-grid');
    const gridBox = await grid.boundingBox();
    const firstCard = page.locator('#k-grid .k-promo-card, #k-grid .k-card').first();
    const cardBox = await firstCard.boundingBox();

    // Si la grille fait > 800px et une carte < 50% de la grille → multi-colonnes
    expect(cardBox.width).toBeLessThan(gridBox.width * 0.6);
  });

  test('E31 — Ajout au panier → le side-cart permanent apparaît', async ({ page }) => {
    const sideCart = page.locator('#k-side-cart');
    // Avant ajout : pas de classe .has-items
    await expect(sideCart).not.toHaveClass(/has-items/);

    await openFirstCard(page);
    await addToCartFromModal(page);
    await closeModal(page);

    // Après ajout : le side-cart affiche les articles
    await expect(sideCart).toHaveClass(/has-items/, { timeout: 5_000 });
    const items = sideCart.locator('.k-sc-item');
    expect(await items.count()).toBeGreaterThanOrEqual(1);
  });

  test('E31b — Le side-cart affiche le total et le bouton Commander', async ({ page }) => {
    await openFirstCard(page);
    await addToCartFromModal(page);
    await closeModal(page);

    const sideCart = page.locator('#k-side-cart.has-items');
    await expect(sideCart).toBeVisible({ timeout: 5_000 });

    const total = page.locator('#k-sc-total');
    await expect(total).not.toBeEmpty();

    const checkoutBtn = page.locator('#k-sc-checkout');
    await expect(checkoutBtn).toBeVisible();
  });

  test('E32 — La recherche desktop ouvre le dropdown', async ({ page }) => {
    const input = page.locator('#k-search-input');
    await expect(input).toBeVisible({ timeout: 3_000 });

    const firstCardName = await page.locator('#k-grid .k-promo-card .k-card-name, #k-grid .k-card .k-card-name').first().textContent();
    await input.fill(firstCardName.trim().split(/\s+/)[0]);

    const dropdown = page.locator('#k-search-dropdown');
    await expect(dropdown).toHaveClass(/open/, { timeout: 5_000 });
  });

  // ── E32b — La recherche RETOURNE ce qu'elle trouve ─────────────────────────
  //
  // E32 ci-dessus n'assertait que l'ouverture du dropdown. Il pioche le nom
  // d'une carte TIRÉE AU SORT (le catalogue est mélangé côté client par
  // _shuffle/_balancedPick) et n'en garde que le PREMIER MOT — qui matche
  // toujours plusieurs produits. Il était donc structurellement incapable de
  // voir le défaut suivant, resté en production :
  //
  //   renderGrid() faisait passer les résultats de recherche par
  //   _balancedPick(), un sélecteur de VITRINE, qui détruisait des résultats :
  //     "chaussure" 15 trouvés →  14 rendus
  //     "football"  10 trouvés →   8 rendus (dont le Golden Product perdu)
  //     "elite"      1 trouvé  →   0 rendu   ← recherche exacte = page vide
  //
  //   Cause : MIN_PER_SECTION=4 jette les sections maigres, et
  //   `take >= 2 ? ... : 0` annule tout résultat unique. Plus la recherche
  //   était précise, moins le client trouvait.
  //
  // Ce test verrouille l'invariant que E32 ne couvrait pas : ce que le filtre
  // trouve doit arriver à l'écran. Il s'appuie sur le Golden Product, dont
  // l'identité est stable et le nom unique dans le catalogue — donc aucune
  // dépendance au tirage, contrairement à E32.
  test('E32b — Une recherche précise rend exactement le produit trouvé (anti-_balancedPick)', async ({ page }) => {
    const GOLDEN_ID_PREFIX = 'aaaaaaaa-1111';
    const GOLDEN_NAME = 'Chaussure de football Elite Pro';
    const QUERY = 'Elite Pro';

    // Précondition dure : sans Golden Product dans l'environnement, cet
    // invariant n'est pas prouvable. FAIL explicite, jamais de skip silencieux.
    const expected = await page.evaluate(async ({ q, prefix }) => {
      const res = await fetch('/api/products?limit=1000');
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const json = await res.json();
      const all = Array.isArray(json) ? json : (json.products || json.data || []);
      // Réplique EXACTE du prédicat de b-catalog.js (handler #k-search-input).
      const needle = q.trim().toLowerCase();
      const hits = all.filter((p) =>
        (p.name || '').toLowerCase().includes(needle)
        || (p.category || '').toLowerCase().includes(needle)
        || (p.description || '').toLowerCase().includes(needle));
      return {
        total: all.length,
        hits: hits.length,
        goldenPresent: all.some((p) => String(p.id).startsWith(prefix)),
        goldenMatche: hits.some((p) => String(p.id).startsWith(prefix)),
      };
    }, { q: QUERY, prefix: GOLDEN_ID_PREFIX });

    expect(expected.error, 'catalogue inaccessible').toBeUndefined();
    expect(
      expected.goldenPresent,
      `Golden Product absent du catalogue (${expected.total} produits) — seed non joué sur cet environnement`
    ).toBe(true);
    expect(expected.goldenMatche, `"${QUERY}" doit matcher "${GOLDEN_NAME}" dans les données`).toBe(true);

    // ── Le geste utilisateur ──
    // Le handler de recherche est debouncé à 250 ms (b-catalog.js). Sans
    // attendre son application, on mesurerait la grille d'AVANT la recherche
    // et le test passerait/échouerait pour la mauvaise raison.
    const countCards = () => page.locator('#k-grid .k-card, #k-grid .k-promo-card').count();
    const before = await countCards();

    await page.locator('#k-search-input').fill(QUERY);

    // Attendre que le debounce ait réellement muté la grille.
    await expect
      .poll(countCards, { timeout: 6_000, message: 'la recherche n\'a jamais modifié la grille (debounce non appliqué ?)' })
      .not.toBe(before);

    const rendered = await page.locator('#k-grid .k-card, #k-grid .k-promo-card')
      .evaluateAll((cards) => [...new Set(cards.map((c) => c.getAttribute('data-id')).filter(Boolean))]);

    // ── L'invariant : trouvé ⇒ rendu. Aucune perte entre filtre et écran. ──
    expect(
      rendered.length,
      `la recherche "${QUERY}" trouve ${expected.hits} produit(s) mais n'en rend que ${rendered.length}`
      + ' — un sélecteur de vitrine détruit des résultats de recherche'
    ).toBe(expected.hits);

    expect(
      rendered.some((id) => id.startsWith(GOLDEN_ID_PREFIX)),
      `"${QUERY}" ne rend pas "${GOLDEN_NAME}" alors que le filtre le trouve`
    ).toBe(true);
  });
});
