'use strict';

const { state } = require('../../js/b-store.js');
const {
  guardStepperControlClick,
  installCartStepperGuard,
} = require('../../js/b-cart-stepper-guard.js');

function mountStepper(qty = 2) {
  document.body.innerHTML = `
    <button class="k-card-add in-cart stepper-open" data-add="42">
      <div class="k-card-add-stepper">
        <button class="k-stepper-minus" type="button">−</button>
        <span class="k-stepper-qty">${qty}</span>
        <button class="k-stepper-plus" type="button">+</button>
      </div>
    </button>`;
  state.cart = [{ id: 42, product: { id: 42 }, qty }];
  return document.querySelector('.k-card-add');
}

describe('b-cart-stepper-guard', () => {
  let blockingCapture;

  beforeEach(() => {
    document.body.innerHTML = '';
    state.cart = [];

    // Reproduit précisément le listener document en capture de b-cart.js.
    blockingCapture = jest.fn(event => {
      const button = event.target.closest('.k-card-add');
      if (button?.classList.contains('stepper-open')) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
    document.addEventListener('click', blockingCapture, true);
  });

  afterEach(() => {
    document.removeEventListener('click', blockingCapture, true);
  });

  it('laisse le clic + atteindre son handler puis restaure le marqueur stepper-open', async () => {
    const host = mountStepper(2);
    const plus = host.querySelector('.k-stepper-plus');
    const targetHandler = jest.fn(() => {
      state.cart[0].qty += 1;
      host.querySelector('.k-stepper-qty').textContent = String(state.cart[0].qty);
    });
    plus.addEventListener('click', targetHandler);

    plus.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(targetHandler).toHaveBeenCalledTimes(1);
    expect(blockingCapture).toHaveBeenCalledTimes(1);
    expect(state.cart[0].qty).toBe(3);
    expect(host.classList.contains('stepper-open')).toBe(true);
  });

  it('laisse le clic − retirer le dernier article sans rouvrir le stepper', async () => {
    const host = mountStepper(1);
    const minus = host.querySelector('.k-stepper-minus');
    const targetHandler = jest.fn(() => {
      state.cart = [];
      host.querySelector('.k-card-add-stepper').remove();
    });
    minus.addEventListener('click', targetHandler);

    minus.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(targetHandler).toHaveBeenCalledTimes(1);
    expect(host.classList.contains('stepper-open')).toBe(false);
    expect(host.querySelector('.k-card-add-stepper')).toBeNull();
  });

  it('ignore les clics étrangers et les steppers non ouverts', () => {
    document.body.innerHTML = `
      <button id="outside">Ailleurs</button>
      <button class="k-card-add" data-add="42">
        <span class="k-stepper-plus">+</span>
      </button>`;

    expect(() => guardStepperControlClick({ target: null })).not.toThrow();
    document.getElementById('outside').click();
    document.querySelector('.k-stepper-plus').click();

    expect(document.querySelector('.k-card-add').classList.contains('stepper-open')).toBe(false);
  });

  it('l’installation est idempotente', () => {
    const spy = jest.spyOn(window, 'addEventListener');
    installCartStepperGuard();
    installCartStepperGuard();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
