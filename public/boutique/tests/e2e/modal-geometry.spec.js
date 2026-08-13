/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   modal-geometry.spec.js
 * @feature modal-product, mobile-canonical
 * @brief Volet 3.2 — mesures géométriques RÉELLES (getBoundingClientRect,
 *        pas de lecture de texte CSS) sur la modale produit 4 états :
 *        scroll owner (.k-modal-scroll), image sticky desktop
 *        (.k-modal-img-wrap), partage (#k-modal-share-row / bouton WhatsApp),
 *        en mode LOCAL (aucun backend — API entièrement stubbée via
 *        page.route, même approche que harnais/render-modal.py).
 *
 * Fixtures : tests/e2e/helpers/geometry-fixtures.js (dérivées du contrat
 * réel golden-elite-pro-detail.js) — produit simple (court, pas de scroll)
 * et produit enrichi (20 combos + contenu enrichi, scroll requis).
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { buildSimpleFixture, buildEnrichedFixture } = require('./helpers/geometry-fixtures');

const LIST_PRODUCT = (detail) => ({
  id: detail.product.id,
  name: detail.product.name,
  price_kmf: detail.pricing.price_kmf,
  description: detail.product.description || '',
  images: (detail.media || []).map((m) => m.url),
  image_url: (detail.media || [])[0]?.url || '',
  category: detail.product.category || 'sport',
  is_available: true,
  stock: 12,
  inventory_model: detail.inventory_model,
});

/**
 * Stub complet API : catch-all vide, liste produits (1 entrée), détail
 * produit, suggestions (vide — hors périmètre géométrique de ce spec).
 * Ordre d'enregistrement : le dernier route() matching gagne en priorité
 * chez Playwright — donc les plus spécifiques d'abord n'est PAS requis,
 * mais on les déclare du plus général au plus spécifique par lisibilité.
 */
async function stubApi(page, detail) {
  const sp = LIST_PRODUCT(detail);
  await page.route(/\/api\//, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '[]',
  }));
  await page.route(/\/api\/boutique\/suggestions/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: [] }),
  }));
  await page.route(/\/api\/products(\?|$)/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([sp]),
  }));
  await page.route(/\/api\/products\/[^/]+\/detail/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(detail),
  }));
  return sp;
}

