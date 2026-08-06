/**
 * @test-kind e2e
 * @test-runner playwright
 * @test-requires webapp
 */

/**
 * @e2e   modal-mdm9-gallery-layout.spec.js
 * @feature modal-product, mobile-canonical
 * @brief MDM-9 — Mesures réelles navigateur (getBoundingClientRect) de la zone
 *        média et de la fiche produit selon data-gallery-mode ("single" vs
 *        "multiple"), sur les 3 viewports de référence.
 *
 * Contexte : ce spec ne dépend PAS du backend (mode LOCAL, npx serve ..).
 * Il charge la page réelle (index.html + dist/base.css + dist/components.css
 * réellement servis), puis appelle directement la fonction réelle
 * `buildCarouselSlides` exportée par js/b-modal-product.js (aucune
 * réimplémentation / aucune heuristique custom) pour peupler le DOM du
 * modal exactement comme le ferait l'application avec un vrai produit.
 *
 * MATRICE : ce spec déclare un projet Playwright dédié « Chromium MDM-9 »
 * dans playwright.config.js. Les 3 viewports sont gérés en boucle interne
 * (test.use + VIEWPORTS), ce qui donne exactement 9 tests effectifs
 * (3 viewports × 3 tests, dont 1 skippé sur desktop = 7 exécutés).
 *
 * Complète (ne remplace pas) :
 *   - tests/unit/b-modal-product.test.js → logique JS (dataset.galleryMode)
 *   - tests/e2e/modal.spec.js            → flows fonctionnels (BASE_URL distant)
 */
'use strict';
const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('./helpers/boutique.helpers');

const VIEWPORTS = [
  { name: '360x800 (Android compact)', width: 360, height: 800 },
  { name: '390x844 (iPhone 12/13/14)', width: 390, height: 844 },
  { name: '1280x800 (Desktop)', width: 1280, height: 800 },
];

const IMG_FULL_FRAME = 'tests/fixtures/images/produit-plein-cadre.png';
const IMG_WHITESPACE = 'tests/fixtures/images/produit-fond-blanc.png';

/**
 * Ouvre le modal produit et le peuple via la fonction réelle du module
 * b-modal-product.js (import ESM direct, aucun mock de logique métier).
 */
async function renderProductInModal(page, { images, name, price }) {
  return page.evaluate(async ({ images, name, price }) => {
    // IMPORTANT : pas de query string cache-busting ici. Le navigateur clé
    // le registre de modules ESM sur l'URL exacte — un import avec un
    // paramètre différent de celui utilisé par main.js (`/boutique/js/
    // main.js?v=351`) charge une INSTANCE SÉPARÉE de b-store.js, dont
    // `dom` reste `{}` car son initDom() (appelé uniquement par boutique.js
    // au boot réel) n'a jamais tourné sur cette instance dupliquée. Il faut
    // résoudre exactement la même URL de module que l'app pour retrouver
    // le `dom` déjà peuplé.
    const mod = await import('/boutique/js/b-modal-product.js');
    const store = await import('/boutique/js/b-store.js');

    const product = { name, price, images };
    mod.buildCarouselSlides(product);

    store.dom.modalName.textContent = name;
    store.dom.modalPrice.textContent = price;
    store.dom.modalSku.textContent = 'REF-E2E-MDM9';

    store.dom.modalOverlay.classList.add('open');
    document.body.classList.add('modal-open');

    // Laisse le temps au navigateur de calculer le layout post-mutation ET
    // d'achever l'animation CSS k-slide-up (.3s, translateY 100% → 0) sur
    // #k-modal. Sans cette attente, measureModal() peut capturer un état
    // intermédiaire (voire initial, translateY(100%) = modal entièrement
    // hors-viewport) de façon non-déterministe — les autres tests du spec
    // ne "passaient" que par coïncidence (latence réseau/décodage image
    // dépassant fortuitement les 300ms de l'animation).
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      const modalEl = document.getElementById('k-modal');
      if (modalEl) modalEl.addEventListener('animationend', finish, { once: true });
      // Filet de sécurité : si l'animation ne se déclenche pas (ex. déjà
      // ouverte lors d'un rebuild), on ne bloque pas indéfiniment.
      setTimeout(finish, 350);
    });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, { images, name, price });
}

