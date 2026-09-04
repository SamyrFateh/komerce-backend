'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockOpenModal = jest.fn();
const mockQuickAdd = jest.fn();
const mockQuickRemove = jest.fn();
const mockOpenCartWithHighlight = jest.fn();
const mockMarkAllCartButtons = jest.fn();

jest.mock('../../js/b-modal.js', () => ({
  openModal: (...args) => mockOpenModal(...args),
}));

jest.mock('../../js/b-cart.js', () => ({
  quickAdd: (...args) => mockQuickAdd(...args),
  quickRemove: (...args) => mockQuickRemove(...args),
  openCartWithHighlight: (...args) => mockOpenCartWithHighlight(...args),
  markAllCartButtons: (...args) => mockMarkAllCartButtons(...args),
}));

jest.mock('../../js/b-pager.js', () => ({
  _setupInfiniteLoop: jest.fn(),
}));

jest.mock('../../js/discovery-api.js', () => ({
  fetchDiscoveryRail: jest.fn(),
  fetchServiceCard: jest.fn(),
  fetchPhysicalOfferCard: jest.fn(),
}));

jest.mock('../../js/discovery-desktop-style.js', () => ({
  ensureDiscoveryDesktopV2Stylesheet: jest.fn(),
}));

const { state } = require('../../js/b-store.js');
const {
  handleDiscoveryClick,
  productHasVariants,
} = require('../../js/discovery-rail.js');

function makeClick(target) {
  return {
    target,
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
  };
}

function mountProductControl({ id = 'p-1', action = 'add', mobile = false } = {}) {
  const cardClass = mobile ? 'k-discovery-card' : 'k-card k-discovery-canonical-card';
  const infoClass = mobile ? 'k-discovery-info' : 'k-card-info';
  document.body.innerHTML = `
    <article class="${cardClass}" data-discovery-kind="product" data-discovery-ref="${id}">
      <div class="${infoClass}">
        <div class="k-card-add" data-add="${id}">
          <button class="k-card-add-trigger" data-action="${action}" type="button">+</button>
        </div>
      </div>
    </article>`;
  return document.querySelector('[data-action]');
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
  state.products = [];
});

test('le + d’un Product local desktop ajoute au panier sans ouvrir la fiche', () => {
  state.products = [{ id: 'p-1', name: 'Savon', has_variants: false }];
  const button = mountProductControl();
  const event = makeClick(button);

  handleDiscoveryClick(event);

  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  expect(mockQuickAdd).toHaveBeenCalledWith('p-1', button, { hasVariants: false });
  expect(mockOpenModal).not.toHaveBeenCalled();
});

test('le + d’un Product local mobile suit exactement le même chemin quickAdd', () => {
  state.products = [{ id: 'p-1', name: 'Savon', has_variants: false }];
  const button = mountProductControl({ mobile: true });
  const event = makeClick(button);

  handleDiscoveryClick(event);

  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  expect(mockQuickAdd).toHaveBeenCalledWith('p-1', button, { hasVariants: false });
  expect(mockOpenModal).not.toHaveBeenCalled();
});

test('un Product à variantes conserve le garde-fou canonique quickAdd', () => {
  state.products = [{ id: 'p-1', name: 'Veste', has_variants: true }];
  const button = mountProductControl();

  handleDiscoveryClick(makeClick(button));

  expect(mockQuickAdd).toHaveBeenCalledWith('p-1', button, { hasVariants: true });
  expect(mockOpenModal).not.toHaveBeenCalled();
});

test('le stepper et le review restent délégués aux propriétaires panier sur desktop et mobile', () => {
  const decrement = mountProductControl({ action: 'decrement' });
  handleDiscoveryClick(makeClick(decrement));
  expect(mockQuickRemove).toHaveBeenCalledWith('p-1', decrement);

  const mobileDecrement = mountProductControl({ action: 'decrement', mobile: true });
  handleDiscoveryClick(makeClick(mobileDecrement));
  expect(mockQuickRemove).toHaveBeenCalledWith('p-1', mobileDecrement);

  const review = mountProductControl({ action: 'review' });
  handleDiscoveryClick(makeClick(review));
  expect(mockOpenCartWithHighlight).toHaveBeenCalledWith('p-1');

  const mobileReview = mountProductControl({ action: 'review', mobile: true });
  handleDiscoveryClick(makeClick(mobileReview));
  expect(mockOpenCartWithHighlight).toHaveBeenCalledWith('p-1');
});

test('le clic hors contrôle panier ouvre toujours la fiche Product', () => {
  document.body.innerHTML = `
    <article class="k-card k-discovery-canonical-card" data-discovery-kind="product" data-discovery-ref="p-1">
      <div class="k-card-name">Savon</div>
    </article>`;
  const title = document.querySelector('.k-card-name');

  handleDiscoveryClick(makeClick(title));

  expect(mockOpenModal).toHaveBeenCalledWith('p-1');
  expect(mockQuickAdd).not.toHaveBeenCalled();
});

test('inventory_model SKU est traité comme produit à variantes', () => {
  expect(productHasVariants({ inventory_model: 'SKU' })).toBe(true);
  expect(productHasVariants({ hasVariants: true })).toBe(true);
  expect(productHasVariants({ has_variants: true })).toBe(true);
  expect(productHasVariants({ inventory_model: 'LEGACY_VARIANTS', has_variants: false })).toBe(false);
});
