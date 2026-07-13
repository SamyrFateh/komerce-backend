'use strict';

jest.mock('../../js/b-catalog.js', () => ({ setActiveCat: jest.fn() }));
jest.mock('../../js/b-cart-core.js', () => ({ showToast: jest.fn() }));
jest.mock('../../js/b-modal.js', () => ({ openModal: jest.fn() }));
jest.mock('../../js/b-scroll-owner.js', () => ({ isDesktop: jest.fn(() => true) }));

describe('b-modal-desktop-enhancers — PDC-6 branch closure', () => {
  test('contrat détail sans pricing et back avec sibling restent des préoccupations de composition', () => {
    const { bus } = require('../../js/b-bus.js');
    const { state, dom } = require('../../js/b-store.js');
    const { isDesktop } = require('../../js/b-scroll-owner.js');
    const { setupModalDesktopEnhancers } = require('../../js/b-modal-desktop-enhancers.js');

    document.body.innerHTML = `
      <div id="k-modal">
        <div class="k-modal-topbar">
          <button class="k-modal-back"></button>
          <span class="after-back">après</span>
        </div>
        <div class="k-modal-info"></div>
        <div class="k-modal-scroll"></div>
      </div>`;
    dom.modal = document.getElementById('k-modal');
    state.modalProduct = null;
    state.modalProductDetail = {
      product: { id: 42, name: 'Produit contrat', category: 'catalogue' },
    };
    state.products = [];
    state.viewedHistory = [];
    isDesktop.mockReturnValue(true);

    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(); return 1; });

    setupModalDesktopEnhancers();
    bus.emit('modal:opened', { id: 42 });

    const topbar = dom.modal.querySelector('.k-modal-topbar');
    const breadcrumb = topbar.querySelector('.k-modal-breadcrumb');
    expect(breadcrumb).not.toBeNull();
    expect(breadcrumb.nextElementSibling).toHaveClass('after-back');
    expect(dom.modal.querySelector('.k-modal-share-row').textContent).toContain('Copier le lien');
    expect(dom.modal.querySelector('.k-modal-recent')).toBeNull();

    jest.restoreAllMocks();
  });
});
