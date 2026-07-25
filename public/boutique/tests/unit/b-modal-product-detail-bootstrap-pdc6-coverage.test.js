'use strict';

const handlers = {};

jest.mock('../../js/b-bus.js', () => ({
  bus: { on: jest.fn((event, fn) => { handlers[event] = fn; }), emit: jest.fn() },
}));

jest.mock('../../js/b-store.js', () => ({ state: {}, dom: {} }));
jest.mock('../../js/view-models/modal-selection-model.js', () => ({
  createModalSelection: jest.fn(() => ({ selected_options: {}, selected_media: [], option_states: {} })),
}));
jest.mock('../../js/b-modal-mobile-product.js', () => ({
  clearMobileProductDetailState: jest.fn(),
  renderMobileProductDetail: jest.fn(),
}));
jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(),
  getScrollY: jest.fn(() => 0),
  scrollToPosition: jest.fn(),
}));

jest.mock('../../js/b-modal-desktop-product.js', () => ({
  clearDesktopProductDetailState: jest.fn(),
  renderDesktopProductDetail: jest.fn(),
}));

const { state, dom } = require('../../js/b-store.js');
const { renderMobileProductDetail } = require('../../js/b-modal-mobile-product.js');
const { renderDesktopProductDetail } = require('../../js/b-modal-desktop-product.js');
const {
  setupProductDetailModal,
  _productDetailBootstrapTestApi,
} = require('../../js/b-modal-product-detail-bootstrap.js');

describe('product detail bootstrap — PDC-6 branch closure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = `
      <div id="k-modal">
        <div id="k-modal-variants"></div>
        <button id="k-add-cart-btn"></button>
        <button id="k-buy-now-btn"></button>
        <button id="k-qty-minus"></button>
        <button id="k-qty-plus"></button>
      </div>`;
    dom.modal = document.getElementById('k-modal');
    dom.modalVariants = document.getElementById('k-modal-variants');
    dom.addCartBtn = document.getElementById('k-add-cart-btn');
    dom.qtyMinus = document.getElementById('k-qty-minus');
    dom.qtyPlus = document.getElementById('k-qty-plus');
    require('../../js/b-scroll-owner.js').isDesktop.mockReturnValue(false); // mobile
    state.modalOpen = false;
    state.modalProductDetail = { product: { id: 'p1' } };
    state.modalSelection = { selected_options: {} };
    state.modalProduct = { id: 'p1' };
  });

  test('composition responsive est un no-op modal fermée', () => {
    _productDetailBootstrapTestApi.syncResponsiveComposition();
    expect(renderMobileProductDetail).not.toHaveBeenCalled();
    expect(renderDesktopProductDetail).not.toHaveBeenCalled();
  });

  test('resize débouncé réutilise le contrat et la sélection existants', () => {
    jest.useFakeTimers();
    setupProductDetailModal();

    state.modalOpen = true;
    const detail = state.modalProductDetail;
    const selection = state.modalSelection;

    _productDetailBootstrapTestApi.renderResponsiveProductDetail(detail, selection, true);
    expect(renderMobileProductDetail).toHaveBeenCalledWith(detail, selection, { forceMedia: true });

    require('../../js/b-scroll-owner.js').isDesktop.mockReturnValue(true); // desktop
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    jest.advanceTimersByTime(119);
    expect(renderDesktopProductDetail).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);

    expect(renderDesktopProductDetail).toHaveBeenCalledWith(detail, selection, { forceMedia: false });
    jest.useRealTimers();
  });

  test('modal:opened sans produit est ignoré sans fetch', () => {
    setupProductDetailModal();
    global.fetch = jest.fn();
    handlers['modal:opened'](null);
    expect(global.fetch).not.toHaveBeenCalled();
    delete global.fetch;
  });
});
