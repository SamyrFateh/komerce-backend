'use strict';

/**
 * tests/unit/b-modal-product.test.js
 *
 * Module #2 (suite) du plan d'attaque frontend — js/b-modal-product.js (678L), 0%.
 *
 * Module léger (seules dépendances : b-bus, b-store, b-utils — aucun cycle
 * avec b-modal-core.js), ce qui permet une couverture large sans mocking
 * lourd.
 *
 * Périmètre couvert :
 *   - buildCarouselSlides (slides, dots vs compteur >5 images, miniatures desktop)
 *   - goToSlide (borne, sync dots/miniatures/compteur, bus carousel:changed)
 *   - _syncScrollPadding (no-op desktop ≥900px)
 *   - setupModalFAB / hideModalFAB (topbar enrichie, cleanup observers)
 *   - openSizeGuide / closeSizeGuide (overlay, onglets, fermeture croix/backdrop/Escape)
 *
 * PDC-6 : _renderVariants et ses helpers (intelligence produit legacy) ont
 *   été supprimés de b-modal-product.js ; leur couverture est retirée ici.
 *
 * state/dom/bus viennent des vrais b-store.js/b-bus.js. b-utils.js est mocké
 * (fonctions pures de formatage, comme dans les lots précédents).
 */

jest.mock('../../js/b-utils.js', () => ({
  optimizeImgUrl: jest.fn((url) => url),
  fmtPrice: jest.fn((n) => String(n) + ' KMF'),
}));

const { state, dom } = require('../../js/b-store.js');
const { bus } = require('../../js/b-bus.js');

const {
  buildCarouselSlides, goToSlide, openSizeGuide, closeSizeGuide,
  _syncScrollPadding,
  setupModalFAB, hideModalFAB,
} = require('../../js/b-modal-product.js');

function makeProduct(overrides) {
  return Object.assign({
    id: 1, name: 'Riz basmati 5kg', price_kmf: 5000, image_url: 'img1.jpg',
  }, overrides);
}

function resetDom() {
  document.body.innerHTML = '';
  document.documentElement.style.cssText = '';

  dom.modalCarouselTrack = document.createElement('div');
  dom.modalDots = document.createElement('div');
  dom.modal = document.createElement('div');
  dom.modal.id = 'k-modal';
  const imgWrap = document.createElement('div');
  imgWrap.className = 'k-modal-img-wrap';
  dom.modal.appendChild(imgWrap);
  const info = document.createElement('div');
  info.className = 'k-modal-info';
  dom.modal.appendChild(info);
  dom.modalVariants = document.createElement('div');
  dom.modalPrice = document.createElement('div');
  document.body.appendChild(dom.modal);
  document.body.appendChild(document.createElement('div')).id = 'unused';
}

