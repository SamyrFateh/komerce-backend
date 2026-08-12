/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Régression ciblée : un lien de liste reçu doit rester autosuffisant dans
 * la barre d'adresse afin qu'un WebView puisse le transmettre à un autre
 * navigateur sans dépendre de son sessionStorage.
 */
'use strict';

const mockState = { cart: [], _pendingParticipantToken: null };
const mockDom = {};
const mockDetectParticipantToken = jest.fn();

jest.mock('../../js/b-bus.js', () => ({
  bus: { on: jest.fn(), emit: jest.fn() },
}));
jest.mock('../../js/b-store.js', () => ({
  state: mockState,
  dom: mockDom,
  $: jest.fn(),
  $$: jest.fn(),
}));
jest.mock('../../js/b-utils.js', () => ({ apiGet: jest.fn() }));
jest.mock('../../js/b-cart-core.js', () => ({ showToast: jest.fn() }));
jest.mock('../../js/b-cart.js', () => ({
  openCart: jest.fn(),
  closeCart: jest.fn(),
  renderCart: jest.fn(),
  clearCart: jest.fn(),
  loadSharedCart: jest.fn(),
}));
jest.mock('../../js/b-checkout.js', () => ({
  checkoutCart: jest.fn(),
  closeOrderModal: jest.fn(),
}));
jest.mock('../../js/b-catalog.js', () => ({
  renderGrid: jest.fn(),
  appendNextPage: jest.fn(),
}));
jest.mock('../../js/b-favs.js', () => ({ renderFavView: jest.fn() }));
jest.mock('../../js/b-tracking.js', () => ({
  renderTrackView: jest.fn(),
  renderListsView: jest.fn(),
}));
jest.mock('../../js/b-komerce.js', () => ({ openMonKomerce: jest.fn() }));
jest.mock('../../js/group/group-side-cart.js', () => ({
  detectParticipantToken: mockDetectParticipantToken,
}));
jest.mock('../../js/b-pager.js', () => ({ destroyMobilePager: jest.fn() }));
jest.mock('../../js/b-scroll-owner.js', () => ({ scrollPageToTop: jest.fn() }));

const { handleParticipantUrl } = require('../../js/b-nav.js');

describe('handleParticipantUrl — portabilité du lien partagé', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState._pendingParticipantToken = null;
    window.history.replaceState({}, '', '/boutique/?p=TOK123');
    mockDetectParticipantToken.mockReturnValue('TOK123');
    document.body.innerHTML = '<button class="k-bnav-item active" data-tab="shop"></button>';
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  test('conserve le token dans l’URL visible pour un handoff WebView -> navigateur externe', () => {
    handleParticipantUrl();

    const current = new URL(window.location.href);
    expect(current.pathname).toBe('/boutique/');
    expect(current.searchParams.get('p')).toBe('TOK123');
    expect(mockState._pendingParticipantToken).toBe('TOK123');
  });
});
