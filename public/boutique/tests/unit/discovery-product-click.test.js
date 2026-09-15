'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Contrat : une carte Product du rail Discovery doit ouvrir la PDC canonique
 * même lorsque le produit n'est pas dans le snapshot state.products. Le + ne
 * doit jamais deviner l'absence de variantes dans ce cas.
 */

const mockOpenModal = jest.fn();
const mockQuickAdd = jest.fn();
const mockQuickRemove = jest.fn();
const mockOpenCartWithHighlight = jest.fn();
const mockMarkAllCartButtons = jest.fn();
const mockSetupInfiniteLoop = jest.fn();
const mockEnsureDesktopStylesheet = jest.fn();

const mockCards = [
  {
    kind: 'product',
    title: 'Climatiseur rail',
    subtitle: 'Disponible maintenant',
    cta_action_ref: 'p-rail',
    cta_label: 'Acheter',
    image_ref: '/images/p-rail.webp',
    price: 195000,
    category_keys: ['Tech'],
  },
  {
    kind: 'product',
    title: 'Produit variantes connu',
    subtitle: 'Disponible maintenant',
    cta_action_ref: 'p-known',
    cta_label: 'Acheter',
    image_ref: '/images/p-known.webp',
    price: 99000,
    category_keys: ['Tech'],
  },
];

const mockFetchDiscoveryRail = jest.fn(async () => ({ cards: mockCards }));

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
  _setupInfiniteLoop: (...args) => mockSetupInfiniteLoop(...args),
}));

jest.mock('../../js/discovery-desktop-style.js', () => ({
  ensureDiscoveryDesktopV2Stylesheet: (...args) => mockEnsureDesktopStylesheet(...args),
}));

jest.mock('../../js/discovery-api.js', () => ({
  fetchDiscoveryRail: (...args) => mockFetchDiscoveryRail(...args),
  fetchServiceCard: jest.fn(),
  fetchPhysicalOfferCard: jest.fn(),
}));

const { bus } = require('../../js/b-bus.js');
const { state } = require('../../js/b-store.js');
const { setupDiscoveryRail } = require('../../js/discovery-rail.js');

function setViewport(width) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

test('Product Discovery : clic desktop/mobile, clavier et + restent canoniques/fail-safe', async () => {
  setViewport(1280);
  state.activeCat = 'all';
  state.products = [
    {
      id: 'p-known',
      name: 'Produit variantes connu',
      image_url: '/images/p-known.webp',
      price_kmf: 99000,
      category: 'Tech',
      has_variants: true,
      inventory_model: 'SKU',
    },
  ];

  document.body.innerHTML = `
    <div class="k-chip active" data-cat="all"></div>
    <div id="k-desktop-catalog-wrap">
      <section id="k-catalog-section">
        <div id="k-grid" class="k-grid-cat-pager">
          <div class="k-cat-section" data-cat="all">
            <div class="k-sec-grid"></div>
          </div>
        </div>
      </section>
    </div>`;

  setupDiscoveryRail();
  await flush();

  const desktopShell = document.getElementById('k-discovery-local');
  expect(desktopShell).not.toBeNull();

  const railCard = desktopShell.querySelector('[data-discovery-ref="p-rail"]');
  expect(railCard).not.toBeNull();
  expect(railCard.tabIndex).toBe(0);
  expect(railCard.getAttribute('aria-label')).toBe('Voir Climatiseur rail');
  expect(state.products.some(product => product.id === 'p-rail')).toBe(false);

  railCard.querySelector('.k-card-name').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(mockOpenModal).toHaveBeenCalledWith('p-rail');
  expect(state.products.find(product => product.id === 'p-rail')).toMatchObject({
    id: 'p-rail',
    name: 'Climatiseur rail',
    image_url: '/images/p-rail.webp',
    price_kmf: 195000,
    category: 'Tech',
    __discovery_ephemeral: true,
  });

  mockOpenModal.mockClear();
  railCard.querySelector('.k-card-add-trigger').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(mockQuickAdd).not.toHaveBeenCalled();
  expect(mockOpenModal).toHaveBeenCalledWith('p-rail');

  mockOpenModal.mockClear();
  const knownCard = desktopShell.querySelector('[data-discovery-ref="p-known"]');
  const knownAdd = knownCard.querySelector('.k-card-add-trigger');
  knownAdd.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(mockQuickAdd).toHaveBeenCalledWith('p-known', knownAdd, { hasVariants: true });
  expect(mockOpenModal).not.toHaveBeenCalled();

  railCard.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(mockOpenModal).toHaveBeenCalledWith('p-rail');

  mockOpenModal.mockClear();
  setViewport(390);
  window.dispatchEvent(new Event('resize'));
  await flush();

  const mobileShell = document.querySelector(
    '#k-grid > .k-cat-section[data-cat="all"] > .k-discovery-shell'
  );
  expect(mobileShell).not.toBeNull();
  const mobileCard = mobileShell.querySelector('[data-discovery-ref="p-rail"]');
  mobileCard.querySelector('.k-card-img-wrap').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(mockOpenModal).toHaveBeenCalledWith('p-rail');

  bus.emit('modal:closed');
  expect(state.products.some(product => product.id === 'p-rail')).toBe(false);
  expect(state.products.some(product => product.id === 'p-known')).toBe(true);
});
