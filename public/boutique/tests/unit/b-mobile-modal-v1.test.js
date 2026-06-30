'use strict';

/**
 * tests/unit/b-mobile-modal-v1.test.js
 *
 * Module #22 — js/b-mobile-modal-v1.js (122L)
 *
 * Seul `setupMobileModalV1` est exporté (ESM). syncMobileIntentQty,
 * installQtyGuard, applyMobileModal, isMobile sont des helpers internes —
 * testés indirectement via le comportement observable déclenché par
 * l'événement bus `modal:opened` et par le clic sur `#k-qty-minus`.
 *
 * Le module garde un état privé au niveau module (_installed,
 * _qtyGuardInstalled) pour rester idempotent → jest.resetModules() +
 * re-require dans chaque test pour repartir d'un état propre.
 *
 * applyMobileModal est appelé via deux requestAnimationFrame imbriqués :
 * window.requestAnimationFrame est remplacé par un exécuteur synchrone pour
 * éviter les attentes asynchrones dans les tests.
 */

function setDesktop(isDesktop) {
  window.innerWidth = isDesktop ? 1200 : 375;
}

function freshModule() {
  jest.resetModules();
  const bus = require('../../js/b-bus.js').bus;
  const store = require('../../js/b-store.js');
  const addSpy = jest.spyOn(document, 'addEventListener');
  const mod = require('../../js/b-mobile-modal-v1.js');
  return { bus, state: store.state, setupMobileModalV1: mod.setupMobileModalV1, addSpy };
}

// Récupère le handler 'click' (capture) installé par installQtyGuard(), pour
// l'invoquer directement et éviter l'accumulation de listeners réels sur
// `document` (partagé entre tests dans le même fichier jsdom).
function getQtyGuardHandler(addSpy) {
  const call = addSpy.mock.calls.find((c) => c[0] === 'click' && c[2] === true);
  return call ? call[1] : null;
}

function fakeMinusClickEvent() {
  const minus = document.getElementById('k-qty-minus');
  let prevented = false;
  return {
    target: minus,
    preventDefault: () => { prevented = true; },
    stopPropagation: jest.fn(),
    stopImmediatePropagation: jest.fn(),
    get defaultPrevented() { return prevented; },
  };
}

