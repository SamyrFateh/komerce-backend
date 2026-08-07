'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Vue Favoris. Les interactions carte sont désormais possédées par la
 * délégation unique de b-catalog.js ; ce module ne réinstalle aucun listener
 * favori/panier/modal par carte.
 */

jest.mock('../../js/b-cart-core.js', () => ({
  showToast: jest.fn(),
  isFav: jest.fn(() => false),
}));
jest.mock('../../js/b-cart.js', () => ({
  toggleFav: jest.fn(),
  quickAdd: jest.fn(),
  quickRemove: jest.fn(),
}));
jest.mock('../../js/b-modal.js', () => ({ openModal: jest.fn() }));

const {
  resetState, mountFixture, mockWindowK, flush,
} = require('./helpers/boutiqueTestKit');

const { state } = require('../../js/b-store.js');
const { showToast } = require('../../js/b-cart-core.js');
const { toggleFav, quickAdd, quickRemove } = require('../../js/b-cart.js');
const { openModal } = require('../../js/b-modal.js');
const { renderFavView, updateFavPromoBadge, shareWishlistWhatsApp } = require('../../js/b-favs.js');

const PRODUCTS = [
  { id: 1, name: 'Sac tressé', price_kmf: 15000, promo_pct: 20 },
  { id: 2, name: 'Bracelet', price_kmf: 3000, promo_pct: 0 },
];

describe('b-favs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWindowK();
    resetState(state);
    mountFixture('<div id="k-catalog-section"></div><div class="k-bnav-item" data-tab="fav"></div>');
  });

  describe('renderFavView', () => {
    it('aucun favori → message vide, pas de bannière promo', () => {
      state.products = PRODUCTS;
      state.favs = [];
      renderFavView();
      const el = document.getElementById('k-fav-view');
      expect(el).not.toBeNull();
      expect(el.innerHTML).toContain('Aucun favori');
      expect(el.classList.contains('k-fav-promo-active')).toBe(false);
    });

    it('favoris présents dont un en promo → renderer canonique + bannière + badge', () => {
      state.products = PRODUCTS;
      state.favs = [1, 2];
      renderFavView();
      const el = document.getElementById('k-fav-view');
      expect(el.innerHTML).toContain('2 produits');
      expect(el.innerHTML).toContain('k-fav-promo-banner');
      expect(el.classList.contains('k-fav-promo-active')).toBe(true);
      expect(el.querySelectorAll('#k-fav-grid .k-card')).toHaveLength(2);
      expect(el.querySelector('.k-card-add-trigger')).not.toBeNull();
      const badge = document.querySelector('.k-bnav-item[data-tab="fav"] .k-bnav-promo-badge');
      expect(badge).not.toBeNull();
      expect(badge.textContent).toBe('🎉');
    });

    it('ne réinstalle pas de listener carte/modal local', () => {
      state.products = PRODUCTS;
      state.favs = [1];
      renderFavView();
      document.querySelector('.k-card').dispatchEvent(new Event('click', { bubbles: true }));
      expect(openModal).not.toHaveBeenCalled();
    });

    it('ne réinstalle pas de listener favori local', () => {
      state.products = PRODUCTS;
      state.favs = [1];
      renderFavView();
      document.querySelector('.k-card-fav').dispatchEvent(new Event('click', { bubbles: true }));
      expect(toggleFav).not.toHaveBeenCalled();
    });

    it('ne réinstalle pas de listener panier local', () => {
      state.products = PRODUCTS;
      state.favs = [2];
      renderFavView();
      document.querySelector('.k-card-add-trigger').dispatchEvent(new Event('click', { bubbles: true }));
      expect(quickAdd).not.toHaveBeenCalled();
      expect(quickRemove).not.toHaveBeenCalled();
    });
  });

  describe('updateFavPromoBadge', () => {
    it('pas de nav item → ne throw pas', () => {
      document.querySelector('.k-bnav-item').remove();
      expect(() => updateFavPromoBadge(2)).not.toThrow();
    });

    it('promoCount à 0 avec badge existant → le retire', () => {
      updateFavPromoBadge(3);
      expect(document.querySelector('.k-bnav-promo-badge')).not.toBeNull();
      updateFavPromoBadge(0);
      expect(document.querySelector('.k-bnav-promo-badge')).toBeNull();
    });
  });

  describe('shareWishlistWhatsApp', () => {
    it('aucun favori → toast erreur, pas de fetch', async () => {
      state.products = PRODUCTS;
      state.favs = [];
      await shareWishlistWhatsApp();
      expect(showToast).toHaveBeenCalledWith('Aucun favori à partager.', 'error');
      expect(window.K.request).not.toHaveBeenCalled();
    });

    it('favoris présents → apiPost réussi, ouvre WhatsApp avec share_url', async () => {
      state.products = PRODUCTS;
      state.favs = [1, 2];
      mockWindowK({ request: jest.fn().mockResolvedValue({ url: 'https://k.mr/s/abc' }) });
      window.open = jest.fn();
      await shareWishlistWhatsApp();
      await flush();
      expect(window.K.request).toHaveBeenCalledWith('/api/shares', 'POST', { cart_items: [{ product_id: 1, qty: 1 }, { product_id: 2, qty: 1 }] }, 2, {});
      expect(window.open).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('https://k.mr/s/abc')), '_blank');
    });

    it('apiPost échoue → fallback sur l’URL boutique locale', async () => {
      state.products = PRODUCTS;
      state.favs = [1];
      mockWindowK({ request: jest.fn().mockRejectedValue(new Error('network')) });
      window.open = jest.fn();
      await shareWishlistWhatsApp();
      await flush();
      expect(window.open).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('/Komerce_Boutique.html')), '_blank');
    });
  });
});
