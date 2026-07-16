'use strict';

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
      '<button id="k-add-cart-btn"></button>' +
      '<button id="k-buy-now-btn"></button>' +
      '<button id="k-qty-minus"></button>' +
      '<button id="k-qty-plus"></button>' +
    '</div>';
  window.matchMedia = jest.fn().mockReturnValue({ matches: true });
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

  test('mobile : charge une fois le contrat et rend PDC-4', async () => {
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
  });

  test('desktop : le même fetch et le même reducer alimentent PDC-5', async () => {
    window.matchMedia.mockReturnValue({ matches: false });
    const payload = detail();
    fetch.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(payload) });

    handlers['modal:opened']({ id: PRODUCT_ID });
    await flush();
    await flush();

    expect(createModalSelection).toHaveBeenCalledWith(payload);
    expect(renderDesktopProductDetail).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({ selected_sku_id: null }),
      { forceMedia: true }
    );
    expect(renderMobileProductDetail).not.toHaveBeenCalled();
  });

  test('passage mobile vers desktop réutilise le contrat et la même sélection sans refetch', async () => {
    const payload = detail();
    fetch.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(payload) });

    handlers['modal:opened']({ id: PRODUCT_ID });
    await flush();
    await flush();

    const sharedSelection = state.modalSelection;
    renderMobileProductDetail.mockClear();
    renderDesktopProductDetail.mockClear();
    window.matchMedia.mockReturnValue({ matches: false });

    _productDetailBootstrapTestApi.syncResponsiveComposition();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(createModalSelection).toHaveBeenCalledTimes(1);
    expect(state.modalSelection).toBe(sharedSelection);
    expect(renderDesktopProductDetail).toHaveBeenCalledWith(
      payload,
      sharedSelection,
      { forceMedia: false }
    );
    expect(renderMobileProductDetail).not.toHaveBeenCalled();
  });

  test('un resize restant dans le même mode ne rerend pas la fiche', async () => {
    const payload = detail();
    fetch.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(payload) });

    handlers['modal:opened']({ id: PRODUCT_ID });
    await flush();
    await flush();
    renderMobileProductDetail.mockClear();

    _productDetailBootstrapTestApi.syncResponsiveComposition();

    expect(renderMobileProductDetail).not.toHaveBeenCalled();
    expect(renderDesktopProductDetail).not.toHaveBeenCalled();
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
  });

  test('PDC-6 : le chemin transactionnel (CTA + stepper) est verrouillé avant même la résolution du fetch /detail', () => {
    fetch.mockReturnValue(new Promise(() => {})); // ne résout jamais dans ce test

    handlers['modal:opened']({ id: PRODUCT_ID });

    // Verrouillage synchrone, posé avant l'await du fetch — pas besoin de flush().
    transactionalControls().forEach((control) => {
      expect(control.disabled).toBe(true);
    });
  });

  test('PDC-6 : un échec HTTP fail-close — aucun legacy variants préservé, aucune mutation panier SKU possible', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    dom.modalVariants.innerHTML = '<div data-legacy="1">legacy</div>';
    fetch.mockResolvedValue({ ok: false, status: 503 });

    handlers['modal:opened']({ id: PRODUCT_ID });
    await flush();
    await flush();

    expect(clearDesktopProductDetailState).toHaveBeenCalledTimes(1);
    expect(clearMobileProductDetailState).toHaveBeenCalledTimes(1);
    // Inversion PDC-6 : le paint legacy #k-modal-variants n'est plus préservé
    // en cas d'échec /detail — il est purgé (fail closed), pas conservé.
    expect(dom.modalVariants.querySelector('[data-legacy]')).toBeNull();
    // [MDM-8 phase 2] Le vide silencieux (indiscernable d'une modale cassée,
    // cf audit §1.3/§6) est remplacé par un état d'erreur visuel explicite.
    // Le chemin transactionnel reste verrouillé (assertion ci-dessous) —
    // seul le rendu change, pas le comportement fail-closed.
    expect(dom.modalVariants.querySelector('[data-mdm-detail-error]')).not.toBeNull();
    // Preuve : aucune mutation panier SKU n'est possible tant que le contrat
    // détail n'a pas résolu avec succès — CTA et stepper restent verrouillés.
    transactionalControls().forEach((control) => {
      expect(control.disabled).toBe(true);
    });
    expect(renderMobileProductDetail).not.toHaveBeenCalled();
    expect(renderDesktopProductDetail).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('PDC-6 : une erreur réseau (fetch rejeté) verrouille aussi le chemin transactionnel', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    fetch.mockRejectedValue(new Error('network down'));

    handlers['modal:opened']({ id: PRODUCT_ID });
    await flush();
    await flush();

    transactionalControls().forEach((control) => {
      expect(control.disabled).toBe(true);
    });
    expect(renderMobileProductDetail).not.toHaveBeenCalled();
    expect(renderDesktopProductDetail).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('PDC-6 : aucun MutationObserver ne protège plus #k-modal-variants — un repaint tardif du conteneur n\'est pas corrigé automatiquement', async () => {
    window.matchMedia.mockReturnValue({ matches: false });
    const payload = detail();
    fetch.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(payload) });

    handlers['modal:opened']({ id: PRODUCT_ID });
    await flush();
    await flush();
    renderDesktopProductDetail.mockClear();

    dom.modalVariants.innerHTML = '<div data-legacy="1">legacy tardif</div>';
    await flush();
    await flush();

    // Sans guard PDC-4/PDC-5 (supprimé PDC-6), aucun rerender automatique ne
    // corrige ce repaint : ce n'est plus la responsabilité du bootstrap.
    expect(renderDesktopProductDetail).not.toHaveBeenCalled();
  });

  test('PDC-6 : le module ne référence plus aucun mécanisme de guard variants legacy', () => {
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
  });

  test('modal:closed invalide les requêtes et nettoie les deux compositions', () => {
    handlers['modal:closed']();
    expect(clearDesktopProductDetailState).toHaveBeenCalledTimes(1);
    expect(clearMobileProductDetailState).toHaveBeenCalledTimes(1);
  });
});