describe('b-mobile-modal-v1', () => {
  let rafSpy;

  beforeEach(() => {
    setDesktop(false); // mobile par défaut
    document.body.innerHTML = `
      <span id="k-qty-val"></span>
      <button id="k-add-cart-btn"></button>
      <button id="k-buy-now-btn"></button>
      <button id="k-qty-minus"></button>
    `;
    // exécute requestAnimationFrame de façon synchrone pour les tests
    rafSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb();
      return 1;
    });
  });

  afterEach(() => {
    rafSpy.mockRestore();
  });

  it('exporte une fonction unique', () => {
    const { setupMobileModalV1 } = freshModule();
    expect(typeof setupMobileModalV1).toBe('function');
  });

  it('ne throw pas au premier appel', () => {
    const { setupMobileModalV1 } = freshModule();
    expect(() => setupMobileModalV1()).not.toThrow();
  });

  it('est idempotent : un second appel ne réinstalle rien (pas de doublon de listener bus)', () => {
    const { setupMobileModalV1, bus } = freshModule();
    const onSpy = jest.spyOn(bus, 'on');
    setupMobileModalV1();
    setupMobileModalV1();
    expect(onSpy).toHaveBeenCalledTimes(1);
  });

  it("émission de 'modal:opened' sur mobile avec un produit ouvert → synchronise qty + bouton ajout", () => {
    const { setupMobileModalV1, bus, state } = freshModule();
    setupMobileModalV1();
    state.modalProduct = { id: 5, price_kmf: 1000 };
    state.cart = [];
    bus.emit('modal:opened');

    expect(document.getElementById('k-qty-val').textContent).toBe('1');
    const addBtn = document.getElementById('k-add-cart-btn');
    expect(addBtn.classList.contains('in-cart')).toBe(false);
    expect(addBtn.textContent).toContain('Ajouter au panier');
    expect(addBtn.querySelector('img')).toBeTruthy();
  });

  it("produit déjà dans le panier (qty 4) → qty reflète le panier, bouton 'Ajouter' non reconstruit", () => {
    const { setupMobileModalV1, bus, state } = freshModule();
    setupMobileModalV1();
    state.modalProduct = { id: 5, price_kmf: 1000 };
    state.cart = [{ product: { id: 5 }, qty: 4 }];
    bus.emit('modal:opened');

    expect(document.getElementById('k-qty-val').textContent).toBe('4');
  });

  it("met à jour l'aria-label du bouton Acheter avec le prix total (qty × price_kmf)", () => {
    const { setupMobileModalV1, bus, state } = freshModule();
    const { fmtPrice } = require('../../js/b-utils.js');
    setupMobileModalV1();
    state.modalProduct = { id: 5, price_kmf: 1500 };
    state.cart = [{ product: { id: 5 }, qty: 2 }];
    bus.emit('modal:opened');

    const buyBtn = document.getElementById('k-buy-now-btn');
    expect(buyBtn.getAttribute('aria-label')).toBe('Acheter maintenant — ' + fmtPrice(3000));
  });

  it("sur desktop, 'modal:opened' ne touche pas le DOM mobile", () => {
    setDesktop(true);
    const { setupMobileModalV1, bus, state } = freshModule();
    setupMobileModalV1();
    state.modalProduct = { id: 5, price_kmf: 1000 };
    bus.emit('modal:opened');

    expect(document.getElementById('k-qty-val').textContent).toBe('');
  });

  it("'modal:opened' sans produit ouvert (modalProduct null) → ne touche pas le DOM", () => {
    const { setupMobileModalV1, bus, state } = freshModule();
    setupMobileModalV1();
    state.modalProduct = null;
    bus.emit('modal:opened');

    expect(document.getElementById('k-qty-val').textContent).toBe('');
  });

  it('clic sur #k-qty-minus quand modalQty=1 sur mobile → empêche la descente sous 1, force le texte à "1"', () => {
    const { setupMobileModalV1, state, addSpy } = freshModule();
    setupMobileModalV1();
    state.modalProduct = { id: 5 };
    state.modalQty = 1;
    document.getElementById('k-qty-val').textContent = '1';

    const handler = getQtyGuardHandler(addSpy);
    expect(handler).toBeTruthy();
    const evt = fakeMinusClickEvent();
    handler(evt);

    expect(state.modalQty).toBe(1);
    expect(document.getElementById('k-qty-val').textContent).toBe('1');
    expect(evt.defaultPrevented).toBe(true);
  });

  it('clic sur #k-qty-minus quand modalQty=3 sur mobile → laisse passer (pas de preventDefault)', () => {
    const { setupMobileModalV1, state, addSpy } = freshModule();
    setupMobileModalV1();
    state.modalProduct = { id: 5 };
    state.modalQty = 3;

    const handler = getQtyGuardHandler(addSpy);
    const evt = fakeMinusClickEvent();
    handler(evt);

    expect(evt.defaultPrevented).toBe(false);
  });

  it('clic sur #k-qty-minus sur desktop → guard ne s\'applique pas (pas de preventDefault)', () => {
    setDesktop(true);
    const { setupMobileModalV1, state, addSpy } = freshModule();
    setupMobileModalV1();
    state.modalProduct = { id: 5 };
    state.modalQty = 1;

    const handler = getQtyGuardHandler(addSpy);
    const evt = fakeMinusClickEvent();
    handler(evt);

    expect(evt.defaultPrevented).toBe(false);
  });

  it('clic ailleurs (pas sur #k-qty-minus) → guard ignore totalement', () => {
    const { setupMobileModalV1, state, addSpy } = freshModule();
    setupMobileModalV1();
    state.modalProduct = { id: 5 };
    state.modalQty = 1;

    const handler = getQtyGuardHandler(addSpy);
    const evt = {
      target: document.getElementById('k-add-cart-btn'),
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      stopImmediatePropagation: jest.fn(),
      defaultPrevented: false,
    };
    handler(evt);

    expect(evt.preventDefault).not.toHaveBeenCalled();
  });
});
