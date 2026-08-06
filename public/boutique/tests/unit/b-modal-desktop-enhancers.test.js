'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../js/b-scroll-owner.js', () => ({ isDesktop: jest.fn(() => true) }));

describe('b-modal-desktop-enhancers — D-P1 : panneau commercial allégé', () => {
  let bus;
  let dom;
  let enhancers;

  function installDom() {
    document.body.innerHTML = `
      <div id="k-modal" class="k-modal">
        <div class="k-modal-topbar"><button class="k-modal-back"></button></div>
        <div class="k-modal-info"></div>
        <div class="k-modal-scroll"></div>
        <div class="k-modal-actions"><div class="k-modal-subtotal">legacy subtotal</div></div>
      </div>
      <div id="k-modal-aed-price">legacy eur</div>
      <div id="k-modal-flash-bar">legacy promo</div>
      <div id="k-modal-stock-bar">legacy stock</div>
      <div id="k-modal-delivery">legacy delivery</div>
      <div id="k-modal-payment">legacy payment</div>`;
    dom.modal = document.getElementById('k-modal');
  }

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';

    ({ bus } = require('../../js/b-bus.js'));
    ({ dom } = require('../../js/b-store.js'));
    enhancers = require('../../js/b-modal-desktop-enhancers.js');

    installDom();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('D-P1 : setup est idempotent et branche modal:opened / modal:composition-synced', () => {
    const onSpy = jest.spyOn(bus, 'on');
    enhancers.setupModalDesktopEnhancers();
    enhancers.setupModalDesktopEnhancers();
    expect(onSpy).toHaveBeenCalledTimes(2);
    expect(onSpy).toHaveBeenCalledWith('modal:opened', expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith('modal:composition-synced', expect.any(Function));
  });

  test('D-P1 : modal:opened n\'injecte plus ni fil d\'Ariane, ni réassurance, ni partage, ni vu récemment', () => {
    enhancers.setupModalDesktopEnhancers();
    bus.emit('modal:opened', { id: 42, name: 'Sac à main tressé', category: 'Mode & Beauté', price_kmf: 5000 });

    expect(dom.modal.querySelector('.k-modal-breadcrumb')).toBeNull();
    expect(dom.modal.querySelector('.k-modal-share-row')).toBeNull();
    expect(dom.modal.querySelector('.k-modal-trust')).toBeNull();
    expect(dom.modal.querySelector('.k-modal-recent')).toBeNull();
  });

  test('D-P1 : modal:composition-synced (resize mobile→desktop) n\'injecte rien non plus', () => {
    enhancers.setupModalDesktopEnhancers();
    bus.emit('modal:composition-synced');

    expect(dom.modal.querySelector('.k-modal-breadcrumb')).toBeNull();
    expect(dom.modal.querySelector('.k-modal-trust')).toBeNull();
    expect(dom.modal.querySelector('.k-modal-share-row')).toBeNull();
    expect(dom.modal.querySelector('.k-modal-recent')).toBeNull();
  });

  test('n\'écrit toujours aucune vérité prix, stock, livraison, paiement ou sous-total', () => {
    enhancers.setupModalDesktopEnhancers();
    bus.emit('modal:opened', { id: 42, name: 'Sac à main tressé', category: 'Mode & Beauté', price_kmf: 5000 });

    expect(document.getElementById('k-modal-aed-price').textContent).toBe('legacy eur');
    expect(document.getElementById('k-modal-flash-bar').textContent).toBe('legacy promo');
    expect(document.getElementById('k-modal-stock-bar').textContent).toBe('legacy stock');
    expect(document.getElementById('k-modal-delivery').textContent).toBe('legacy delivery');
    expect(document.getElementById('k-modal-payment').textContent).toBe('legacy payment');
    expect(dom.modal.querySelector('.k-modal-subtotal').textContent).toBe('legacy subtotal');
  });

  test('PDC-6/D-P1 : aucune dépendance morte (view-model legacy, injecteurs éditoriaux supprimés)', () => {
    expect(enhancers.setupModalContractClasses).toBeUndefined();

    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '../../js/b-modal-desktop-enhancers.js'),
      'utf8'
    );
    expect(source).not.toMatch(/modal-view-model/);
    expect(source).not.toMatch(/buildModalViewModel/);
    expect(source).not.toMatch(/applyModalClasses/);
    expect(source).not.toMatch(/injectBreadcrumb/);
    expect(source).not.toMatch(/injectShareRow/);
    expect(source).not.toMatch(/injectTrustBadges/);
    expect(source).not.toMatch(/injectRecentlyViewed/);
  });
});