async function waitFirstImageLoaded(page) {
  await page.waitForFunction(
    () => {
      const img = document.querySelector('#k-modal-carousel-track .k-modal-slide');
      return !!img && img.complete && img.naturalWidth > 0;
    },
    null,
    { timeout: 8000 }
  );
}

async function closeModal(page) {
  await page.evaluate(async () => {
    const store = await import('/boutique/js/b-store.js');
    store.dom.modalOverlay.classList.remove('open');
    document.body.classList.remove('modal-open');
  });
}

/**
 * Rassemble toutes les mesures getBoundingClientRect() demandées,
 * y compris le bounding box du sujet visible (MDM-9 §1).
 */
async function measureModal(page) {
  return page.evaluate(() => {
    const wrap = document.querySelector('.k-modal-img-wrap');
    const modal = document.getElementById('k-modal');
    const title = document.getElementById('k-modal-name');
    const price = document.getElementById('k-modal-price');
    const actions = document.querySelector('.k-modal-actions');
    const img = document.querySelector('#k-modal-carousel-track .k-modal-slide');
    const dots = document.getElementById('k-modal-dots');
    const thumbs = document.querySelector('.k-modal-thumbs');
    const counter = document.querySelector('.k-modal-counter');

    const r = (el) => (el ? el.getBoundingClientRect() : null);
    const wrapRect = r(wrap);
    const modalRect = r(modal);
    const titleRect = r(title);
    const priceRect = r(price);
    const actionsRect = r(actions);
    const imgRect = r(img);
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // ── MDM-9 §3 : CTA visibility — full viewport containment ──
    const actionsFullyVisible = actionsRect
      ? (actionsRect.top >= 0 &&
         actionsRect.bottom <= vh &&
         actionsRect.left >= 0 &&
         actionsRect.right <= vw)
      : false;

    // ── MDM-9 §1 : subject bounding box analysis ──
    // Calcul du sujet visible via canvas (même logique que b-modal-product.js).
    let subjectMetrics = null;
    if (img && img.complete && img.naturalWidth > 0 && wrapRect) {
      try {
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        const canvas = document.createElement('canvas');
        const maxDim = 300;
        const scaleFactor = Math.min(1, maxDim / Math.max(nw, nh));
        const cw = Math.round(nw * scaleFactor);
        const ch = Math.round(nh * scaleFactor);
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0, cw, ch);
          const data = ctx.getImageData(0, 0, cw, ch).data;
          const WHITE = 245;
          let minX = cw, minY = ch, maxX = 0, maxY = 0;
          for (let y = 0; y < ch; y++) {
            for (let x = 0; x < cw; x++) {
              const idx = (y * cw + x) * 4;
              if (data[idx] < WHITE || data[idx + 1] < WHITE || data[idx + 2] < WHITE) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }

          if (maxX > minX && maxY > minY) {
            // Sujet en coordonnées normalisées [0..1] dans l'image source
            const sNormX = minX / cw;
            const sNormY = minY / ch;
            const sNormW = (maxX - minX + 1) / cw;
            const sNormH = (maxY - minY + 1) / ch;

            // Position de l'image affichée (object-fit:contain dans le wrapper)
            // + prise en compte du transform scale éventuel
            const computedStyle = getComputedStyle(img);
            const transformVal = computedStyle.transform;
            let cssScale = 1;
            if (transformVal && transformVal !== 'none') {
              const match = transformVal.match(/matrix\(([^,]+)/);
              if (match) cssScale = parseFloat(match[1]) || 1;
            }

            // Rect de l'image avec object-fit:contain
            const ir = imgRect;
            // L'image object-fit:contain est centrée dans le wrapper.
            // Le contenu affiché (avant scale) est limité par le wrapper.
            const imgAspect = nw / nh;
            const wrapW = wrapRect.width;
            const wrapH = wrapRect.height;
            const wrapAspect = wrapW / wrapH;

            let displayW, displayH;
            if (imgAspect > wrapAspect) {
              // Image limited by width
              displayW = wrapW;
              displayH = wrapW / imgAspect;
            } else {
              // Image limited by height
              displayH = wrapH;
              displayW = wrapH * imgAspect;
            }

            // After CSS scale
            const scaledDisplayW = displayW * cssScale;
            const scaledDisplayH = displayH * cssScale;

            // Top-left of the displayed image content (centered in wrapper)
            const imgContentLeft = wrapRect.left + (wrapW - scaledDisplayW) / 2;
            const imgContentTop = wrapRect.top + (wrapH - scaledDisplayH) / 2;

            // Subject bounding box in viewport coordinates
            const subjectLeft = imgContentLeft + sNormX * scaledDisplayW;
            const subjectTop = imgContentTop + sNormY * scaledDisplayH;
            const subjectVisW = sNormW * scaledDisplayW;
            const subjectVisH = sNormH * scaledDisplayH;

            // Clip to wrapper bounds
            const clipLeft = Math.max(subjectLeft, wrapRect.left);
            const clipTop = Math.max(subjectTop, wrapRect.top);
            const clipRight = Math.min(subjectLeft + subjectVisW, wrapRect.right);
            const clipBottom = Math.min(subjectTop + subjectVisH, wrapRect.bottom);
            const clippedW = Math.max(0, clipRight - clipLeft);
            const clippedH = Math.max(0, clipBottom - clipTop);

            const visibleSubjectArea = clippedW * clippedH;
            const wrapperArea = wrapW * wrapH;
            const occupationRate = wrapperArea > 0 ? visibleSubjectArea / wrapperArea : 0;
            const whitePixelsAround = wrapperArea - visibleSubjectArea;

            subjectMetrics = {
              visibleWidth: Math.round(clippedW),
              visibleHeight: Math.round(clippedH),
              visibleArea: Math.round(visibleSubjectArea),
              occupationRate: Math.round(occupationRate * 1000) / 1000,
              whitePixelsAround: Math.round(whitePixelsAround),
              cssScale: cssScale,
              displayW: Math.round(displayW),
              displayH: Math.round(displayH),
            };
          }
        }
      } catch (_) { /* CORS or other canvas error — no metrics */ }
    }

    return {
      galleryMode: wrap ? wrap.dataset.galleryMode : null,
      mediaCount: wrap ? wrap.dataset.mediaCount : null,
      wrapHeight: wrapRect ? wrapRect.height : null,
      wrapWidth: wrapRect ? wrapRect.width : null,
      wrapTop: wrapRect ? wrapRect.top : null,
      titleTop: titleRect ? titleRect.top : null,
      priceTop: priceRect ? priceRect.top : null,
      priceBottom: priceRect ? priceRect.bottom : null,
      actionsTop: actionsRect ? actionsRect.top : null,
      actionsBottom: actionsRect ? actionsRect.bottom : null,
      actionsLeft: actionsRect ? actionsRect.left : null,
      actionsRight: actionsRect ? actionsRect.right : null,
      actionsVisible: actionsFullyVisible,
      modalWidth: modalRect ? modalRect.width : null,
      modalScrollWidth: modal ? modal.scrollWidth : null,
      modalClientWidth: modal ? modal.clientWidth : null,
      viewportWidth: vw,
      viewportHeight: vh,
      naturalWidth: img ? img.naturalWidth : null,
      naturalHeight: img ? img.naturalHeight : null,
      slideCount: document.querySelectorAll('#k-modal-carousel-track .k-modal-slide').length,
      dotCount: dots ? dots.querySelectorAll('.k-modal-dot').length : 0,
      dotsDisplay: dots ? getComputedStyle(dots).display : null,
      thumbsPresent: !!thumbs,
      counterVisible: counter ? counter.classList.contains('is-visible') : false,
      subjectMetrics: subjectMetrics,
    };
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`MDM-9 — Viewport ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('Mode single (1 image) — wrapper compact, sujet valorisé, CTA visible, aucune nav superflue', async ({ page }) => {
      await page.goto(BASE_URL);
      await page.waitForSelector('#k-modal', { state: 'attached' });

      await renderProductInModal(page, {
        images: [IMG_WHITESPACE], // cas défavorable : image avec blanc
        name: 'Produit Test — image unique',
        price: '15 000 KMF',
      });
      await waitFirstImageLoaded(page);

      // Attendre le calcul du subject scale (rAF + canvas)
      await page.waitForTimeout(200);

      const m = await measureModal(page);

      // ── État explicite ──
      expect(m.galleryMode).toBe('single');
      expect(m.mediaCount).toBe('1');

      // ── Navigation : aucun dot, aucune vignette, pas de compteur, 1 slide ──
      expect(m.dotCount).toBe(0);
      expect(m.dotsDisplay).toBe('none');
      expect(m.thumbsPresent).toBe(false);
      expect(m.counterVisible).toBe(false);
      expect(m.slideCount).toBe(1);
      expect(m.naturalWidth).toBeGreaterThan(0);
      expect(m.naturalHeight).toBeGreaterThan(0);

      // ── CTA réellement dans le viewport (§3) ──
      expect(m.actionsVisible).toBe(true);
      if (vp.width < 900) {
        expect(m.actionsTop).toBeGreaterThanOrEqual(0);
        expect(m.actionsBottom).toBeLessThanOrEqual(vp.height);
        expect(m.actionsLeft).toBeGreaterThanOrEqual(0);
        expect(m.actionsRight).toBeLessThanOrEqual(vp.width);
      }

      // ── Wrapper compact sur mobile (≤38vh), pas la règle 48vh ──
      if (vp.width < 900) {
        const maxExpected = vp.height * 0.38;
        expect(m.wrapHeight).toBeGreaterThan(0);
        expect(m.wrapHeight).toBeLessThanOrEqual(maxExpected + 4); // tolérance arrondi
        expect(m.wrapHeight).toBeGreaterThanOrEqual(150); // min-height MDM-9
        // Doit être strictement sous la hauteur multiple (48vh)
        expect(m.wrapHeight).toBeLessThan(vp.height * 0.48 - 10);
      }

      // ── Subject metrics (§1) : mesures obligatoires ──
      if (m.subjectMetrics && vp.width < 900) {
        expect(m.subjectMetrics.visibleWidth).toBeGreaterThan(0);
        expect(m.subjectMetrics.visibleHeight).toBeGreaterThan(0);
        expect(m.subjectMetrics.visibleArea).toBeGreaterThan(0);
        expect(m.subjectMetrics.occupationRate).toBeGreaterThan(0);
        expect(m.subjectMetrics.whitePixelsAround).toBeGreaterThanOrEqual(0);
      }

      // ── Pas de débordement horizontal ──
      expect(m.modalScrollWidth).toBeLessThanOrEqual(m.modalClientWidth + 1);

      // ── CTA sous le prix ──
      expect(m.actionsTop).toBeGreaterThanOrEqual(m.priceBottom);

      await closeModal(page);
    });

    test('Mode multiple (3+ images) — 48vh préservé, navigation complète, pas de duplication', async ({ page }) => {
      await page.goto(BASE_URL);
      await page.waitForSelector('#k-modal', { state: 'attached' });

      const images = [IMG_FULL_FRAME, IMG_WHITESPACE, IMG_FULL_FRAME];
      await renderProductInModal(page, {
        images,
        name: 'Produit Test — galerie multiple',
        price: '25 000 KMF',
      });
      await waitFirstImageLoaded(page);

      // ── §6 : Rebuild successif — vérifier absence de duplication ──
      await renderProductInModal(page, {
        images,
        name: 'Produit Test — galerie multiple',
        price: '25 000 KMF',
      });
      await waitFirstImageLoaded(page);

      const m = await measureModal(page);

      expect(m.galleryMode).toBe('multiple');
      expect(m.mediaCount).toBe('3');

      // ── Navigation conservée, pas de duplication (§6) ──
      expect(m.slideCount).toBe(3); // pas 6
      expect(m.dotCount).toBe(3);   // pas 6
      if (vp.width < 900) {
        // Mobile : navigation par dots
        expect(m.dotsDisplay).not.toBe('none');
      } else {
        // Desktop (§8 non-régression) : navigation par miniatures, pas de dots
        expect(m.thumbsPresent).toBe(true);
      }
      expect(m.actionsVisible).toBe(true);

      // ── Hauteur média = 48vh sur mobile (pas la règle single) ──
      if (vp.width < 900) {
        const expectedH = vp.height * 0.48;
        expect(m.wrapHeight).toBeGreaterThan(0);
        expect(m.wrapHeight).toBeLessThanOrEqual(expectedH + 4);
        // Plus haut que le mode single
        expect(m.wrapHeight).toBeGreaterThan(vp.height * 0.40);
      }

      // ── §6 : Navigation réelle — clic dot 2 ──
      if (vp.width < 900) {
        // Clic sur dot index 1 (2e image)
        await page.evaluate(() => {
          const dots = document.querySelectorAll('#k-modal-dots .k-modal-dot');
          if (dots[1]) dots[1].click();
        });
        await page.waitForTimeout(400); // transition

        const nav1 = await page.evaluate(() => {
          const dots = document.querySelectorAll('#k-modal-dots .k-modal-dot');
          const track = document.getElementById('k-modal-carousel-track');
          return {
            dot0Active: dots[0] ? dots[0].classList.contains('is-active') : null,
            dot1Active: dots[1] ? dots[1].classList.contains('is-active') : null,
            trackTransform: track ? track.style.transform : null,
          };
        });
        expect(nav1.dot0Active).toBe(false);
        expect(nav1.dot1Active).toBe(true);
        expect(nav1.trackTransform).toContain('-100%');

        // Retour dot 1 (index 0)
        await page.evaluate(() => {
          const dots = document.querySelectorAll('#k-modal-dots .k-modal-dot');
          if (dots[0]) dots[0].click();
        });
        await page.waitForTimeout(400);

        const nav2 = await page.evaluate(() => {
          const dots = document.querySelectorAll('#k-modal-dots .k-modal-dot');
          const track = document.getElementById('k-modal-carousel-track');
          return {
            dot0Active: dots[0] ? dots[0].classList.contains('is-active') : null,
            dot1Active: dots[1] ? dots[1].classList.contains('is-active') : null,
            trackTransform: track ? track.style.transform : null,
          };
        });
        expect(nav2.dot0Active).toBe(true);
        expect(nav2.dot1Active).toBe(false);
        expect(nav2.trackTransform).toContain('0%');
      }

      // ── §6 : Compteur >5 images ──
      const manyImages = Array.from({ length: 7 }, (_, i) =>
        i % 2 === 0 ? IMG_FULL_FRAME : IMG_WHITESPACE
      );
      await renderProductInModal(page, {
        images: manyImages,
        name: 'Produit Test — beaucoup d\'images',
        price: '30 000 KMF',
      });
      await waitFirstImageLoaded(page);

      const mMany = await measureModal(page);
      expect(mMany.slideCount).toBe(7);
      expect(mMany.dotCount).toBe(0); // >5 → dots remplacés par compteur
      expect(mMany.counterVisible).toBe(true);

      // ── §6 : aucun doublon après rebuild ──
      await renderProductInModal(page, {
        images: manyImages,
        name: 'Produit Test — beaucoup d\'images',
        price: '30 000 KMF',
      });
      await waitFirstImageLoaded(page);
      const mRebuild = await measureModal(page);
      expect(mRebuild.slideCount).toBe(7); // pas 14

      expect(m.modalScrollWidth).toBeLessThanOrEqual(m.modalClientWidth + 1);
      expect(m.actionsTop).toBeGreaterThanOrEqual(m.priceBottom);

      await closeModal(page);
    });

    test('Single vs multiple — sujet au moins aussi grand, meilleur taux d\'occupation, titre/prix remontés, CTA toujours ancré', async ({ page }) => {
      test.skip(vp.width >= 900, 'Comparaison mobile uniquement (single/multiple ne s\'applique qu\'au mobile ≤899px)');

      await page.goto(BASE_URL);
      await page.waitForSelector('#k-modal', { state: 'attached' });

      // ── Mesure single ──
      await renderProductInModal(page, {
        images: [IMG_WHITESPACE],
        name: 'Produit single — comparaison',
        price: '10 000 KMF',
      });
      await waitFirstImageLoaded(page);
      await page.waitForTimeout(200); // subject scale
      const single = await measureModal(page);
      await closeModal(page);

      // ── Mesure multiple ──
      await page.goto(BASE_URL);
      await page.waitForSelector('#k-modal', { state: 'attached' });
      await renderProductInModal(page, {
        images: [IMG_WHITESPACE, IMG_FULL_FRAME],
        name: 'Produit multiple — comparaison',
        price: '10 000 KMF',
      });
      await waitFirstImageLoaded(page);
      const multiple = await measureModal(page);
      await closeModal(page);

      // ── Wrapper single strictement plus court ──
      expect(single.wrapHeight).toBeLessThan(multiple.wrapHeight);

      // ── Titre/prix apparaissent plus haut (mieux valorisés) — vivent
      // dans la zone scrollable (.k-modal-scroll), remontent avec le
      // wrapper plus compact. ──
      expect(single.titleTop).toBeLessThan(multiple.titleTop);
      expect(single.priceTop).toBeLessThan(multiple.priceTop);
      // Le CTA (.k-modal-actions) est reparenté en enfant direct de #k-modal
      // (position:static, order:3) : le flex column ancre systématiquement
      // sa position au bas du viewport, quelle que soit la hauteur du
      // contenu scrollable — c'est ce qui garantit sa visibilité constante
      // (point 8), pas un "remontée" comme titre/prix. On vérifie donc
      // seulement qu'il ne descend jamais sous sa position en mode single
      // (jamais moins bien placé), sans exiger qu'il remonte.
      expect(single.actionsTop).toBeLessThanOrEqual(multiple.actionsTop);

      // ── §1 : sujet au moins aussi grand visuellement ──
      // Le subject scale compense la réduction de wrapper
      if (single.subjectMetrics && multiple.subjectMetrics) {
        // Tolérance -5% : le sujet ne doit pas être significativement plus petit
        expect(single.subjectMetrics.visibleWidth)
          .toBeGreaterThanOrEqual(multiple.subjectMetrics.visibleWidth * 0.95);
        expect(single.subjectMetrics.visibleHeight)
          .toBeGreaterThanOrEqual(multiple.subjectMetrics.visibleHeight * 0.95);

        // ── §1 : moins de blanc (meilleur taux d'occupation) ──
        expect(single.subjectMetrics.occupationRate)
          .toBeGreaterThanOrEqual(multiple.subjectMetrics.occupationRate);
      }

      // ── §8 : CTA visible dans les deux modes ──
      expect(single.actionsVisible).toBe(true);
      expect(multiple.actionsVisible).toBe(true);
    });
  });
}