describe('b-modal-product', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDom();
    state.carouselIndex = 0;
    state.carouselCount = 1;
    state.modalProduct = null;
    state._fabObserver = null;
    state._topbarObserver = null;
  });

  describe('buildCarouselSlides', () => {
    it('une seule image → 1 slide, pas de dots, pas de miniatures', () => {
      buildCarouselSlides(makeProduct({ image_url: 'a.jpg' }));
      expect(dom.modalCarouselTrack.querySelectorAll('.k-modal-slide')).toHaveLength(1);
      expect(dom.modalDots.querySelectorAll('.k-modal-dot')).toHaveLength(0);
      expect(dom.modal.querySelector('.k-modal-thumbs')).toBeNull();
      expect(state.carouselCount).toBe(1);
    });

    it('plusieurs images (≤5) → un dot par image, le premier actif, miniatures créées', () => {
      buildCarouselSlides(makeProduct({ images: ['a.jpg', 'b.jpg', 'c.jpg'] }));
      const dots = dom.modalDots.querySelectorAll('.k-modal-dot');
      expect(dots).toHaveLength(3);
      expect(dots[0].classList.contains('is-active')).toBe(true);
      expect(dom.modal.querySelectorAll('.k-modal-thumb')).toHaveLength(3);
      expect(state.carouselCount).toBe(3);
    });

    it('plus de 5 images → compteur "1/N" visible au lieu des dots', () => {
      const images = Array.from({ length: 8 }, (_, i) => `img${i}.jpg`);
      buildCarouselSlides(makeProduct({ images }));
      expect(dom.modalDots.querySelectorAll('.k-modal-dot')).toHaveLength(0);
      const counter = dom.modal.querySelector('.k-modal-counter');
      expect(counter.textContent).toBe('1/8');
      expect(counter.classList.contains('is-visible')).toBe(true);
    });

    it('filtre les images falsy et retombe sur image_url si `images` est vide', () => {
      buildCarouselSlides(makeProduct({ images: [null, ''], image_url: 'fallback.jpg' }));
      const slides = dom.modalCarouselTrack.querySelectorAll('.k-modal-slide');
      expect(slides).toHaveLength(1);
      expect(slides[0].src).toContain('fallback.jpg');
    });

    it('clic sur un dot appelle goToSlide (délègue au module lui-même)', () => {
      buildCarouselSlides(makeProduct({ images: ['a.jpg', 'b.jpg'] }));
      const dots = dom.modalDots.querySelectorAll('.k-modal-dot');
      dots[1].click();
      expect(state.carouselIndex).toBe(1);
    });
  });

  describe('goToSlide', () => {
    beforeEach(() => {
      buildCarouselSlides(makeProduct({ images: ['a.jpg', 'b.jpg', 'c.jpg'] }));
    });

    it('index hors bornes (négatif ou ≥ count) → ignoré', () => {
      goToSlide(-1);
      expect(state.carouselIndex).toBe(0);
      goToSlide(99);
      expect(state.carouselIndex).toBe(0);
    });

    it('index valide → met à jour carouselIndex, sync dots/miniatures/compteur, transform du track', () => {
      goToSlide(2);
      expect(state.carouselIndex).toBe(2);
      expect(dom.modalCarouselTrack.style.transform).toBe('translateX(-200%)');
      const dots = dom.modalDots.querySelectorAll('.k-modal-dot');
      expect(dots[2].classList.contains('is-active')).toBe(true);
      expect(dots[0].classList.contains('is-active')).toBe(false);
      const thumbs = dom.modal.querySelectorAll('.k-modal-thumb');
      expect(thumbs[2].classList.contains('is-active')).toBe(true);
    });

    it('émet bus "carousel:changed" avec l\'index', () => {
      const spy = jest.spyOn(bus, 'emit');
      goToSlide(1);
      expect(spy).toHaveBeenCalledWith('carousel:changed', 1);
      spy.mockRestore();
    });
  });

  describe('_syncScrollPadding', () => {
    it('desktop (innerWidth ≥ 900) → no-op, ne pose pas de --k-modal-cta-h', () => {
      window.innerWidth = 1200;
      _syncScrollPadding();
      expect(document.documentElement.style.getPropertyValue('--k-modal-cta-h')).toBe('');
    });

    it('mobile (innerWidth < 900) → ne throw pas même sans .k-modal-actions', () => {
      window.innerWidth = 400;
      expect(() => _syncScrollPadding()).not.toThrow();
    });
  });

  describe('setupModalFAB (topbar enrichie)', () => {
    function addTopbar() {
      const modalEl = document.getElementById('k-modal');
      const topbar = document.createElement('div');
      topbar.className = 'k-modal-topbar';
      modalEl.appendChild(topbar);
      return topbar;
    }

    it('sans #k-modal-topbar ou sans modalProduct → ne throw pas, ne crée rien', () => {
      state.modalProduct = null;
      expect(() => setupModalFAB()).not.toThrow();
      expect(dom.modal.querySelector('.k-modal-topbar-product')).toBeNull();
    });

    it('avec topbar + produit actif → crée le bloc produit avec nom/prix', () => {
      addTopbar();
      state.modalProduct = makeProduct({ name: 'Huile 1L', price_kmf: 1200 });
      setupModalFAB();
      const productEl = dom.modal.querySelector('.k-modal-topbar-product');
      expect(productEl).not.toBeNull();
      expect(productEl.querySelector('.k-topbar-name').textContent).toBe('Huile 1L');
      expect(productEl.querySelector('.k-topbar-price-val').textContent).toBe('1200 KMF');
    });

    it('produit en promo → affiche le badge promo dans la topbar', () => {
      addTopbar();
      state.modalProduct = makeProduct({ promo_pct: 15 });
      setupModalFAB();
      const promo = dom.modal.querySelector('.k-topbar-price-promo');
      expect(promo.textContent).toBe('-15%');
      expect(promo.classList.contains('u-hidden')).toBe(false);
    });

    it('second appel réutilise le bloc existant sans le dupliquer', () => {
      addTopbar();
      state.modalProduct = makeProduct();
      setupModalFAB();
      setupModalFAB();
      expect(dom.modal.querySelectorAll('.k-modal-topbar-product')).toHaveLength(1);
    });
  });

  describe('hideModalFAB', () => {
    it('retire is-scrolled du modal et visible des FAB, déconnecte les observers', () => {
      dom.modal.classList.add('is-scrolled');
      const backTop = document.createElement('button');
      backTop.id = 'k-modal-back-top';
      backTop.classList.add('visible');
      document.body.appendChild(backTop);
      const fabObserver = { disconnect: jest.fn() };
      const topbarObserver = { disconnect: jest.fn() };
      state._fabObserver = fabObserver;
      state._topbarObserver = topbarObserver;

      hideModalFAB();

      expect(dom.modal.classList.contains('is-scrolled')).toBe(false);
      expect(backTop.classList.contains('visible')).toBe(false);
      expect(fabObserver.disconnect).toHaveBeenCalled();
      expect(topbarObserver.disconnect).toHaveBeenCalled();
      expect(state._fabObserver).toBeNull();
      expect(state._topbarObserver).toBeNull();
    });

    it('sans observers ni FAB dans le DOM → ne throw pas', () => {
      expect(() => hideModalFAB()).not.toThrow();
    });
  });

  describe('openSizeGuide / closeSizeGuide', () => {
    it('crée l\'overlay au premier appel, onglet "clothes" actif par défaut', () => {
      openSizeGuide();
      const overlay = document.getElementById('k-size-guide-overlay');
      expect(overlay).not.toBeNull();
      expect(overlay.classList.contains('is-open')).toBe(true);
      expect(document.body.classList.contains('k-sg-open')).toBe(true);
      expect(overlay.querySelector('.k-sg-tab[data-tab="clothes"]').classList.contains('is-active')).toBe(true);
      expect(overlay.querySelector('.k-sg-section[data-section="clothes"]').classList.contains('u-hidden')).toBe(false);
    });

    it('type="shoes" → active l\'onglet et la section chaussures', () => {
      openSizeGuide('shoes');
      const overlay = document.getElementById('k-size-guide-overlay');
      expect(overlay.querySelector('.k-sg-tab[data-tab="shoes"]').classList.contains('is-active')).toBe(true);
      expect(overlay.querySelector('.k-sg-section[data-section="shoes"]').classList.contains('u-hidden')).toBe(false);
      expect(overlay.querySelector('.k-sg-section[data-section="clothes"]').classList.contains('u-hidden')).toBe(true);
    });

    it('réutilise le même overlay au second appel (pas de duplication)', () => {
      openSizeGuide('clothes');
      openSizeGuide('kids');
      expect(document.querySelectorAll('#k-size-guide-overlay')).toHaveLength(1);
      const overlay = document.getElementById('k-size-guide-overlay');
      expect(overlay.querySelector('.k-sg-tab[data-tab="kids"]').classList.contains('is-active')).toBe(true);
    });

    it('clic sur un onglet bascule la section affichée', () => {
      openSizeGuide('clothes');
      const overlay = document.getElementById('k-size-guide-overlay');
      overlay.querySelector('.k-sg-tab[data-tab="shoes"]').click();
      expect(overlay.querySelector('.k-sg-tab[data-tab="shoes"]').classList.contains('is-active')).toBe(true);
      expect(overlay.querySelector('.k-sg-section[data-section="shoes"]').classList.contains('u-hidden')).toBe(false);
      expect(overlay.querySelector('.k-sg-section[data-section="clothes"]').classList.contains('u-hidden')).toBe(true);
    });

    it('clic sur la croix ferme l\'overlay', () => {
      openSizeGuide();
      const overlay = document.getElementById('k-size-guide-overlay');
      overlay.querySelector('.k-sg-close').click();
      expect(overlay.classList.contains('is-open')).toBe(false);
      expect(document.body.classList.contains('k-sg-open')).toBe(false);
    });

    it('clic sur le fond (backdrop) ferme l\'overlay, clic dans le panneau ne ferme pas', () => {
      openSizeGuide();
      const overlay = document.getElementById('k-size-guide-overlay');
      overlay.querySelector('.k-sg-panel').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(overlay.classList.contains('is-open')).toBe(true);
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(overlay.classList.contains('is-open')).toBe(false);
    });

    it('touche Escape ferme l\'overlay', () => {
      openSizeGuide();
      const overlay = document.getElementById('k-size-guide-overlay');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(overlay.classList.contains('is-open')).toBe(false);
    });

    it('closeSizeGuide sans overlay existant → ne throw pas', () => {
      expect(() => closeSizeGuide()).not.toThrow();
    });
  });
});
