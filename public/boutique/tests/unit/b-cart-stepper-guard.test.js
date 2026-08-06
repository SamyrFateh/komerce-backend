'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { state } = require('../../js/b-store.js');
const {
  guardStepperControlClick,
  installCartStepperGuard,
} = require('../../js/b-cart-stepper-guard.js');

function mountStepper(qty = 2) {
  const host = document.createElement('button');
  host.type = 'button';
  host.className = 'k-card-add in-cart stepper-open';
  host.dataset.add = '42';

  const stepper = document.createElement('div');
  stepper.className = 'k-card-add-stepper';

  const minus = document.createElement('button');
  minus.type = 'button';
  minus.className = 'k-stepper-minus';
  minus.textContent = '−';

  const value = document.createElement('span');
  value.className = 'k-stepper-qty';
  value.textContent = String(qty);

  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'k-stepper-plus';
  plus.textContent = '+';

  // Le runtime b-cart.js construit le stepper via createElement/appendChild.
  // On reproduit ce DOM directement : le parser innerHTML réécrit sinon les
  // boutons imbriqués, ce qui ne correspond pas au chemin applicatif réel.
  stepper.append(minus, value, plus);
  host.appendChild(stepper);
  document.body.appendChild(host);

  state.cart = [{ id: 42, product: { id: 42 }, qty }];
  return host;
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
