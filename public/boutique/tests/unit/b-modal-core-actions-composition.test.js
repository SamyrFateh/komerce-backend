'use strict';

/**
 * tests/unit/b-modal-core-actions-composition.test.js
 *
 * Couverture dédiée du trio de composition responsive de .k-modal-actions
 * (MIGRATION v3.0, LOT 3) :
 *   - mountActionsInMobileShell()
 *   - restoreActionsHome()
 *   - reconcileActionsComposition()
 *
 * Ces fonctions ne sont pas exportées par b-modal-core.js — elles sont
 * exercées indirectement via setupModal() (montage initial), openModal()/
 * closeModal() (cycle complet), et bus.emit('modal:composition-synced')
 * (bascule mobile↔desktop pendant que la modale reste ouverte, ex. resize/
 * rotation).
 *
 * isDesktop() est mockée dynamiquement (mockReturnValue changée par test),
 * contrairement à b-modal-core-active-flows.test.js qui la fige à `false`
 * au chargement du module (hypothèse module-scope de ce fichier-là — non
 * modifiée ici, ce fichier vit dans son propre registre de modules Jest).
 */

const mockUpdateCartBadge = jest.fn();
const mockCartQty = jest.fn(() => 0);
const mockIsDesktop = jest.fn(() => false);
const mockGetScrollY = jest.fn(() => 0);
const mockScrollToPosition = jest.fn();
const mockSetupImageUX = jest.fn();
const mockSetupSocialProof = jest.fn();
const mockBuildCarouselSlides = jest.fn();
const mockSetupModalFAB = jest.fn();
const mockHideModalFAB = jest.fn();
const mockRenderSuggestions = jest.fn();
const mockUpdateModalNavArrows = jest.fn();
const mockSyncModalQtyUI = jest.fn();
const mockSetupModalCart = jest.fn();

jest.mock('../../js/b-utils.js', () => ({
  sanitize: jest.fn((value) => String(value == null ? '' : value)),
  fmt: jest.fn((value) => `${value} KMF`),
  fmtPrice: jest.fn((value) => `${value} KMF`),
  optimizeImgUrl: jest.fn((url, width) => `${url}?w=${width}`),
  renderProductCarousel: jest.fn(),
  bindCarouselDots: jest.fn(),
}));

jest.mock('../../js/b-cart-core.js', () => ({
  showToast: jest.fn(),
  updateCartBadge: mockUpdateCartBadge,
  saveCart: jest.fn(),
  cartQty: mockCartQty,
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
  normalizeCategoryKey: jest.fn((category) => category || 'Autres'),
  getCategorySectionEmoji: jest.fn(() => '📦'),
}));

jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: mockIsDesktop,
  getScrollY: mockGetScrollY,
  scrollToPosition: mockScrollToPosition,
}));

jest.mock('../../js/b-modal-image-ux.js', () => ({ setupImageUX: mockSetupImageUX }));
jest.mock('../../js/b-modal-social-proof.js', () => ({ setupSocialProof: mockSetupSocialProof }));
jest.mock('../../js/b-modal-product.js', () => ({
  buildCarouselSlides: mockBuildCarouselSlides,
  goToSlide: jest.fn(),
  openSizeGuide: jest.fn(),
  closeSizeGuide: jest.fn(),
  setupModalFAB: mockSetupModalFAB,
  hideModalFAB: mockHideModalFAB,
  _syncScrollPadding: jest.fn(),
}));
jest.mock('../../js/b-modal-suggestions.js', () => ({ renderSuggestions: mockRenderSuggestions }));
jest.mock('../../js/b-modal-nav.js', () => ({
  updateModalNavArrows: mockUpdateModalNavArrows,
  navigateModal: jest.fn(),
}));
jest.mock('../../js/b-modal-cart.js', () => ({
  _syncModalQtyUI: mockSyncModalQtyUI,
  setupModalCart: mockSetupModalCart,
  resetAddCartButtonState: jest.fn(),
}));

const { state, dom } = require('../../js/b-store.js');
const { bus } = require('../../js/b-bus.js');

