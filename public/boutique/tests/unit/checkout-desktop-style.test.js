'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  ensureCheckoutDesktopV2Stylesheet,
} = require('../../js/checkout-desktop-style.js');

describe('checkout desktop V2 stylesheet loader', () => {
  beforeEach(() => {
    document.getElementById('k-checkout-desktop-v2-style')?.remove();
  });

  afterEach(() => {
    delete window.matchMedia;
    document.getElementById('k-checkout-desktop-v2-style')?.remove();
  });

  it('charge une seule feuille dist sur desktop', () => {
    window.matchMedia = jest.fn(() => ({ matches: true }));

    const first = ensureCheckoutDesktopV2Stylesheet();
    const second = ensureCheckoutDesktopV2Stylesheet();

    expect(first).toBe(second);
    expect(first.tagName).toBe('LINK');
    expect(first.rel).toBe('stylesheet');
    expect(first.media).toBe('(min-width: 900px)');
    expect(first.getAttribute('href')).toBe('/boutique/css/dist/checkout-desktop-v2.css?v=1');
    expect(document.querySelectorAll('#k-checkout-desktop-v2-style')).toHaveLength(1);
  });

  it('ne charge rien sur mobile', () => {
    window.matchMedia = jest.fn(() => ({ matches: false }));

    expect(ensureCheckoutDesktopV2Stylesheet()).toBeNull();
    expect(document.getElementById('k-checkout-desktop-v2-style')).toBeNull();
  });
});
