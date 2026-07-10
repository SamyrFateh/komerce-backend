'use strict';

/**
 * tests/unit/b-modal-core-wiring.test.js
 *
 * Complète b-modal-core.test.js et b-modal-core-desktop-click.test.js sur
 * js/b-modal-core.js (1419L, 38% avant ce lot).
 *
 * Périmètre couvert ici (branches atteignables, jamais exercées jusque-là) :
 *   - openModal : reset de la barre de recherche interne
 *     (state._modalSearchInput), popstate handler (3 branches : navigation
 *     avant ignorée, retour physique → ferme, race BUG-03 → ignorée),
 *     succès has_variants (fetch + _renderVariants), succès de l'appel
 *     suggestions (RANK-01, enrichissement reason_label), modalSku (avec/
 *     sans sku), bouton favori (cœur plein/vide), classe modal-has-cart,
 *     sauvegarde/restauration des styles inline du pager mobile et du
 *     scrollLeft du grid (fenêtres < 900px).
 *   - closeModal : restauration effective des branches ci-dessus.
 *   - setupModal : câblage des boutons statiques (modalBack, modalClose,
 *     modalCartBtn, clic hors-modal sur l'overlay), bouton favori, blocage
 *     du scroll passthrough sur .k-modal-actions, bouton "Acheter"
 *     (buyNowBtn, cycle complet feedback→fermeture→panier), raccourcis
 *     clavier (← → Escape), hint clavier desktop injecté dans la topbar.
 *
 * Dette assumée, non couverte ici (documentée dans b-modal-core.test.js) :
 *   setupModalInnerSearch (~360L) et setupTopbarSearch (~110L), les deux
 *   IIFE de recherche inline — trop proches d'un test e2e pour être
 *   unitairement pertinentes ; setupVoiceSearch, feature-detected et donc
 *   naturellement sautée en jsdom (pas de SpeechRecognition).
 */

jest.mock('../../js/b-utils.js', () => ({
  sanitize: jest.fn((s) => s),
  fmt: jest.fn((n) => String(n) + ' KMF'),
  fmtPrice: jest.fn((n) => String(n) + ' KMF'),
  optimizeImgUrl: jest.fn((url) => url),
  renderProductCarousel: jest.fn(),
  bindCarouselDots: jest.fn(),
}));

jest.mock('../../js/b-cart-core.js', () => ({
  showToast: jest.fn(),
  updateCartBadge: jest.fn(),
  saveCart: jest.fn(),
  cartQty: jest.fn(() => 0),
}));

jest.mock('../../js/b-cart.js', () => ({
  addToCart: jest.fn(),
  quickAdd: jest.fn(),
  quickRemove: jest.fn(),
  toggleFav: jest.fn(),
  setQty: jest.fn(),
  openCart: jest.fn(),
  closeCart: jest.fn(),
  markAllCartButtons: jest.fn(),
}));

jest.mock('../../js/shop-schema.js', () => ({
  normalizeCategoryKey: jest.fn((k) => k),
  getCategorySectionEmoji: jest.fn(() => '📦'),
}));

jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(() => false),
  getScrollY: jest.fn(() => 0),
  scrollToPosition: jest.fn(),
}));

jest.mock('../../js/b-modal-image-ux.js', () => ({
  setupImageUX: jest.fn(),
}));

jest.mock('../../js/b-modal-social-proof.js', () => ({
  setupSocialProof: jest.fn(),
}));

jest.mock('../../js/b-modal-product.js', () => ({
  buildCarouselSlides: jest.fn(),
  goToSlide: jest.fn(),
  openSizeGuide: jest.fn(),
  closeSizeGuide: jest.fn(),
  _renderVariants: jest.fn(),
  _syncScrollPadding: jest.fn(),
  _injectMobileDelivery: jest.fn(),
  _injectMobileTrust: jest.fn(),
  setupModalFAB: jest.fn(),
  hideModalFAB: jest.fn(),
}));

jest.mock('../../js/b-modal-suggestions.js', () => ({
  renderSuggestions: jest.fn(),
}));

jest.mock('../../js/b-modal-nav.js', () => ({
  updateModalNavArrows: jest.fn(),
  navigateModal: jest.fn(),
}));

jest.mock('../../js/b-modal-cart.js', () => ({
  _syncModalQtyUI: jest.fn(),
  setupModalCart: jest.fn(),
}));

