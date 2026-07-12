'use strict';

jest.mock('../../js/b-modal.js', () => ({ closeModal: jest.fn() }));
jest.mock('../../js/b-cart.js', () => ({ addToCart: jest.fn() }));
jest.mock('../../js/b-share-cart.js', () => ({ startShareFlow: jest.fn() }));
jest.mock('../../js/b-scroll-owner.js', () => ({ isDesktop: jest.fn(() => true) }));

const { bus } = require('../../js/b-bus.js');
const { state, dom } = require('../../js/b-store.js');
const { closeModal } = require('../../js/b-modal.js');
const { addToCart } = require('../../js/b-cart.js');
const { startShareFlow } = require('../../js/b-share-cart.js');
const { isDesktop } = require('../../js/b-scroll-owner.js');
const { setupApprocheCHybridPdp } = require('../../js/b-modal-approche-c-hybrid.js');

document.body.innerHTML = `
  <div id="k-modal">
    <div class="k-modal-info">
      <div id="k-modal-delivery">contract delivery</div>
      <div class="k-modal-actions">
        <button id="k-qty-minus">-</button>
        <span id="k-qty-val">1</span>
        <button id="k-qty-plus">+</button>
      </div>
    </div>
    <div class="k-modal-subtotal">contract subtotal</div>
    <div id="k-modal-payment"></div>
  </div>`;

dom.modal = document.getElementById('k-modal');
const info = dom.modal.querySelector('.k-modal-info');
const delivery = document.getElementById('k-modal-delivery');
const actions = dom.modal.querySelector('.k-modal-actions');
const originalActionsNext = actions.nextSibling;

function resetDom() {
  info.insertBefore(actions, originalActionsNext);
  actions.classList.remove('k-buybox-actions-inline');
  delivery.textContent = 'contract delivery';
  document.getElementById('k-qty-val').textContent = '1';
  dom.modal.querySelector('.k-modal-subtotal').textContent = 'contract subtotal';
  document.getElementById('k-modal-payment').innerHTML = '';
}

function flushRaf() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

describe('b-modal-approche-c-hybrid — composition only', () => {
  beforeAll(() => {
    setupApprocheCHybridPdp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetDom();
    isDesktop.mockReturnValue(true);
    state.modalProduct = { id: 1, price_kmf: 5000 };
    state.modalQty = 1;
    state.modalPaymentMode = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('mobile : modal:opened ne compose ni actions ni paiement', async () => {
    isDesktop.mockReturnValue(false);
    bus.emit('modal:opened');
    await flushRaf();

    expect(actions.classList.contains('k-buybox-actions-inline')).toBe(false);
    expect(document.getElementById('k-modal-payment').innerHTML).toBe('');
    expect(delivery.textContent).toBe('contract delivery');
  });

  test('desktop : ne touche plus livraison ni sous-total du Product Detail renderer', async () => {
    bus.emit('modal:opened');
    await flushRaf();

    expect(delivery.textContent).toBe('contract delivery');
    expect(dom.modal.querySelector('.k-modal-subtotal').textContent).toBe('contract subtotal');
    expect(document.querySelectorAll('.k-buybox-payment-tab')).toHaveLength(4);
  });

  test('quantité invalide : garde d’intention force uniquement 1', async () => {
    state.modalQty = 0;
    document.getElementById('k-qty-val').textContent = '0';
    bus.emit('modal:opened');
    await flushRaf();

    expect(state.modalQty).toBe(1);
    expect(document.getElementById('k-qty-val').textContent).toBe('1');
    expect(dom.modal.querySelector('.k-modal-subtotal').textContent).toBe('contract subtotal');
  });

  test('sans produit ouvert la garde quantité ne fabrique aucun état', async () => {
    state.modalProduct = null;
    state.modalQty = 0;
    bus.emit('modal:opened');
    await flushRaf();
    expect(state.modalQty).toBe(0);
  });

  test('clic moins à quantité 1 reste bloqué en desktop', async () => {
    bus.emit('modal:opened');
    await flushRaf();
    state.modalQty = 1;

    document.getElementById('k-qty-minus').dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );

    expect(state.modalQty).toBe(1);
    expect(document.getElementById('k-qty-val').textContent).toBe('1');
  });

  test('actions : déplacement après livraison puis restauration au modal:closed', async () => {
    bus.emit('modal:opened');
    await flushRaf();

    expect(delivery.nextElementSibling).toBe(actions);
    expect(actions.classList.contains('k-buybox-actions-inline')).toBe(true);

    bus.emit('modal:closed');
    expect(actions.classList.contains('k-buybox-actions-inline')).toBe(false);
    expect(actions.parentElement).toBe(info);
    expect(actions.nextSibling).toBe(originalActionsNext);
  });

  test('actions : fermeture puis réouverture recapture un home DOM frais', async () => {
    bus.emit('modal:opened');
    await flushRaf();
    bus.emit('modal:closed');

    const marker = document.createElement('div');
    marker.dataset.actionsHomeMarker = '1';
    info.insertBefore(marker, actions);

    bus.emit('modal:opened');
    await flushRaf();
    bus.emit('modal:closed');

    expect(marker.nextElementSibling).toBe(actions);
    marker.remove();
  });

  test('paiement : quatre onglets avec Carte actif par défaut', async () => {
    bus.emit('modal:opened');
    await flushRaf();

    expect(document.querySelectorAll('.k-buybox-payment-tab')).toHaveLength(4);
    expect(document.querySelector('.k-buybox-payment-tab.is-active').dataset.pay).toBe('stripe');
    expect(document.querySelector('.k-buybox-payment-detail').dataset.payDetail).toBe('stripe');
  });

  test('paiement : respecte et change le mode UI sans toucher au produit', async () => {
    state.modalPaymentMode = 'cash';
    bus.emit('modal:opened');
    await flushRaf();
    expect(document.querySelector('.k-buybox-payment-tab.is-active').dataset.pay).toBe('cash');

    const pot = document.querySelector('[data-pay="pot"]');
    pot.click();
    expect(state.modalPaymentMode).toBe('pot');
    expect(document.querySelector('.k-buybox-payment-detail').dataset.payDetail).toBe('pot');
    expect(document.querySelector('.k-buybox-payment-badge').textContent).toBe('Collectif');
  });

  test('onglet Partagé conserve le parcours add → close → share', async () => {
    bus.emit('modal:opened');
    await flushRaf();

    const group = document.querySelector('[data-pay="group"]');
    expect(group).not.toBeNull();

    jest.useFakeTimers();
    group.click();

    expect(addToCart).toHaveBeenCalledWith(state.modalProduct, 1, group);
    expect(closeModal).toHaveBeenCalled();
    jest.advanceTimersByTime(250);
    expect(startShareFlow).toHaveBeenCalled();
  });
});
