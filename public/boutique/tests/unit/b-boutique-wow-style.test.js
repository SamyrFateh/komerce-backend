'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires jsdom
 */
/**
 * public/boutique/tests/unit/b-boutique-wow-style.test.js
 *
 * Le module ne porte plus de "wow layer" visuelle. Il possède un seul rôle :
 * transformer le fallback technique image en fallback vitrine Komerce et
 * intercepter les erreurs IMG de façon idempotente.
 */

const {
  SHOWCASE_PRODUCT_FALLBACK_URL,
  polishFallbackImage,
  setupBoutiqueWowStyle,
} = require('../../js/b-boutique-wow-style.js');

describe('b-boutique-wow-style — product image fallback polish', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete window.__kProductFallbackPolishInstalled;
    if (window.__kProductFallbackPolishObserver) {
      window.__kProductFallbackPolishObserver.disconnect();
      delete window.__kProductFallbackPolishObserver;
    }
  });

  test('fallback vitrine est autonome et brandé', () => {
    expect(SHOWCASE_PRODUCT_FALLBACK_URL).toMatch(/^data:image\/svg\+xml,/);
    expect(decodeURIComponent(SHOWCASE_PRODUCT_FALLBACK_URL)).toContain('KOMERCE');
    expect(decodeURIComponent(SHOWCASE_PRODUCT_FALLBACK_URL)).toContain('#ffe11a');
  });

  test('polishFallbackImage remplace le broken image sans boucle', () => {
    const img = document.createElement('img');
    img.src = '/broken.jpg';
    img.srcset = '/broken-2x.jpg 2x';

    expect(polishFallbackImage(img)).toBe(true);
    expect(img.dataset.kFallbackApplied).toBe('1');
    expect(img.dataset.kFallbackPolished).toBe('1');
    expect(img.classList.contains('is-image-fallback')).toBe(true);
    expect(img.hasAttribute('srcset')).toBe(false);
    expect(img.src).toContain('data:image/svg+xml');

    expect(polishFallbackImage(img)).toBe(false);
  });

  test('setup intercepte une erreur IMG et applique le fallback vitrine', () => {
    setupBoutiqueWowStyle();

    const img = document.createElement('img');
    document.body.appendChild(img);
    img.dispatchEvent(new Event('error'));

    expect(img.dataset.kFallbackPolished).toBe('1');
    expect(img.src).toContain('data:image/svg+xml');
  });

  test('setup est idempotent', () => {
    expect(() => {
      setupBoutiqueWowStyle();
      setupBoutiqueWowStyle();
      setupBoutiqueWowStyle();
    }).not.toThrow();
    expect(window.__kProductFallbackPolishInstalled).toBe(true);
  });
});