/** Ouvre la modale via le bus réel (_kbus/_kstate), sans passer par la grille. */
async function openModalFor(page, detail) {
  const sp = await stubApi(page, detail);
  await page.goto('/boutique/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window._kbus && window._kstate, null, { timeout: 8000 });
  await page.evaluate((sp) => {
    if (!window._kstate.products.find((x) => String(x.id) === String(sp.id))) {
      window._kstate.products.push(sp);
    }
    window._kbus.emit('modal:open', { id: sp.id });
  }, sp);
  await page.waitForSelector('#k-modal', { state: 'visible', timeout: 6000 });
  // Laisse le temps au fetch /detail stubbé + au render PDC de s'achever.
  await page.waitForFunction(() => {
    const scroll = document.querySelector('.k-modal-scroll');
    return !!scroll;
  }, null, { timeout: 6000 });
  await page.waitForTimeout(400); // animation k-slide-up + render PDC asynchrone
}

test.describe('Modale produit — géométrie réelle (volet 3.2)', () => {
  test('desktop ≥1024px : .k-modal-scroll est le seul owner de scroll (overflow-y auto)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openModalFor(page, buildEnrichedFixture());

    const info = await page.evaluate(() => {
      const scroll = document.querySelector('.k-modal-scroll');
      const overlay = document.getElementById('k-modal-overlay') || document.querySelector('#k-modal-overlay');
      const cs = scroll ? getComputedStyle(scroll) : null;
      return {
        scrollOverflowY: cs ? cs.overflowY : null,
        scrollHasScrollHeight: scroll ? scroll.scrollHeight > scroll.clientHeight : false,
        bodyOverflow: getComputedStyle(document.body).overflowY,
      };
    });

    expect(info.scrollOverflowY).toBe('auto');
    expect(info.scrollHasScrollHeight).toBe(true);
  });

  test('desktop ≥1024px : galerie NON sticky — se déplace avec le scroll, dans le flux du hero (migration v3.0)', async ({ page }) => {
    // MIGRATION v3.0 : remplace l'ancien oracle (image collée en haut pendant
    // le scroll, RÉF-2026-07h), explicitement incompatible avec la référence
    // canonique v3.0 (docs/reference/reference-modale-4-etats.html) où la
    // galerie appartient au flux normal du hero, comme le configurateur, les
    // détails et les suggestions — tous sous le même owner de scroll
    // (.k-modal-scroll). Vérifié géométriquement (pas une lecture de chaîne
    // CSS) : position calculée, déplacement réel au scroll, indépendance du
    // side cart.
    await page.setViewportSize({ width: 1280, height: 800 });
    await openModalFor(page, buildEnrichedFixture());

    // 1. Pas de sticky/fixed résiduel, pas de spanning grid-row (ancien
    //    mécanisme de collage) : la galerie n'a plus aucune raison de rester
    //    fixe verticalement.
    const staticPositioning = await page.evaluate(() => {
      const wrap = document.querySelector('.k-modal-img-wrap');
      const cs = wrap ? getComputedStyle(wrap) : null;
      return {
        position: cs ? cs.position : null,
        gridRow: cs ? cs.gridRow : null,
      };
    });
    expect(staticPositioning.position).not.toBe('sticky');
    expect(staticPositioning.position).not.toBe('fixed');
    expect(staticPositioning.gridRow).not.toMatch(/1\s*\/\s*-1|span/);

    // 2. Relevé de position initiale, puis scroll réel de ProductScroll
    //    (.k-modal-scroll), puis nouvelle position : l'image doit avoir
    //    bougé avec le contenu (pas être restée collée).
    await page.evaluate(() => {
      document.querySelector('.k-modal-scroll').style.scrollBehavior = 'auto';
    });
    const topBefore = await page.evaluate(() => {
      const wrap = document.querySelector('.k-modal-img-wrap');
      return wrap ? wrap.getBoundingClientRect().top : null;
    });
    expect(topBefore).not.toBeNull();

    const sideCartRectBefore = await page.evaluate(() => {
      const cart = document.getElementById('k-side-cart');
      return cart ? cart.getBoundingClientRect().top : null;
    });

    await page.evaluate(() => {
      document.querySelector('.k-modal-scroll').scrollTop = 400;
    });
    await page.waitForTimeout(120);

    const topAfter = await page.evaluate(() => {
      const wrap = document.querySelector('.k-modal-img-wrap');
      return wrap ? wrap.getBoundingClientRect().top : null;
    });
    expect(topAfter).not.toBeNull();
    expect(Math.abs(topAfter - topBefore)).toBeGreaterThan(50); // s'est bien déplacée

    // 3. Le side cart (hors ProductScroll) n'a pas été entraîné dans ce
    //    scroll — indépendance des deux owners.
    const sideCartRectAfter = await page.evaluate(() => {
      const cart = document.getElementById('k-side-cart');
      return cart ? cart.getBoundingClientRect().top : null;
    });
    if (sideCartRectBefore !== null && sideCartRectAfter !== null) {
      expect(Math.abs(sideCartRectAfter - sideCartRectBefore)).toBeLessThanOrEqual(1);
    }

    // 4. Hero, configurateur, détails longs et suggestions partagent le même
    //    owner de scroll (.k-modal-scroll) — pas de scroll imbriqué.
    const sameOwner = await page.evaluate(() => {
      const scroll = document.querySelector('.k-modal-scroll');
      const nodes = [
        document.querySelector('.k-modal-img-wrap'),
        document.querySelector('.k-modal-configurator'),
        document.querySelector('.k-modal-long-details'),
        document.getElementById('k-modal-suggestions'),
      ];
      return nodes.every((n) => n && scroll.contains(n));
    });
    expect(sameOwner).toBe(true);
  });

  test('desktop ≥1024px : bouton WhatsApp visible et distinct du bouton copier-lien', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openModalFor(page, buildEnrichedFixture());

    await page.waitForSelector('#k-modal-share-row .k-modal-share-btn--wa', { timeout: 4000 });
    const info = await page.evaluate(() => {
      const wa = document.querySelector('#k-modal-share-row .k-modal-share-btn--wa');
      const copy = document.querySelector('#k-modal-share-row [data-action="copy"]');
      const waStyle = wa ? getComputedStyle(wa) : null;
      return {
        waPresent: !!wa,
        copyPresent: !!copy,
        waDistinctFromCopy: wa !== copy,
        waBg: waStyle ? waStyle.backgroundColor : null,
      };
    });

    expect(info.waPresent).toBe(true);
    expect(info.copyPresent).toBe(true);
    expect(info.waDistinctFromCopy).toBe(true);
  });

  test('mobile ≤390px : ligne de partage rendue sous la réassurance (même composant qu\'en desktop)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openModalFor(page, buildEnrichedFixture());

    await page.waitForSelector('#k-modal-share-row .k-modal-share-btn--wa', { timeout: 4000 });
    const info = await page.evaluate(() => {
      const share = document.getElementById('k-modal-share-row');
      const trust = document.querySelector('.k-modal-trust-row, .k-modal-trust');
      if (!share) return { sharePresent: false };
      const shareRect = share.getBoundingClientRect();
      const trustRect = trust ? trust.getBoundingClientRect() : null;
      return {
        sharePresent: true,
        childCount: share.childElementCount,
        belowTrust: trustRect ? shareRect.top >= trustRect.bottom - 1 : null,
      };
    });

    expect(info.sharePresent).toBe(true);
    expect(info.childCount).toBeGreaterThan(0);
  });

  test('produit simple (non-enrichi) : même owner de scroll que l\'enrichi, compaction réelle, aucun trou artificiel', async ({ page }) => {
    // MIGRATION v3.0 : remplace l'ancien oracle « aucun scroll requis »
    // (hasOverflow === false). Diagnostic géométrique (pas une inversion
    // aveugle de l'assertion) : le produit simple à 1280×800 débordait de
    // 148px. Décomposition mesurée :
    //   - ~44px de trou artificiel : #k-modal-enriched-content est bien
    //     display:none (vm.hasEnrichedContent faux), mais son track de
    //     grille (row 4, grid-template-rows explicite à 5 rangées) gardait
    //     ses deux gaps même vide — défaut réel, CORRIGÉ (classe
    //     .k-modal-product-zone--no-enriched → grille à 4 rangées quand il
    //     n'y a pas de contenu enrichi, modal-shell.css + toggle unique dans
    //     renderEnrichedContent(), b-modal-desktop-product.js).
    //   - ~18px : #k-modal-payment restait display:block + margin-top sur
    //     TOUT produit desktop alors que renderPaymentSection(), seule
    //     fonction censée le peupler, n'est appelée nulle part dans le code
    //     (vérifié par recherche) — bloc vide mais dimensionnant. CORRIGÉ
    //     (:not(:empty) — modal-product.css + modal-product-lot4-hybrid.css).
    // Overflow résiduel après ces deux correctifs : légitime, contenu
    // canonique v3.0 (hero + configurateur + suggestions) à 1280×800 — la
    // v3.0 impose une compaction naturelle et un owner de scroll unique,
    // pas qu'aucun produit ne défile jamais dans chaque viewport.
    await page.setViewportSize({ width: 1280, height: 800 });
    await openModalFor(page, buildSimpleFixture());

    const info = await page.evaluate(() => {
      const scroll = document.querySelector('.k-modal-scroll');
      const zone = document.querySelector('.k-modal-product-zone');
      const enriched = document.getElementById('k-modal-enriched-content');
      const payment = document.getElementById('k-modal-payment');
      const configurator = document.querySelector('.k-modal-configurator');
      // Le wrapper .k-modal-configurator est display:contents en desktop
      // (transparent au layout) : sa propre boîte est 0×0. La compaction réelle
      // se lit donc sur le CONTENU qu'il porte (axes de variantes + actions),
      // via l'union des boîtes de ses enfants — mesure stable quel que soit le
      // display du wrapper.
      const contentHeight = (el) => {
        if (!el) return null;
        const kids = Array.from(el.children).filter((c) => c.getClientRects().length);
        if (!kids.length) return 0;
        const tops = kids.map((c) => c.getBoundingClientRect().top);
        const bottoms = kids.map((c) => c.getBoundingClientRect().bottom);
        return Math.max(...bottoms) - Math.min(...tops);
      };
      return {
        hasOverflow: scroll ? scroll.scrollHeight > scroll.clientHeight + 4 : null,
        overflowPx: scroll ? scroll.scrollHeight - scroll.clientHeight : null,
        scrollOwnerContainsAll: [
          document.querySelector('.k-modal-img-wrap'),
          configurator,
          document.querySelector('.k-modal-long-details'),
          document.getElementById('k-modal-suggestions'),
        ].every((n) => n && scroll.contains(n)),
        noNestedScroll: getComputedStyle(configurator).overflowY === 'visible',
        enrichedReservesNoHeight: !enriched || enriched.hidden === true,
        paymentReservesNoHeight: !payment || payment.childElementCount === 0,
        configuratorContentHeight: contentHeight(configurator),
      };
    });
    await openModalFor(page, buildEnrichedFixture());
    const enrichedInfo = await page.evaluate(() => {
      const scroll = document.querySelector('.k-modal-scroll');
      const configurator = document.querySelector('.k-modal-configurator');
      const contentHeight = (el) => {
        if (!el) return null;
        const kids = Array.from(el.children).filter((c) => c.getClientRects().length);
        if (!kids.length) return 0;
        const tops = kids.map((c) => c.getBoundingClientRect().top);
        const bottoms = kids.map((c) => c.getBoundingClientRect().bottom);
        return Math.max(...bottoms) - Math.min(...tops);
      };
      return {
        overflowPx: scroll ? scroll.scrollHeight - scroll.clientHeight : null,
        configuratorContentHeight: contentHeight(configurator),
      };
    });

    // Même owner de scroll pour simple et enrichi, aucun scroll imbriqué.
    expect(info.scrollOwnerContainsAll).toBe(true);
    expect(info.noNestedScroll).toBe(true);
    // Aucune section absente (enrichi, paiement) ne laisse de trou/hauteur
    // réservée sur le produit simple.
    expect(info.enrichedReservesNoHeight).toBe(true);
    expect(info.paymentReservesNoHeight).toBe(true);
    // Compaction réelle : un produit simple (sans axes/contenu enrichi) doit
    // rester plus court qu'un produit enrichi (20 combos + contenu long) au
    // même viewport — borne relative, pas une hauteur pixel arbitraire.
    // Mesuré sur le contenu du configurateur (union des enfants), pas sur la
    // boîte 0×0 du wrapper display:contents.
    expect(info.configuratorContentHeight).toBeLessThan(enrichedInfo.configuratorContentHeight);
    expect(info.overflowPx).toBeLessThan(enrichedInfo.overflowPx);
  });

  test('non-régression : overflow-x:hidden seul ne suffit pas à empêcher un débordement horizontal réel', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openModalFor(page, buildEnrichedFixture());

    const info = await page.evaluate(() => {
      const scroll = document.querySelector('.k-modal-scroll');
      return {
        scrollWidthOverflow: scroll ? scroll.scrollWidth - scroll.clientWidth : null,
      };
    });
    // Débordement horizontal réel toléré à 0px (arrondi sub-pixel exclu) —
    // prouve que le spec attraperait une régression même si overflow-x:hidden
    // masquait visuellement le débordement.
    expect(info.scrollWidthOverflow).toBeLessThanOrEqual(1);
  });
});