const { state, dom } = require('../../js/b-store.js');
const { addToCart, toggleFav, openCart } = require('../../js/b-cart.js');
const { _renderVariants } = require('../../js/b-modal-product.js');
const { renderSuggestions } = require('../../js/b-modal-suggestions.js');
const { navigateModal } = require('../../js/b-modal-nav.js');

const {
  openModal, closeModal, setupModal,
} = require('../../js/b-modal-core.js');

const ORIGINAL_INNER_WIDTH = window.innerWidth;

function makeProduct(overrides) {
  return Object.assign({
    id: 1,
    name: 'Riz basmati 5kg',
    description: 'Sac de riz importé',
    price_kmf: 5000,
    category: 'Alimentation',
    emoji: '🍚',
    stock: 20,
  }, overrides);
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function resetDom() {
  document.body.innerHTML = '';
  document.body.className = '';
  dom.modalOverlay = document.createElement('div');
  dom.modalName = document.createElement('div');
  dom.modalDesc = document.createElement('div');
  dom.modalPrice = document.createElement('div');
  dom.modalQtyVal = document.createElement('div');
  dom.modalOldPrice = document.createElement('div');
  dom.modalPromoBadge = document.createElement('div');
  dom.modalCat = document.createElement('div');
  dom.modalStock = document.createElement('div');
  dom.modalBackLabel = document.createElement('div');
  dom.modal = document.createElement('div');
  dom.modalVariants = document.createElement('div');
  dom.modalSku = document.createElement('div');
  dom.modalDetails = document.createElement('div');
  dom.addCartBtn = document.createElement('button');
  dom.pageScroll = document.createElement('div');
  dom.modalBack = document.createElement('button');
  dom.modalClose = document.createElement('button');
  dom.modalCartBtn = document.createElement('button');
  dom.modalCarouselTrack = document.createElement('div');
  dom.grid = document.createElement('div');

  const imgWrap = document.createElement('div');
  imgWrap.className = 'k-modal-img-wrap';
  imgWrap.getBoundingClientRect = jest.fn(() => ({
    left: 0, right: 300, width: 300, top: 0, bottom: 200, height: 200,
  }));
  dom.modal.appendChild(imgWrap);

  document.body.appendChild(dom.modal);
  document.body.appendChild(dom.modalOverlay);
}

describe('b-modal-core — branches secondaires openModal/closeModal (popstate, variants, suggestions, sku, favori, mobile)', () => {
  let pushStateSpy;
  let backSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    resetDom();
    window.innerWidth = 1200;
    state.products = [makeProduct()];
    state.filtered = [];
    state.cart = [];
    state.favs = [];
    state.viewedHistory = [];
    state.modalHistory = [];
    state.modalProduct = null;
    state.modalQty = 1;
    state.modalOpen = false;
    state._savedCatalogScrollY = 0;
    state._savedPagerInlineStyles = null;
    state._savedGridScrollLeft = null;
    state._modalSearchInput = null;
    localStorage.clear();

    pushStateSpy = jest.spyOn(window.history, 'pushState').mockImplementation(() => {});
    backSpy = jest.spyOn(window.history, 'back').mockImplementation(() => {});

    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  });

  afterEach(() => {
    pushStateSpy.mockRestore();
    backSpy.mockRestore();
    window.innerWidth = ORIGINAL_INNER_WIDTH;
  });

  describe('reset de la recherche interne au ré-ouverture', () => {
    it('vide state._modalSearchInput, retire has-value, dé-masque les cartes suggestion et ferme le dropdown', () => {
      const input = document.createElement('input');
      input.value = 'riz basmati';
      const wrap = document.createElement('div');
      wrap.className = 'k-modal-inner-search has-value';
      wrap.appendChild(input);
      document.body.appendChild(wrap);
      state._modalSearchInput = input;

      const sugRail = document.createElement('div');
      sugRail.id = 'k-sug-rail';
      const hiddenCard = document.createElement('div');
      hiddenCard.className = 'k-sug-card search-hidden';
      sugRail.appendChild(hiddenCard);
      document.body.appendChild(sugRail);

      const dropdown = document.createElement('div');
      dropdown.id = 'k-modal-search-dropdown';
      dropdown.className = 'open';
      document.body.appendChild(dropdown);

      openModal(1);

      expect(input.value).toBe('');
      expect(wrap.classList.contains('has-value')).toBe(false);
      expect(hiddenCard.classList.contains('search-hidden')).toBe(false);
      expect(dropdown.classList.contains('open')).toBe(false);
    });
  });

  describe('popstate handler (navigation navigateur)', () => {
    it('popstate entrant vers un état kModal (navigation avant) → ignoré, la modal reste ouverte', () => {
      openModal(1);
      window.dispatchEvent(new PopStateEvent('popstate', { state: { kModal: true } }));
      expect(dom.modalOverlay.classList.contains('open')).toBe(true);
    });

    it('popstate physique (bouton retour, state=null) avec modal ouverte → ferme la modal', () => {
      openModal(1);
      expect(dom.modalOverlay.classList.contains('open')).toBe(true);

      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      expect(dom.modalOverlay.classList.contains('open')).toBe(false);
      expect(state.modalProduct).toBeNull();
    });

    it('BUG-03 : popstate retardé après réouverture rapide (back() programmatique + réouverture avant l\'event) → ignoré', () => {
      openModal(1);      // _modalHistoryPushed = true, pushState
      closeModal();      // _pendingHistoryBack = true, history.back() (mocké no-op), overlay fermé
      openModal(1);       // ré-ouverture : nouvelle pushState, _modalHistoryPushed = true à nouveau
      expect(dom.modalOverlay.classList.contains('open')).toBe(true);

      // Le popstate "retardé" de la fermeture précédente arrive maintenant.
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      // Doit être ignoré : la modal (rouverte) doit rester ouverte.
      expect(dom.modalOverlay.classList.contains('open')).toBe(true);
    });
  });

  describe('has_variants → fetch produit complet + _renderVariants', () => {
    it('variants non vides → _renderVariants appelé avec le payload complet', async () => {
      state.products = [makeProduct({ has_variants: true })];
      global.fetch.mockImplementation((url) => {
        if (String(url).includes('/api/products/')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: 1, variants: { couleur: ['rouge', 'bleu'] } }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });

      openModal(1);
      await flushPromises();

      expect(_renderVariants).toHaveBeenCalledWith(
        { couleur: ['rouge', 'bleu'] },
        expect.objectContaining({ id: 1 })
      );
    });

    it('variants vides ({}) → _renderVariants non appelé', async () => {
      state.products = [makeProduct({ has_variants: true })];
      global.fetch.mockImplementation((url) => {
        if (String(url).includes('/api/products/')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 1, variants: {} }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });

      openModal(1);
      await flushPromises();

      expect(_renderVariants).not.toHaveBeenCalled();
    });

    it('la modal a changé de produit avant la résolution du fetch → _renderVariants non appelé (guard obsolescence)', async () => {
      state.products = [
        makeProduct({ id: 1, has_variants: true }),
        makeProduct({ id: 2 }),
      ];
      let resolveFetch;
      global.fetch.mockImplementation((url) => {
        if (String(url).includes('/api/products/')) {
          return new Promise((resolve) => { resolveFetch = resolve; });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });

      openModal(1);
      openModal(2); // change de produit avant que le fetch precedent ne resolve
      resolveFetch({ ok: true, json: () => Promise.resolve({ id: 1, variants: { couleur: ['rouge'] } }) });
      await flushPromises();

      expect(_renderVariants).not.toHaveBeenCalled();
    });
  });

  describe('suggestions API (RANK-01) — succès', () => {
    it('items reçus → renderSuggestions appelé avec sameCat/otherCat enrichis (reason_label)', async () => {
      state.products = [
        makeProduct({ id: 1, category: 'Alimentation' }),
        makeProduct({ id: 2, category: 'Alimentation' }),
        makeProduct({ id: 3, category: 'Mode' }),
      ];
      global.fetch.mockImplementation((url) => {
        if (String(url).includes('/api/boutique/suggestions')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              suggestions: [
                { product_id: 2, category: 'Alimentation', reason_label: 'Souvent acheté ensemble' },
                { product_id: 3, category: 'Mode', reason_label: 'Tendance' },
              ],
            }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });

      openModal(1);
      await flushPromises();

      expect(renderSuggestions).toHaveBeenCalled();
      const [sameCat, otherCat, cat] = renderSuggestions.mock.calls[0];
      expect(cat).toBe('Alimentation');
      expect(sameCat[0]).toMatchObject({ id: 2, reason_label: 'Souvent acheté ensemble' });
      expect(otherCat[0]).toMatchObject({ id: 3, reason_label: 'Tendance' });
    });

    it('réponse en tableau brut (pas d\'objet {suggestions}) → traité comme items direct', async () => {
      state.products = [
        makeProduct({ id: 1, category: 'Alimentation' }),
        makeProduct({ id: 2, category: 'Alimentation' }),
      ];
      global.fetch.mockImplementation((url) => {
        if (String(url).includes('/api/boutique/suggestions')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([{ product_id: 2, category: 'Alimentation' }]),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });

      openModal(1);
      await flushPromises();

      expect(renderSuggestions).toHaveBeenCalled();
      const [sameCat] = renderSuggestions.mock.calls[0];
      expect(sameCat[0]).toMatchObject({ id: 2 });
    });

    it('réponse HTTP non-ok → fallback éditorial local (catch)', async () => {
      state.products = [
        makeProduct({ id: 1, category: 'Alimentation' }),
        makeProduct({ id: 2, category: 'Alimentation' }),
      ];
      global.fetch.mockImplementation((url) => {
        if (String(url).includes('/api/boutique/suggestions')) {
          return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });

      openModal(1);
      await flushPromises();

      expect(renderSuggestions).toHaveBeenCalled();
      const [sameCat] = renderSuggestions.mock.calls[0];
      expect(sameCat.every((p) => p.category === 'Alimentation')).toBe(true);
    });
  });

  describe('modalSku', () => {
    it('produit avec sku → texte "Réf. X" affiché, hidden=false', () => {
      state.products = [makeProduct({ sku: 'RIZ-5KG' })];
      openModal(1);
      expect(dom.modalSku.textContent).toBe('Réf. RIZ-5KG');
      expect(dom.modalSku.hidden).toBe(false);
    });

    it('produit sans sku → texte vide, hidden=true', () => {
      state.products = [makeProduct({ sku: undefined })];
      openModal(1);
      expect(dom.modalSku.textContent).toBe('');
      expect(dom.modalSku.hidden).toBe(true);
    });
  });

  describe('bouton favori dans la modal (affichage à l\'ouverture)', () => {
    it('produit dans state.favs → cœur plein + classe liked', () => {
      const favBtn = document.createElement('button');
      favBtn.id = 'k-modal-fav-btn';
      document.body.appendChild(favBtn);
      state.favs = [1];

      openModal(1);

      expect(favBtn.classList.contains('liked')).toBe(true);
      expect(favBtn.innerHTML).toBe('❤️');
    });

    it('produit absent de state.favs → cœur vide, pas de classe liked', () => {
      const favBtn = document.createElement('button');
      favBtn.id = 'k-modal-fav-btn';
      document.body.appendChild(favBtn);
      state.favs = [];

      openModal(1);

      expect(favBtn.classList.contains('liked')).toBe(false);
      expect(favBtn.innerHTML).toBe('🤍');
    });
  });

  describe('classe modal-has-cart', () => {
    it('#k-side-cart.has-items présent → body prend la classe modal-has-cart', () => {
      const sideCart = document.createElement('div');
      sideCart.id = 'k-side-cart';
      sideCart.classList.add('has-items');
      document.body.appendChild(sideCart);

      openModal(1);

      expect(document.body.classList.contains('modal-has-cart')).toBe(true);
    });

    it('#k-side-cart sans has-items → pas de classe modal-has-cart', () => {
      const sideCart = document.createElement('div');
      sideCart.id = 'k-side-cart';
      document.body.appendChild(sideCart);

      openModal(1);

      expect(document.body.classList.contains('modal-has-cart')).toBe(false);
    });
  });

  describe('mobile (<900px) — sauvegarde/restauration pager + grid', () => {
    beforeEach(() => {
      window.innerWidth = 375;
    });

    it('openModal sauvegarde les styles inline du pager puis les vide', () => {
      dom.pageScroll.style.position = 'fixed';
      dom.pageScroll.style.top = '10px';
      dom.pageScroll.style.overflow = 'hidden';

      openModal(1);

      expect(state._savedPagerInlineStyles).toMatchObject({
        position: 'fixed', top: '10px', overflow: 'hidden',
      });
      expect(dom.pageScroll.style.position).toBe('');
      expect(dom.pageScroll.style.top).toBe('');
      expect(dom.pageScroll.style.overflow).toBe('');
    });

    it('closeModal restaure les styles inline du pager sauvegardés', () => {
      dom.pageScroll.style.position = 'fixed';
      dom.pageScroll.style.top = '10px';
      openModal(1);
      dom.modalProduct = state.modalProduct;

      closeModal();

      expect(dom.pageScroll.style.position).toBe('fixed');
      expect(dom.pageScroll.style.top).toBe('10px');
      expect(state._savedPagerInlineStyles).toBeNull();
    });

    it('openModal fige le scrollLeft du grid flat-subcat à 0 et sauvegarde l\'ancien', () => {
      const grid = document.createElement('div');
      grid.id = 'k-grid';
      grid.className = 'k-grid-flat-subcat';
      document.body.appendChild(grid);
      Object.defineProperty(grid, 'scrollLeft', { value: 120, configurable: true, writable: true });

      openModal(1);

      expect(state._savedGridScrollLeft).toBe(120);
      expect(grid.scrollLeft).toBe(0);
      expect(grid.style.scrollSnapType).toBe('none');
    });

    it('closeModal restaure le scrollLeft du grid via requestAnimationFrame', () => {
      jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(); return 1; });
      const grid = document.createElement('div');
      grid.id = 'k-grid';
      grid.className = 'k-grid-flat-subcat';
      document.body.appendChild(grid);
      Object.defineProperty(grid, 'scrollLeft', { value: 120, configurable: true, writable: true });

      openModal(1);
      closeModal();

      expect(grid.scrollLeft).toBe(120);
      expect(grid.style.scrollSnapType).toBe('');
      expect(state._savedGridScrollLeft).toBeNull();
      window.requestAnimationFrame.mockRestore();
    });

    it('grid sans classe k-grid-flat-subcat → ni sauvegarde ni fige', () => {
      const grid = document.createElement('div');
      grid.id = 'k-grid';
      document.body.appendChild(grid);

      openModal(1);

      expect(state._savedGridScrollLeft).toBeNull();
    });
  });
});

