'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const handlers = {};

jest.mock('../../js/b-bus.js', () => ({
  bus: {
    on: jest.fn((event, fn) => { handlers[event] = fn; }),
    emit: jest.fn(),
  },
}));

jest.mock('../../js/b-store.js', () => ({
  state: {},
  dom: {},
}));

jest.mock('../../js/view-models/modal-selection-model.js', () => ({
  createModalSelection: jest.fn((detail) => ({
    inventory_model: detail.inventory_model,
    selection_supported: true,
    selected_options: {},
    selected_sku_id: null,
    selected_media: detail.media || [],
    option_states: {},
    selection_message: null,
  })),
}));

jest.mock('../../js/b-modal-mobile-product.js', () => ({
  clearMobileProductDetailState: jest.fn(),
  renderMobileProductDetail: jest.fn(),
}));

jest.mock('../../js/b-modal-desktop-product.js', () => ({
  clearDesktopProductDetailState: jest.fn(),
  renderDesktopProductDetail: jest.fn(),
}));

// §4 — mock isDesktop (remplace window.matchMedia dans ce fichier)
jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(),
  getScrollY: jest.fn(() => 0),
  scrollToPosition: jest.fn(),
}));

const { bus } = require('../../js/b-bus.js');
const { state, dom } = require('../../js/b-store.js');
const { createModalSelection } = require('../../js/view-models/modal-selection-model.js');
const {
  clearMobileProductDetailState,
  renderMobileProductDetail,
} = require('../../js/b-modal-mobile-product.js');
const {
  clearDesktopProductDetailState,
  renderDesktopProductDetail,
} = require('../../js/b-modal-desktop-product.js');
const {
  setupProductDetailModal,
  _productDetailBootstrapTestApi,
} = require('../../js/b-modal-product-detail-bootstrap.js');

