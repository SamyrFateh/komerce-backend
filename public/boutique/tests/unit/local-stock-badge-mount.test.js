'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/local-stock-badge-mount.test.js
 *
 * Module js/local-stock-badge-mount.js — Vague 2 D6, point d'intégration
 * DOM réel de la PDP (laissé en suspens au premier lot D6).
 *
 * Couverture :
 *   ✓ s'abonne à modal:detail-ready et modal:closed, jamais un autre événement
 *   ✓ modal:detail-ready + slot présent + produit courant -> appelle renderLocalStockBadge
 *     avec le bon container et le bon productId
 *   ✓ modal:detail-ready sans slot dans le DOM -> no-op, jamais un throw
 *   ✓ modal:detail-ready sans state.modalProduct -> no-op, aucun appel
 *   ✓ modal:closed -> vide le slot (jamais de contenu périmé au prochain open)
 *   ✓ setup() est idempotent — un second appel ne double pas les abonnements
 */

const handlers = {};

jest.mock('../../js/b-bus.js', () => ({
  bus: {
    on: jest.fn((event, fn) => { handlers[event] = fn; }),
  },
}));

const mockState = { modalProduct: null };
jest.mock('../../js/b-store.js', () => ({ state: mockState }));

jest.mock('../../js/local-stock-badge.js', () => ({
  renderLocalStockBadge: jest.fn(),
}));

const { bus } = require('../../js/b-bus.js');
const { renderLocalStockBadge } = require('../../js/local-stock-badge.js');
const {
  setupLocalStockBadgeMount,
  _localStockBadgeMountTestApi,
} = require('../../js/local-stock-badge-mount.js');

const PRODUCT_ID = 'prod-1';

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(handlers)) delete handlers[key];
  document.body.innerHTML = '<div id="k-local-stock-badge-slot"></div>';
  mockState.modalProduct = null;
  _localStockBadgeMountTestApi._resetForTests();
});

describe('setupLocalStockBadgeMount', () => {
  it('s\'abonne à modal:detail-ready et modal:closed, jamais un autre événement', () => {
    setupLocalStockBadgeMount();
    expect(bus.on).toHaveBeenCalledWith('modal:detail-ready', expect.any(Function));
    expect(bus.on).toHaveBeenCalledWith('modal:closed', expect.any(Function));
    expect(bus.on).toHaveBeenCalledTimes(2);
  });

  it('modal:detail-ready + slot présent + produit courant -> appelle renderLocalStockBadge avec le bon container et productId', () => {
    setupLocalStockBadgeMount();
    mockState.modalProduct = { id: PRODUCT_ID };

    handlers['modal:detail-ready']();

    expect(renderLocalStockBadge).toHaveBeenCalledTimes(1);
    const [container, productId] = renderLocalStockBadge.mock.calls[0];
    expect(container).toBe(document.getElementById('k-local-stock-badge-slot'));
    expect(productId).toBe(PRODUCT_ID);
  });

  it('modal:detail-ready sans slot dans le DOM -> no-op, jamais un throw', () => {
    document.body.innerHTML = ''; // slot absent
    setupLocalStockBadgeMount();
    mockState.modalProduct = { id: PRODUCT_ID };

    expect(() => handlers['modal:detail-ready']()).not.toThrow();
    expect(renderLocalStockBadge).not.toHaveBeenCalled();
  });

  it('modal:detail-ready sans state.modalProduct -> no-op, aucun appel', () => {
    setupLocalStockBadgeMount();
    mockState.modalProduct = null;

    handlers['modal:detail-ready']();

    expect(renderLocalStockBadge).not.toHaveBeenCalled();
  });

  it('modal:closed -> vide le slot, jamais de contenu périmé au prochain open', () => {
    setupLocalStockBadgeMount();
    const slot = document.getElementById('k-local-stock-badge-slot');
    slot.innerHTML = '<div class="k-local-stock-badge">ancien contenu</div>';

    handlers['modal:closed']();

    expect(slot.innerHTML).toBe('');
  });

  it('setup() est idempotent — un second appel ne double pas les abonnements', () => {
    setupLocalStockBadgeMount();
    setupLocalStockBadgeMount();
    expect(bus.on).toHaveBeenCalledTimes(2); // toujours 2, pas 4
  });
});