describe('b-modal-core — setupModal : câblage des boutons statiques', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDom();
    window.innerWidth = 1200; // desktop : évite setupTopbarSearch (mobile-only)
    state.products = [makeProduct()];
    state.filtered = [];
    state.cart = [];
    state.favs = [];
    state.modalHistory = [];
    state.modalProduct = makeProduct();
    state.modalQty = 1;
    state.modalOpen = false;
    state._savedCatalogScrollY = 0;
    dom.modalOverlay.classList.add('open');
    document.body.classList.add('modal-open');

    jest.spyOn(window.history, 'pushState').mockImplementation(() => {});
    jest.spyOn(window.history, 'back').mockImplementation(() => {});
  });

  afterEach(() => {
    window.innerWidth = ORIGINAL_INNER_WIDTH;
    jest.restoreAllMocks();
  });

  it('clic sur modalBack ferme la modal (historique modal vide)', () => {
    setupModal();
    dom.modalBack.dispatchEvent(new Event('click', { bubbles: true }));
    expect(dom.modalOverlay.classList.contains('open')).toBe(false);
  });

  it('clic sur modalClose ferme la modal directement', () => {
    setupModal();
    dom.modalClose.dispatchEvent(new Event('click', { bubbles: true }));
    expect(dom.modalOverlay.classList.contains('open')).toBe(false);
  });

  it('clic sur modalCartBtn ferme la modal puis ouvre le panier après 150ms', () => {
    jest.useFakeTimers();
    setupModal();
    dom.modalCartBtn.dispatchEvent(new Event('click', { bubbles: true }));
    expect(dom.modalOverlay.classList.contains('open')).toBe(false);
    expect(openCart).not.toHaveBeenCalled();
    jest.advanceTimersByTime(150);
    expect(openCart).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('clic sur l\'overlay lui-même (hors contenu modal) ferme la modal', () => {
    setupModal();
    dom.modalOverlay.dispatchEvent(new Event('click', { bubbles: true }));
    expect(dom.modalOverlay.classList.contains('open')).toBe(false);
  });

  it('clic à l\'intérieur du contenu modal (pas l\'overlay) ne ferme pas', () => {
    setupModal();
    dom.modal.dispatchEvent(new Event('click', { bubbles: true }));
    expect(dom.modalOverlay.classList.contains('open')).toBe(true);
  });

  describe('bouton favori (câblage clic)', () => {
    it('sans modalProduct → toggleFav non appelé', () => {
      state.modalProduct = null;
      const favBtn = document.createElement('button');
      favBtn.id = 'k-modal-fav-btn';
      document.body.appendChild(favBtn);
      setupModal();
      favBtn.dispatchEvent(new Event('click', { bubbles: true }));
      expect(toggleFav).not.toHaveBeenCalled();
    });

    it('avec modalProduct → toggleFav appelé avec l\'id et le bouton', () => {
      const favBtn = document.createElement('button');
      favBtn.id = 'k-modal-fav-btn';
      document.body.appendChild(favBtn);
      setupModal();
      favBtn.dispatchEvent(new Event('click', { bubbles: true }));
      expect(toggleFav).toHaveBeenCalledWith(state.modalProduct.id, favBtn);
    });

    it('synchronise aussi le cœur de la carte grille correspondante', () => {
      const favBtn = document.createElement('button');
      favBtn.id = 'k-modal-fav-btn';
      document.body.appendChild(favBtn);
      const gridFavBtn = document.createElement('button');
      gridFavBtn.className = 'k-card-fav';
      gridFavBtn.setAttribute('data-fav', String(state.modalProduct.id));
      dom.grid.appendChild(gridFavBtn);
      state.favs = [state.modalProduct.id]; // toggleFav est mocké : on simule son effet déjà en place

      setupModal();
      favBtn.dispatchEvent(new Event('click', { bubbles: true }));

      expect(gridFavBtn.classList.contains('liked')).toBe(true);
      expect(gridFavBtn.innerHTML).toBe('❤️');
    });
  });

  it('.k-modal-actions bloque le scroll passthrough (touchmove preventDefault)', () => {
    const actionsBar = document.createElement('div');
    actionsBar.className = 'k-modal-actions';
    dom.modal.appendChild(actionsBar);
    setupModal();

    const evt = new Event('touchmove', { bubbles: true, cancelable: true });
    actionsBar.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(true);
  });

  describe('bouton "Acheter" (buyNowBtn)', () => {
    it('sans modalProduct → ne fait rien', () => {
      state.modalProduct = null;
      const buyBtn = document.createElement('button');
      buyBtn.id = 'k-buy-now-btn';
      buyBtn.innerHTML = 'Acheter';
      document.body.appendChild(buyBtn);
      setupModal();

      buyBtn.dispatchEvent(new Event('click', { bubbles: true }));

      expect(addToCart).not.toHaveBeenCalled();
      expect(buyBtn.innerHTML).toBe('Acheter');
    });

    it('cycle complet : feedback immédiat → addToCart → restauration + fermeture + ouverture panier', () => {
      jest.useFakeTimers();
      const buyBtn = document.createElement('button');
      buyBtn.id = 'k-buy-now-btn';
      buyBtn.innerHTML = 'Acheter';
      document.body.appendChild(buyBtn);
      setupModal();

      buyBtn.dispatchEvent(new Event('click', { bubbles: true }));

      // 1. Feedback immédiat
      expect(buyBtn.disabled).toBe(true);
      expect(buyBtn.classList.contains('buy-confirmed')).toBe(true);
      expect(buyBtn.innerHTML).toContain('Ajouté au panier');
      expect(addToCart).toHaveBeenCalledWith(state.modalProduct, state.modalQty, buyBtn);

      // 2. Après 1200ms : bouton restauré + modal fermée
      jest.advanceTimersByTime(1200);
      expect(buyBtn.innerHTML).toBe('Acheter');
      expect(buyBtn.disabled).toBe(false);
      expect(buyBtn.classList.contains('buy-confirmed')).toBe(false);
      expect(dom.modalOverlay.classList.contains('open')).toBe(false);
      expect(openCart).not.toHaveBeenCalled();

      // 3. Encore 400ms plus tard : panier ouvert
      jest.advanceTimersByTime(400);
      expect(openCart).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('raccourcis clavier (desktop)', () => {
    it('ArrowRight avec modal ouverte → navigateModal(1)', () => {
      setupModal();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(navigateModal).toHaveBeenCalledWith(1);
    });

    it('ArrowLeft avec modal ouverte → navigateModal(-1)', () => {
      setupModal();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      expect(navigateModal).toHaveBeenCalledWith(-1);
    });

    it('Escape avec modal ouverte → ferme la modal', () => {
      setupModal();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(dom.modalOverlay.classList.contains('open')).toBe(false);
    });

    it('modal fermée → aucun raccourci ne fait rien', () => {
      dom.modalOverlay.classList.remove('open');
      setupModal();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(navigateModal).not.toHaveBeenCalled();
    });
  });

  it('injecte le hint clavier desktop dans la topbar (une seule fois)', () => {
    const topbar = document.createElement('div');
    topbar.className = 'k-modal-topbar';
    const right = document.createElement('div');
    right.className = 'k-modal-topbar-right';
    topbar.appendChild(right);
    dom.modal.appendChild(topbar);

    setupModal();

    const hint = document.getElementById('k-modal-keyboard-hint');
    expect(hint).not.toBeNull();
    expect(hint.nextElementSibling).toBe(right);
  });
});