const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function detail() {
  return {
    contract_version: '1',
    inventory_model: 'SKU',
    product: { id: PRODUCT_ID, name: 'Robe Dubaï' },
    pricing: {},
    media: [],
    option_axes: [],
    sellable_units: [],
    delivery_options: [],
  };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function installDom() {
  document.body.innerHTML =
    '<div id="k-modal">' +
      '<div id="k-modal-variants"></div>' +
      '<div class="k-modal-actions">' +
        '<button id="k-add-cart-btn"></button>' +
        '<button id="k-buy-now-btn"></button>' +
        '<button id="k-qty-minus"></button>' +
        '<button id="k-qty-plus"></button>' +
      '</div>' +
    '</div>';
  require('../../js/b-scroll-owner.js').isDesktop.mockReturnValue(false); // mobile
  dom.modal = document.getElementById('k-modal');
  dom.modalVariants = document.getElementById('k-modal-variants');
  dom.addCartBtn = document.getElementById('k-add-cart-btn');
  dom.qtyMinus = document.getElementById('k-qty-minus');
  dom.qtyPlus = document.getElementById('k-qty-plus');
}

function transactionalControls() {
  return [
    document.getElementById('k-add-cart-btn'),
    document.getElementById('k-buy-now-btn'),
    document.getElementById('k-qty-minus'),
    document.getElementById('k-qty-plus'),
  ];
}

describe('product detail modal bootstrap', () => {
  beforeAll(() => {
    installDom();
    setupProductDetailModal();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    installDom();
    state.modalOpen = true;
    state.modalProduct = { id: PRODUCT_ID, name: 'Robe Dubaï' };
    state.modalSelection = null;
    state.modalProductDetail = null;
    global.fetch = jest.fn();

    renderMobileProductDetail.mockImplementation((_detail, selection) => {
      state.modalSelection = selection;
      state.modalProductDetail = _detail;
      dom.modalVariants.innerHTML = '<div data-pdc4-root="1"></div>';
    });
    renderDesktopProductDetail.mockImplementation((_detail, selection) => {
      state.modalSelection = selection;
      state.modalProductDetail = _detail;
      dom.modalVariants.innerHTML = '<div data-pdc5-root="1"></div>';
    });
  });

  afterAll(() => {
    delete global.fetch;
  });

  test('mobile : rend PDC puis publie modal:detail-ready', async () => {
    const payload = detail();
    fetch.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(payload) });

    handlers['modal:opened']({ id: PRODUCT_ID, name: 'Robe Dubaï' });
    await flush();
    await flush();

    expect(clearDesktopProductDetailState).toHaveBeenCalledTimes(1);
    expect(clearMobileProductDetailState).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`/api/products/${PRODUCT_ID}/detail`, { credentials: 'include' });
    expect(createModalSelection).toHaveBeenCalledWith(payload);
    expect(renderMobileProductDetail).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({ selected_sku_id: null }),
      { forceMedia: true }
    );
    expect(renderDesktopProductDetail).not.toHaveBeenCalled();
    expect(bus.emit).toHaveBeenCalledWith('modal:detail-ready');
  });

  test('desktop : rend PDC puis publie modal:detail-ready', async () => {
    require('../../js/b-scroll-owner.js').isDesktop.mockReturnValue(true); // desktop
    const payload = detail();
    fetch.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(payload) });

    handlers['modal:opened']({ id: PRODUCT_ID });
    await flush();
    await flush();

    expect(renderDesktopProductDetail).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({ selected_sku_id: null }),
      { forceMedia: true }
    );
    expect(renderMobileProductDetail).not.toHaveBeenCalled();
    expect(bus.emit).toHaveBeenCalledWith('modal:detail-ready');
  });

  test('passage mobile vers desktop réutilise contrat et sélection sans refetch', async () => {
    const payload = detail();
    fetch.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(payload) });

    handlers['modal:opened']({ id: PRODUCT_ID });
    await flush();
    await flush();

    const sharedSelection = state.modalSelection;
    renderMobileProductDetail.mockClear();
    renderDesktopProductDetail.mockClear();
    bus.emit.mockClear();
    require('../../js/b-scroll-owner.js').isDesktop.mockReturnValue(true); // desktop

    _productDetailBootstrapTestApi.syncResponsiveComposition();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(createModalSelection).toHaveBeenCalledTimes(1);
    expect(state.modalSelection).toBe(sharedSelection);
    expect(renderDesktopProductDetail).toHaveBeenCalledWith(
      payload,
      sharedSelection,
      { forceMedia: false }
    );
    expect(bus.emit).toHaveBeenCalledWith('modal:detail-ready');
    expect(bus.emit).toHaveBeenCalledWith('modal:composition-synced');
  });

  describe('reset de modalDeliverySelection (chantier Air Shipped — doctrine §6)', () => {
    test('ouverture d\'un nouveau produit réinitialise le rail choisi sur le produit précédent', async () => {
      state.modalDeliverySelection = { requested_transport_rail: 'AIR_EXPRESS' };
      fetch.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(detail()) });

      handlers['modal:opened']({ id: PRODUCT_ID, name: 'Robe Dubaï' });

      // Le reset est synchrone (avant même la résolution du fetch) : un rail
      // choisi sur le produit A ne doit jamais survivre, même le temps du fetch.
      expect(state.modalDeliverySelection).toEqual({ requested_transport_rail: null });
      await flush();
      await flush();
      expect(state.modalDeliverySelection).toEqual({ requested_transport_rail: null });
    });

    test('navigation précédent/suivant (deuxième modal:opened sans fermeture) réinitialise aussi le rail', async () => {
      fetch.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(detail()) });
      handlers['modal:opened']({ id: PRODUCT_ID, name: 'Robe Dubaï' });
      await flush();
      await flush();

      state.modalDeliverySelection = { requested_transport_rail: 'SEA_STANDARD' };
      const otherProductId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      state.modalProduct = { id: otherProductId, name: 'Sac raphia' };
      fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(Object.assign(detail(), {
          product: { id: otherProductId, name: 'Sac raphia' },
        })),
      });

      handlers['modal:opened']({ id: otherProductId, name: 'Sac raphia' });

      expect(state.modalDeliverySelection).toEqual({ requested_transport_rail: null });
    });

    test('fermeture de la modale réinitialise également le rail', () => {
      state.modalDeliverySelection = { requested_transport_rail: 'AIR_EXPRESS' };
      handlers['modal:closed']();
      expect(state.modalDeliverySelection).toEqual({ requested_transport_rail: null });
    });
  });

  test('resize dans le même mode ne rerend pas', async () => {
    fetch.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(detail()) });
    handlers['modal:opened']({ id: PRODUCT_ID });
    await flush();
    await flush();
    renderMobileProductDetail.mockClear();
    renderDesktopProductDetail.mockClear();
    bus.emit.mockClear();

    _productDetailBootstrapTestApi.syncResponsiveComposition();

    expect(renderMobileProductDetail).not.toHaveBeenCalled();
    expect(renderDesktopProductDetail).not.toHaveBeenCalled();
    expect(bus.emit).not.toHaveBeenCalledWith('modal:detail-ready');
  });

  test('ignore une réponse arrivée après navigation vers un autre produit', async () => {
    let resolveJson;
    fetch.mockResolvedValue({
      ok: true,
      json: jest.fn(() => new Promise((resolve) => { resolveJson = resolve; })),
    });

    handlers['modal:opened']({ id: PRODUCT_ID });
    await flush();
    state.modalProduct = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    resolveJson(detail());
    await flush();

    expect(renderMobileProductDetail).not.toHaveBeenCalled();
    expect(renderDesktopProductDetail).not.toHaveBeenCalled();
    expect(bus.emit).not.toHaveBeenCalledWith('modal:detail-ready');
  });

  test('verrouille CTA et stepper avant la résolution du fetch', () => {
    fetch.mockReturnValue(new Promise(() => {}));
    handlers['modal:opened']({ id: PRODUCT_ID });
    transactionalControls().forEach((control) => expect(control.disabled).toBe(true));
  });

  test('échec HTTP : purge le legacy, affiche l erreur et reste fail-closed', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    dom.modalVariants.innerHTML = '<div data-legacy="1">legacy</div>';
    fetch.mockResolvedValue({ ok: false, status: 503 });

    handlers['modal:opened']({ id: PRODUCT_ID });
    await flush();
    await flush();

    expect(dom.modalVariants.querySelector('[data-legacy]')).toBeNull();
    expect(dom.modalVariants.querySelector('[data-mdm-detail-error]')).not.toBeNull();
    transactionalControls().forEach((control) => expect(control.disabled).toBe(true));
    expect(renderMobileProductDetail).not.toHaveBeenCalled();
    expect(bus.emit).not.toHaveBeenCalledWith('modal:detail-ready');
    warn.mockRestore();
  });

  test('erreur réseau : reste fail-closed', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    fetch.mockRejectedValue(new Error('network down'));

    handlers['modal:opened']({ id: PRODUCT_ID });
    await flush();
    await flush();

    transactionalControls().forEach((control) => expect(control.disabled).toBe(true));
    expect(bus.emit).not.toHaveBeenCalledWith('modal:detail-ready');
    warn.mockRestore();
  });

  test('le module ne réintroduit aucun guard legacy ni dépendance directe panier', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '../../js/b-modal-product-detail-bootstrap.js'),
      'utf8'
    );
    expect(source).not.toMatch(/MutationObserver/);
    expect(source).not.toMatch(/_variantGuard/);
    expect(source).not.toMatch(/installVariantGuard/);
    expect(source).not.toMatch(/disconnectVariantGuard/);
    expect(source).not.toMatch(/expectedRootSelector/);
    expect(source).not.toMatch(/b-modal-cart/);
    expect(source).toMatch(/bus\.emit\('modal:detail-ready'\)/);
  });

  test('modal:closed invalide les requêtes et nettoie les deux compositions', () => {
    handlers['modal:closed']();
    expect(clearDesktopProductDetailState).toHaveBeenCalledTimes(1);
    expect(clearMobileProductDetailState).toHaveBeenCalledTimes(1);
  });
});