function product(id, overrides = {}) {
  return {
    id,
    name: `Produit ${id}`,
    description: `Description ${id}`,
    category: 'Tech',
    subcategory: 'Téléphones',
    price_kmf: 1000 * Number(id),
    image_url: `/img/${id}.jpg`,
    images: [`/img/${id}-1.jpg`],
    emoji: '📱',
    stock: 12,
    ...overrides,
  };
}

// Reproduit la hiérarchie réelle (index.html) : .k-modal-actions vit dans
// .k-modal-configurator par défaut (home desktop), reparentée en enfant
// direct de #k-modal côté mobile par mountActionsInMobileShell().
function mountDom() {
  document.body.innerHTML = `
    <div class="k-page-scroll"></div>
    <div id="k-side-cart"></div>
    <div id="k-modal-overlay">
      <section id="k-modal">
        <header class="k-modal-topbar"><div class="k-modal-topbar-right"></div></header>
        <button id="k-modal-back"></button>
        <button id="k-modal-close"></button>
        <button id="k-modal-cart-btn"></button>
        <div class="k-modal-scroll">
          <div class="k-modal-img-wrap"></div>
          <div class="k-modal-details">
            <div id="k-modal-suggestions"></div>
            <div class="k-modal-configurator" id="k-modal-configurator">
              <div class="k-modal-actions">
                <button id="k-add-cart-btn" class="k-add-cart-btn"></button>
                <button id="k-buy-now-btn"></button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;

  dom.modalOverlay = document.getElementById('k-modal-overlay');
  dom.modal = document.getElementById('k-modal');
  dom.modalBack = document.getElementById('k-modal-back');
  dom.modalClose = document.getElementById('k-modal-close');
  dom.modalCartBtn = document.getElementById('k-modal-cart-btn');
  dom.modalName = document.createElement('div');
  dom.modalSku = document.createElement('div');
  dom.modalDesc = document.createElement('div');
  dom.modalPrice = document.createElement('div');
  dom.modalQtyVal = document.createElement('div');
  dom.modalOldPrice = document.createElement('div');
  dom.modalPromoBadge = document.createElement('div');
  dom.modalCat = document.createElement('div');
  dom.modalStock = document.createElement('div');
  dom.modalBackLabel = document.createElement('div');
  dom.modalVariants = document.createElement('div');
  dom.modalDetails = dom.modal.querySelector('.k-modal-details');
  dom.addCartBtn = document.createElement('button');
  dom.pageScroll = document.querySelector('.k-page-scroll');
  dom.pageScroll.scrollTo = jest.fn();
  dom.grid = null;
  dom.searchInput = null;
  dom.modalCarouselTrack = document.createElement('div');
  dom.modal.querySelector('.k-modal-img-wrap').appendChild(dom.modalCarouselTrack);
  dom.modal.append(
    dom.modalName, dom.modalSku, dom.modalDesc, dom.modalPrice,
    dom.modalQtyVal, dom.modalOldPrice, dom.modalPromoBadge, dom.modalCat,
    dom.modalStock, dom.modalBackLabel, dom.modalVariants, dom.addCartBtn,
  );
}

mountDom();
const pushStateSpy = jest.spyOn(window.history, 'pushState').mockImplementation(() => {});
jest.spyOn(window.history, 'back').mockImplementation(() => {});
const { openModal, closeModal, setupModal } = require('../../js/b-modal-core.js');

beforeEach(() => {
  jest.clearAllMocks();
  mockIsDesktop.mockReturnValue(false); // mobile par défaut
  state.products = [product(1), product(2)];
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
  dom.modalOverlay.classList.remove('open');
  document.body.className = '';
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true,
    json: async () => ({ suggestions: [] }),
  }));
});

function actionsNode() {
  return document.querySelector('.k-modal-actions');
}

function configuratorHome() {
  return document.getElementById('k-modal-configurator');
}

describe('trio de composition .k-modal-actions (MIGRATION v3.0, LOT 3)', () => {

  test('setup initial mobile : les actions sont montées en 3e ligne du shell mobile (enfant direct de #k-modal)', () => {
    setupModal();
    expect(actionsNode().parentNode).toBe(dom.modal);
    expect(configuratorHome().querySelector('.k-modal-actions')).toBeNull();
  });

  test('ouverture mobile (openModal) : les actions restent/sont montées dans le shell mobile', () => {
    setupModal();
    // Simule un retour préalable à la home desktop pour vérifier que
    // openModal() remonte bien les actions dans le shell mobile.
    configuratorHome().appendChild(actionsNode());
    expect(actionsNode().parentNode).toBe(configuratorHome());

    openModal('1');

    expect(actionsNode().parentNode).toBe(dom.modal);
  });

  test('mobile → desktop (resize pendant modale ouverte) : les actions quittent le shell mobile et retrouvent leur home canonique, sans clone', () => {
    setupModal();
    openModal('1');
    const originalNode = actionsNode();
    expect(originalNode.parentNode).toBe(dom.modal);

    mockIsDesktop.mockReturnValue(true);
    bus.emit('modal:composition-synced');

    expect(document.querySelectorAll('.k-modal-actions').length).toBe(1); // aucun clone
    expect(actionsNode()).toBe(originalNode); // même identité de nœud
    expect(actionsNode().parentNode).toBe(configuratorHome());
  });

  test('desktop → mobile (resize inverse) : les mêmes nœuds sont remontés dans le shell mobile, listeners et état conservés', () => {
    setupModal();
    openModal('1');

    // Passage mobile → desktop
    mockIsDesktop.mockReturnValue(true);
    bus.emit('modal:composition-synced');
    const btn = document.getElementById('k-add-cart-btn');
    const clickSpy = jest.fn();
    btn.addEventListener('click', clickSpy);
    btn.dataset.marker = 'kept-across-reparenting';

    // Retour desktop → mobile
    mockIsDesktop.mockReturnValue(false);
    bus.emit('modal:composition-synced');

    expect(actionsNode().parentNode).toBe(dom.modal);
    expect(document.querySelectorAll('.k-modal-actions').length).toBe(1);
    const btnAfter = document.getElementById('k-add-cart-btn');
    expect(btnAfter).toBe(btn); // même nœud, pas un clone
    expect(btnAfter.dataset.marker).toBe('kept-across-reparenting');
    btnAfter.dispatchEvent(new Event('click', { bubbles: true }));
    expect(clickSpy).toHaveBeenCalledTimes(1); // listener toujours attaché
  });

  test('fermeture (closeModal) : restoreActionsHome remet les actions dans leur emplacement propriétaire', () => {
    setupModal();
    openModal('1');
    expect(actionsNode().parentNode).toBe(dom.modal);

    closeModal();

    expect(actionsNode().parentNode).toBe(configuratorHome());
    expect(document.querySelectorAll('.k-modal-actions').length).toBe(1);
  });

  test('appels répétés : réconciliation idempotente, aucun doublon, aucun déplacement inutile si la composition est déjà correcte', () => {
    setupModal();
    openModal('1');
    const node = actionsNode();
    const parentBefore = node.parentNode;

    // Toujours mobile : reconcileActionsComposition ne doit rien déplacer.
    bus.emit('modal:composition-synced');
    bus.emit('modal:composition-synced');
    bus.emit('modal:composition-synced');

    expect(actionsNode()).toBe(node);
    expect(actionsNode().parentNode).toBe(parentBefore);
    expect(document.querySelectorAll('.k-modal-actions').length).toBe(1);
  });

  test('reconcileActionsComposition est un no-op quand la modale est fermée', () => {
    setupModal();
    // Modale jamais ouverte : dom.modalOverlay n'a pas la classe 'open'.
    const node = actionsNode();
    const parentBefore = node.parentNode;

    mockIsDesktop.mockReturnValue(true);
    bus.emit('modal:composition-synced');

    expect(actionsNode()).toBe(node);
    expect(actionsNode().parentNode).toBe(parentBefore);
  });

  test('fermeture puis réouverture : aucun doublon accumulé au fil des cycles', () => {
    setupModal();
    openModal('1');
    closeModal();
    openModal('2');
    closeModal();
    openModal('1');

    expect(document.querySelectorAll('.k-modal-actions').length).toBe(1);
    expect(actionsNode().parentNode).toBe(dom.modal);
  });
});
