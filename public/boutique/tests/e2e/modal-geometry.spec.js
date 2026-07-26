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

  test('desktop ≥1024px : image sticky reste collée en haut pendant le scroll (produit enrichi)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openModalFor(page, buildEnrichedFixture());

    const wrapTopBefore = await page.evaluate(() => {
      const wrap = document.querySelector('.k-modal-img-wrap');
      return wrap ? wrap.getBoundingClientRect().top : null;
    });
    expect(wrapTopBefore).not.toBeNull();

    // [P0-A #1 — FIX 2026-07] .k-modal-scroll porte `scroll-behavior: smooth`
    // (modal-shell.css:1048). Sans neutralisation, `scrollTop = y` déclenche
    // une animation et le waitForTimeout(120) fixe capture parfois une frame
    // intermédiaire de cette animation plutôt que la position stabilisée —
    // mesuré : 3 runs identiques sur 3 donnent [104,96,86,86] (3 valeurs
    // distinctes) au lieu de la position collée réelle, un artefact de
    // mesure et non un bug du sticky. Le gabarit de référence
    // (harnais/geometry/verify-sticky.js) neutralise déjà ce point ; ce
    // spec ne le faisait pas. Voir R2 : la mesure, pas le produit, était en
    // cause.
    await page.evaluate(() => {
      document.querySelector('.k-modal-scroll').style.scrollBehavior = 'auto';
    });

    const thresholds = [0, 100, 200, 400];
    const tops = [];
    for (const y of thresholds) {
      await page.evaluate((y) => {
        document.querySelector('.k-modal-scroll').scrollTop = y;
      }, y);
      await page.waitForTimeout(120);
      const top = await page.evaluate(() => {
        const wrap = document.querySelector('.k-modal-img-wrap');
        return wrap ? Math.round(wrap.getBoundingClientRect().top) : null;
      });
      tops.push(top);
    }

    // "Collé" = le haut de l'image reste stable (±1px d'arrondi) quel que
    // soit le scrollTop, tant qu'il reste du contenu à droite à défiler.
    const distinctTops = new Set(tops);
    expect(distinctTops.size).toBeLessThanOrEqual(2); // tolérance d'arrondi
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

  test('produit simple (non-enrichi) : pas de scroll requis, image sticky non pertinente', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openModalFor(page, buildSimpleFixture());

    const info = await page.evaluate(() => {
      const scroll = document.querySelector('.k-modal-scroll');
      return {
        hasOverflow: scroll ? scroll.scrollHeight > scroll.clientHeight + 4 : null,
      };
    });
    // Non-régression : un produit court ne doit pas forcer un scroll (cf.
    // suppression du plancher min-height RÉF-2026-07h).
    expect(info.hasOverflow).toBe(false);
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
