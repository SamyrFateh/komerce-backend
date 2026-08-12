'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * public/boutique/tests/unit/b-boutique-wow-style.test.js
 *
 * Le module ne porte plus de "wow layer" visuelle. Il possède un seul rôle :
 * transformer le fallback technique image en fallback vitrine Komerce et
 * intercepter les erreurs/loads IMG de façon idempotente.
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
  });

  test('fallback vitrine est autonome et brandé', () => {
    expect(SHOWCASE_PRODUCT_FALLBACK_URL).toMatch(/^data:image\/svg\+xml,/);
    const decoded = decodeURIComponent(SHOWCASE_PRODUCT_FALLBACK_URL);
    expect(decoded).toContain('KOMERCE');
    expect(decoded).toContain('#ffe11a');
    expect(decoded).toContain('IMAGE BIENTÔT DISPONIBLE');
  });

  test('polishFallbackImage remplace le broken image, gère null et reste idempotent', () => {
    expect(polishFallbackImage(null)).toBe(false);

    const img = document.createElement('img');
    img.src = '/broken.jpg';
    img.srcset = '/broken-2x.jpg 2x';

    expect(polishFallbackImage(img)).toBe(true);
    expect(img.dataset.kFallbackApplied).toBe('1');
    expect(img.dataset.kFallbackPolished).toBe('1');
    expect(img.classList.contains('is-image-fallback')).toBe(true);
    expect(img.hasAttribute('srcset')).toBe(false);
    expect(img.alt).toBe('');
    expect(img.src).toContain('data:image/svg+xml');

    expect(polishFallbackImage(img)).toBe(false);
  });

  test('setup intercepte une erreur IMG et ignore une erreur non-image', () => {
    setupBoutiqueWowStyle();

    const div = document.createElement('div');
    document.body.appendChild(div);
    div.dispatchEvent(new Event('error'));
    expect(div.dataset.kFallbackPolished).toBeUndefined();

    const img = document.createElement('img');
    document.body.appendChild(img);
    img.dispatchEvent(new Event('error'));

    expect(img.dataset.kFallbackPolished).toBe('1');
    expect(img.src).toContain('data:image/svg+xml');
  });

  test('setup upgrade après load le fallback technique posé par b-utils', async () => {
    setupBoutiqueWowStyle();

    const img = document.createElement('img');
    img.classList.add('is-image-fallback');
    document.body.appendChild(img);
    img.dispatchEvent(new Event('load'));

    await Promise.resolve();
    expect(img.dataset.kFallbackPolished).toBe('1');
    expect(img.src).toContain('data:image/svg+xml');
  });

  test('load normal et load non-image ne déclenchent aucun fallback', async () => {
    setupBoutiqueWowStyle();

    const div = document.createElement('div');
    document.body.appendChild(div);
    div.dispatchEvent(new Event('load'));

    const img = document.createElement('img');
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    document.body.appendChild(img);
    img.dispatchEvent(new Event('load'));

    await Promise.resolve();
    expect(div.dataset.kFallbackPolished).toBeUndefined();
    expect(img.dataset.kFallbackPolished).toBeUndefined();
    expect(img.classList.contains('is-image-fallback')).toBe(false);
  });

  test('setup est idempotent', () => {
    setupBoutiqueWowStyle();
    expect(window.__kProductFallbackPolishInstalled).toBe(true);
    expect(() => setupBoutiqueWowStyle()).not.toThrow();
  });
});
