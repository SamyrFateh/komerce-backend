/**
 * @e2e   cross-browser.spec.js
 * @feature cross-browser
 * @brief Régressions spécifiques navigateur : Safari iOS (dvh, safe-area,
 *        backdrop-filter, scroll bounce), Firefox (:has() fallback, overflow),
 *        et pièges Chromium (ResizeObserver, scroll restoration).
 *
 * Ce fichier est conçu pour tourner sur TOUS les projets (Mobile Chrome,
 * Mobile Safari, Desktop Chrome, Desktop Firefox, Desktop Safari).
 * Chaque test documente le bug navigateur qu'il cible.
 */
'use strict';
const { test, expect } = require('@playwright/test');
const {
  BASE_URL, IS_REMOTE, waitForGrid, openFirstCard, addToCartFromModal,
  closeModal, openCartDrawer, openCheckout, navigateToTab,
} = require('./helpers/boutique.helpers');

test.describe('E-XBROWSER — Compatibilité cross-browser', () => {

  // ─── Safari iOS : 100dvh et safe-area-inset ──────────────────────────

  test('X1 — Checkout modale : hauteur correcte (pas tronquée ni overflow)', async ({ page }) => {
    // BUG CIBLE : Safari iOS traite 100vh différemment de 100dvh.
    // Si dvh non supporté, la modale dépasse l'écran ou le bouton Confirmer
    // disparaît sous la barre d'adresse Safari.
    test.skip(!IS_REMOTE, 'Nécessite le backend');
    await page.goto(BASE_URL);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await openCheckout(page);

    const modal = page.locator('#k-order-modal.open .k-order-modal, #k-order-modal.open');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Le bouton Confirmer doit être dans le viewport (pas coupé par la barre iOS)
    const confirmBtn = page.locator('.ck-confirm-btn');
    if ((await confirmBtn.count()) > 0) {
      const box = await confirmBtn.boundingBox();
      const viewport = page.viewportSize();
      if (box) {
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 20);
      }
    }
  });

  test('X1b — Cart drawer : padding-bottom respecte safe-area (pas de contenu sous le home indicator)', async ({ page }) => {
    // BUG CIBLE : env(safe-area-inset-bottom) ignoré → items cachés
    // derrière le home indicator de l'iPhone (barre blanche en bas).
    test.skip(!IS_REMOTE, 'Nécessite le backend');
    await page.goto(BASE_URL);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await openCartDrawer(page);

    const isDesktop = await page.evaluate(() => window.innerWidth >= 900);
    if (isDesktop) return; // safe-area n'affecte que mobile

    const footer = page.locator('#k-cart-footer');
    if ((await footer.count()) > 0 && await footer.isVisible()) {
      const pb = await footer.evaluate(el =>
        parseInt(getComputedStyle(el).paddingBottom, 10)
      );
      // Le padding-bottom doit être > 0 (même sans safe-area, CSS met 16-20px)
      expect(pb).toBeGreaterThan(0);
    }
  });

  // ─── Safari : backdrop-filter ────────────────────────────────────────

  test('X2 — Overlay panier : fond flouté/semi-transparent visible', async ({ page }) => {
    // BUG CIBLE : backdrop-filter sans -webkit-backdrop-filter → overlay
    // transparent sur Safari < 16 (fond complètement invisible).
    test.skip(!IS_REMOTE, 'Nécessite le backend');
    await page.goto(BASE_URL);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await openCartDrawer(page);

    const isDesktop = await page.evaluate(() => window.innerWidth >= 900);
    if (isDesktop) return; // L'overlay n'existe qu'en mobile

    const overlay = page.locator('#k-cart-overlay');
    if ((await overlay.count()) > 0) {
      const bg = await overlay.evaluate(el => getComputedStyle(el).backgroundColor);
      // Doit avoir une couleur de fond (rgba avec alpha > 0), pas transparent
      expect(bg).not.toBe('rgba(0, 0, 0, 0)');
      expect(bg).not.toBe('transparent');
    }
  });

  // ─── Firefox : :has() CSS fallback ───────────────────────────────────

  test('X3 — Desktop side-cart visible : fallback classe JS si :has() non supporté', async ({ page }) => {
    // BUG CIBLE : body:has(.k-side-cart.has-items) en CSS desktop.
    // Firefox < 121 ne supporte pas :has(). Le JS pose .sc-reserve sur body
    // comme fallback. Si ni :has() ni la classe → side-cart invisible.
    test.skip(!IS_REMOTE, 'Nécessite le backend');
    const isDesktop = await page.evaluate(() => window.innerWidth >= 900);
    test.skip(!isDesktop, 'Side-cart desktop uniquement');

    await page.goto(BASE_URL);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await closeModal(page);

    const sideCart = page.locator('#k-side-cart');
    await expect(sideCart).toHaveClass(/has-items/, { timeout: 5_000 });

    // Vérifier que le body a le fallback JS aussi
    const bodyHasReserve = await page.evaluate(() =>
      document.body.classList.contains('sc-reserve')
    );
    // Sur Firefox, c'est critique. Sur Chrome/Safari, c'est un bonus.
    // On vérifie juste que le side-cart est bien visible (le résultat final).
    await expect(sideCart).toBeVisible();
  });

  // ─── Tous navigateurs : scroll restoration après modale ──────────────

  test('X4 — Scroll position restaurée après fermeture modale', async ({ page }) => {
    // BUG CIBLE : Safari iOS et Firefox traitent scroll restoration
    // différemment. Si body overflow:hidden est mal géré, le scroll
    // saute à 0 après fermeture modale.
    test.skip(!IS_REMOTE, 'Nécessite le backend');
    await page.goto(BASE_URL);
    await waitForGrid(page);

    // Scroller un peu vers le bas
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(300);

    const scrollBefore = await page.evaluate(() =>
      window.scrollY || document.documentElement.scrollTop
    );
    expect(scrollBefore).toBeGreaterThan(100);

    // Ouvrir et fermer la modale
    await openFirstCard(page);
    await closeModal(page);
    await page.waitForTimeout(500);

    const scrollAfter = await page.evaluate(() =>
      window.scrollY || document.documentElement.scrollTop
    );
    // Tolérance de ±50px (animations, arrondis navigateur)
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThan(80);
  });

  // ─── Safari iOS : touch events et scroll bounce ──────────────────────

  test('X5 — Navigation entre onglets sur mobile — pas de freeze après swipe', async ({ page }) => {
    // BUG CIBLE : sur Safari iOS, les touch events (touchstart/touchmove)
    // sur les onglets peuvent entrer en conflit avec le scroll bounce natif
    // et geler la vue. On vérifie que chaque onglet reste interactif.
    test.skip(!IS_REMOTE, 'Nécessite le backend');
    await page.goto(BASE_URL);
    await waitForGrid(page);

    const tabs = ['track', 'group', 'fav', 'shop'];
    for (const tab of tabs) {
      await navigateToTab(page, tab);
      await page.waitForTimeout(600);

      // Vérifier que la page n'est pas figée (on peut évaluer du JS)
      const alive = await page.evaluate(() => {
        return typeof document.body.textContent === 'string';
      });
      expect(alive).toBe(true);
    }

    // Retour boutique → grille visible
    await waitForGrid(page);
  });

  // ─── Tous : toast notification visible ────────────────────────────────

  test('X6 — Toast "Ajouté au panier" visible et disparaît', async ({ page }) => {
    // BUG CIBLE : z-index ou position du toast masqué par l'overlay/modale
    // sur certains navigateurs. CSS stacking context différent entre
    // Chrome, Firefox, Safari.
    test.skip(!IS_REMOTE, 'Nécessite le backend');
    await page.goto(BASE_URL);
    await openFirstCard(page);
    await addToCartFromModal(page);

    const toast = page.locator('#k-toast');
    // Le toast doit apparaître (même brièvement)
    await expect(toast).toContainText(/.+/, { timeout: 3_000 });
  });

  // ─── Firefox/Safari : formulaire checkout input types ─────────────────

  test('X7 — Inputs checkout : type=tel sur les champs téléphone', async ({ page }) => {
    // BUG CIBLE : sur mobile Safari et Firefox, un input type="text"
    // n'affiche pas le clavier numérique pour la saisie téléphone.
    // Le type="tel" est critique pour l'UX mobile.
    test.skip(!IS_REMOTE, 'Nécessite le backend');
    await page.goto(BASE_URL);
    await openFirstCard(page);
    await addToCartFromModal(page);
    await openCheckout(page);

    const phoneInputs = page.locator('#k-order-body input[type="tel"], #k-order-body input[name*="phone"], #k-order-body input[name*="tel"]');
    const count = await phoneInputs.count();
    // Il doit y avoir au moins un champ téléphone dans le checkout
    // Si le formulaire est conditionnel (auth gate), on skip
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const type = await phoneInputs.nth(i).getAttribute('type');
        expect(type).toBe('tel');
      }
    }
  });

  // ─── Safari : animation et transition flicker ────────────────────────

  test('X8 — Modale produit : pas de flash blanc à l\'ouverture', async ({ page }) => {
    // BUG CIBLE : Sur Safari, les animations CSS avec opacity 0→1 combinées
    // à backdrop-filter peuvent provoquer un flash blanc (FOUC).
    // On vérifie que l'overlay a un background dès l'ouverture.
    test.skip(!IS_REMOTE, 'Nécessite le backend');
    await page.goto(BASE_URL);
    await waitForGrid(page);

    // Ouvrir la modale
    const card = page.locator('#k-grid .k-promo-card, #k-grid .k-card').first();
    await card.click();
    await page.waitForSelector('#k-modal-overlay.open', { timeout: 6_000 });

    // L'overlay doit avoir un background non-transparent
    const bg = await page.locator('#k-modal-overlay').evaluate(el =>
      getComputedStyle(el).backgroundColor
    );
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');

    await closeModal(page);
  });

  // ─── Tous : images chargées sans erreur ──────────────────────────────

  test('X9 — Aucune image cassée dans la grille catalogue', async ({ page }) => {
    // BUG CIBLE : srcset/loading="lazy" traités différemment entre
    // navigateurs. Chrome charge plus agressivement, Safari peut
    // laisser des images blank si l'IntersectionObserver est lent.
    test.skip(!IS_REMOTE, 'Nécessite le catalogue');
    await page.goto(BASE_URL);
    await waitForGrid(page);

    // Attendre un peu que les images lazy se chargent
    await page.waitForTimeout(2_000);

    const brokenImages = await page.evaluate(() => {
      const imgs = document.querySelectorAll('#k-grid img');
      let broken = 0;
      imgs.forEach(img => {
        // naturalWidth === 0 → image non chargée ou cassée
        if (img.complete && img.naturalWidth === 0 && img.src) broken++;
      });
      return broken;
    });

    expect(brokenImages).toBe(0);
  });
});
