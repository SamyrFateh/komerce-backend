'use strict';

jest.mock('../../js/b-catalog.js', () => ({ setActiveCat: jest.fn() }));
jest.mock('../../js/b-cart-core.js', () => ({ showToast: jest.fn() }));
jest.mock('../../js/b-modal.js', () => ({ openModal: jest.fn() }));
jest.mock('../../js/b-scroll-owner.js', () => ({ isDesktop: jest.fn(() => true) }));

describe('b-modal-desktop-enhancers — composition only', () => {
  let bus;
  let state;
  let dom;
  let isDesktop;
  let showToast;
  let setActiveCat;
  let openModal;
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
    ({ state, dom } = require('../../js/b-store.js'));
    ({ isDesktop } = require('../../js/b-scroll-owner.js'));
    ({ showToast } = require('../../js/b-cart-core.js'));
    ({ setActiveCat } = require('../../js/b-catalog.js'));
    ({ openModal } = require('../../js/b-modal.js'));
    enhancers = require('../../js/b-modal-desktop-enhancers.js');

    installDom();
    isDesktop.mockReturnValue(true);
    state.modalProduct = {
      id: 42,
      name: 'Sac à main tressé',
      category: 'Mode & Beauté',
      price_kmf: 5000,
      stock: 3,
    };
    state.modalProductDetail = null;
    state.products = [
      state.modalProduct,
      { id: 7, name: 'Sandales', category: 'Mode & Beauté', price_kmf: 3000, image_url: '/sandales.jpg' },
    ];
    state.viewedHistory = [7, 42];

    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(); return 1; });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn(() => Promise.resolve()) },
      configurable: true,
    });
    jest.spyOn(window, 'open').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('mobile : setup desktop ne branche aucun listener', () => {
    isDesktop.mockReturnValue(false);
    const spy = jest.spyOn(bus, 'on');
    enhancers.setupModalDesktopEnhancers();
    expect(spy).not.toHaveBeenCalled();
  });

  test('desktop : setup est idempotent et rend les enrichissements éditoriaux', () => {
    const onSpy = jest.spyOn(bus, 'on');
    enhancers.setupModalDesktopEnhancers();
    enhancers.setupModalDesktopEnhancers();
    expect(onSpy).toHaveBeenCalledTimes(1);
    expect(onSpy).toHaveBeenCalledWith('modal:opened', expect.any(Function));

    bus.emit('modal:opened', state.modalProduct);

    expect(dom.modal.querySelector('.k-modal-breadcrumb')).not.toBeNull();
    expect(dom.modal.querySelector('.k-modal-share-row')).not.toBeNull();
    expect(dom.modal.querySelector('.k-modal-trust')).not.toBeNull();
    expect(dom.modal.querySelector('.k-modal-recent')).not.toBeNull();
  });

  test('n’écrit plus aucune vérité prix, stock, livraison, paiement ou sous-total', () => {
    enhancers.setupModalDesktopEnhancers();
    bus.emit('modal:opened', state.modalProduct);

    expect(document.getElementById('k-modal-aed-price').textContent).toBe('legacy eur');
    expect(document.getElementById('k-modal-flash-bar').textContent).toBe('legacy promo');
    expect(document.getElementById('k-modal-stock-bar').textContent).toBe('legacy stock');
    expect(document.getElementById('k-modal-delivery').textContent).toBe('legacy delivery');
    expect(document.getElementById('k-modal-payment').textContent).toBe('legacy payment');
    expect(dom.modal.querySelector('.k-modal-subtotal').textContent).toBe('legacy subtotal');
  });

  test('breadcrumb utilise le contrat détail lorsqu’il est disponible et filtre la catégorie au clic', () => {
    state.modalProductDetail = {
      product: { id: 42, name: 'Robe Dubaï', category: 'vetements' },
      pricing: { price_kmf: 12500 },
    };
    enhancers.setupModalDesktopEnhancers();
    bus.emit('modal:opened', state.modalProduct);

    const breadcrumb = dom.modal.querySelector('.k-modal-breadcrumb');
    expect(breadcrumb.textContent).toContain('Robe Dubaï');
    expect(breadcrumb.textContent).toContain('vetements');

    breadcrumb.querySelectorAll('.k-modal-breadcrumb-cat')[1].click();
    expect(setActiveCat).toHaveBeenCalledWith('vetements');
  });

  test('catégorie vide : le breadcrumb ne déclenche aucun filtre', () => {
    state.modalProduct = { id: 1, name: 'Produit', category: '', price_kmf: 1000 };
    enhancers.setupModalDesktopEnhancers();
    bus.emit('modal:opened', state.modalProduct);

    dom.modal.querySelector('.k-modal-breadcrumb-cat').click();
    expect(setActiveCat).not.toHaveBeenCalled();
  });

  test('partage utilise identité/prix du contrat détail et copie le lien', async () => {
    state.modalProductDetail = {
      product: { id: 42, name: 'Robe Dubaï', category: 'vetements' },
      pricing: { price_kmf: 12500 },
    };
    enhancers.setupModalDesktopEnhancers();
    bus.emit('modal:opened', state.modalProduct);

    const row = dom.modal.querySelector('.k-modal-share-row');
    const wa = row.querySelector('.k-modal-share-btn--wa');
    expect(decodeURIComponent(wa.dataset.href)).toContain('Robe Dubaï');
    expect(decodeURIComponent(wa.dataset.href)).toContain('12');
    wa.click();
    expect(window.open).toHaveBeenCalled();

    row.querySelector('[data-action="copy"]').click();
    await Promise.resolve();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/?p=42`);
    expect(showToast).toHaveBeenCalledWith('🔗 Lien copié !');
  });

  test('réassurance ne contient plus de promesse stock produit reconstruite', () => {
    enhancers.setupModalDesktopEnhancers();
    bus.emit('modal:opened', state.modalProduct);
    const trust = dom.modal.querySelector('.k-modal-trust');
    expect(trust.textContent).toContain('Paiement sécurisé');
    expect(trust.textContent).toContain('Support Komerce');
    expect(trust.textContent).not.toContain('Stock garanti');
  });

  test('vu récemment ouvre le produit sélectionné sans dupliquer la logique produit', () => {
    enhancers.setupModalDesktopEnhancers();
    bus.emit('modal:opened', state.modalProduct);
    const card = dom.modal.querySelector('.k-modal-recent-card');
    expect(card.textContent).toContain('Sandales');
    card.click();
    expect(openModal).toHaveBeenCalledWith('7', true);
  });

  test('PDC-6 : setupModalContractClasses n\'existe plus et modal-view-model.js n\'est plus une dépendance', () => {
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
  });
});
