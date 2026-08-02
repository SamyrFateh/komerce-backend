'use strict';

/** Couverture du partage immédiat et du POST actif de b-share-cart.js. */

const mockShowToast = jest.fn();
const mockClearCart = jest.fn();
const mockRefreshGroupBadge = jest.fn();
const mockRenderGroupView = jest.fn();
const mockSwitchView = jest.fn();
const mockShowBanner = jest.fn();
const mockHideBanner = jest.fn();
const mockRefreshBanner = jest.fn();
const mockRequireIdentity = jest.fn();

jest.mock('../../js/b-cart-core.js', () => ({ showToast: mockShowToast }));
jest.mock('../../js/b-cart.js', () => ({ clearCart: mockClearCart }));
jest.mock('../../js/group/group-state.js', () => ({
  refreshGroupBadge: mockRefreshGroupBadge,
}));
jest.mock('../../js/group/group-render-list.js', () => ({
  renderGroupView: mockRenderGroupView,
}));
jest.mock('../../js/b-nav.js', () => ({ switchView: mockSwitchView }));
jest.mock('../../js/b-group-banner.js', () => ({
  showBanner: mockShowBanner,
  hideBanner: mockHideBanner,
  refreshBanner: mockRefreshBanner,
}));
jest.mock('../../js/b-identity.js', () => ({ requireIdentity: mockRequireIdentity }));

const { state } = require('../../js/b-store.js');
const {
  startShareFlow,
  clearShareState,
} = require('../../js/b-share-cart.js');

function cartItem(id, qty = 1) {
  return { product: { id, name: `Produit ${id}` }, qty };
}

async function settle() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function setNavigatorShare(value) {
  Object.defineProperty(navigator, 'share', {
    value,
    configurable: true,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = `
    <button id="k-cart-share">📤 Partager cette liste</button>
    <button class="k-bnav-item" data-tab="group"></button>
    <button class="k-header-nav-btn" data-tab="group"></button>
  `;
  sessionStorage.clear();

  state.cart = [cartItem('p-1', 2), cartItem('p-2', 1)];
  state.shareToken = null;
  state.shareId = null;
  state.shareExpiry = null;
  state.cartName = '';
  state.shareStatus = null;
  state.shareTotalKmf = 0;
  state.shareContributedKmf = 0;
  state.shareRemainingKmf = 0;
  state.shareUrl = null;

  mockRequireIdentity.mockResolvedValue({ id: 'user-1' });
  global.fetch = jest.fn();
  window.open = jest.fn();

  setNavigatorShare(jest.fn().mockResolvedValue());
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: jest.fn().mockResolvedValue() },
    configurable: true,
  });
});

test('crée immédiatement une liste, diffuse son lien et ouvre sa vue', async () => {
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      shared_cart_id: 'sc-101',
      token: 'tok-101',
      share_url: 'https://komerce.test/boutique/?p=tok-101',
      status: 'open',
      items_count: 2,
      clear_local_cart: true,
    }),
  });

  await startShareFlow();
  await settle();

  expect(document.querySelector('.k-share-modal-overlay')).toBeNull();
  expect(mockRequireIdentity).toHaveBeenCalledWith({
    reason: 'partager cette liste',
    title: 'Sécuriser votre liste',
  });

  expect(global.fetch).toHaveBeenCalledWith(
    '/api/shared-carts/from-cart-items',
    expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }),
  );
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
    cart_items: [
      { product_id: 'p-1', quantity: 2 },
      { product_id: 'p-2', quantity: 1 },
    ],
  });

  expect(state).toMatchObject({
    shareToken: 'tok-101',
    shareId: 'sc-101',
    cartName: 'Liste partagée',
    shareStatus: 'open',
    shareUrl: 'https://komerce.test/boutique/?p=tok-101',
  });
  expect(JSON.parse(sessionStorage.getItem('kmrc_share')).token).toBe('tok-101');

  expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({
    title: 'Sélection Komerce',
    url: 'https://komerce.test/boutique/?p=tok-101',
  }));
  expect(mockClearCart).toHaveBeenCalledTimes(1);
  expect(mockShowToast).toHaveBeenCalledWith(
    'Liste créée. Le lien est prêt à être partagé.',
    'success',
  );
  expect(mockShowBanner).toHaveBeenCalledWith({
    title: 'Liste partagée',
    status: 'open',
  });
  expect(mockSwitchView).toHaveBeenCalledWith('group');
  expect(mockRenderGroupView).toHaveBeenCalled();
  expect(document.getElementById('k-cart-share')).toMatchObject({
    disabled: false,
    textContent: '📤 Partager cette liste',
  });
});

test('une identité annulée interrompt le flux sans créer de formulaire ni de liste', async () => {
  mockRequireIdentity.mockResolvedValue(null);

  await startShareFlow();

  expect(document.querySelector('.k-share-modal-overlay')).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(navigator.share).not.toHaveBeenCalled();
  expect(mockClearCart).not.toHaveBeenCalled();
});

test('une erreur API remonte le message et réactive le bouton', async () => {
  global.fetch.mockResolvedValue({
    ok: false,
    status: 409,
    json: async () => ({ error: 'Limite de listes actives atteinte' }),
  });

  await startShareFlow();

  expect(mockShowToast).toHaveBeenCalledWith(
    'Erreur : Limite de listes actives atteinte',
    'error',
  );
  expect(mockClearCart).not.toHaveBeenCalled();
  expect(document.getElementById('k-cart-share')).toMatchObject({
    disabled: false,
    textContent: '📤 Partager cette liste',
  });
});

test('un clic normal crée une nouvelle liste même si une autre liste est active', async () => {
  state.shareToken = 'tok-old';
  state.cartName = 'Ancienne liste';
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      shared_cart_id: 'sc-new',
      token: 'tok-new',
      share_url: 'https://komerce.test/boutique/?p=tok-new',
      status: 'open',
      clear_local_cart: true,
    }),
  });

  await startShareFlow();

  expect(document.querySelector('.k-share-modal-overlay')).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(state.shareToken).toBe('tok-new');
  expect(state.shareId).toBe('sc-new');
});

test('le repartage fonctionne sans panier local et sans nouvelle création', async () => {
  state.cart = [];
  state.shareToken = 'tok-existing';
  state.shareUrl = 'https://komerce.test/boutique/?p=tok-existing';
  state.cartName = 'Repas de dimanche';

  await startShareFlow({ reshare: true });

  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockRequireIdentity).not.toHaveBeenCalled();
  expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({
    text: expect.stringContaining('Repas de dimanche'),
    url: 'https://komerce.test/boutique/?p=tok-existing',
  }));
});

test('sans partage natif, le lien est copié et WhatsApp sert de fallback', async () => {
  setNavigatorShare(undefined);
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      shared_cart_id: 'sc-fallback',
      token: 'tok-fallback',
      share_url: 'https://komerce.test/boutique/?p=tok-fallback',
      status: 'open',
      clear_local_cart: false,
    }),
  });

  await startShareFlow();

  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
    'https://komerce.test/boutique/?p=tok-fallback',
  );
  expect(window.open).toHaveBeenCalledWith(
    expect.stringContaining('https://wa.me/?text='),
    '_blank',
    'noopener',
  );
});

test('clearShareState supprime le cache et les indicateurs', () => {
  state.shareToken = 'tok-clear';
  state.shareId = 'sc-clear';
  sessionStorage.setItem('kmrc_share', '{"token":"tok-clear"}');

  clearShareState();

  expect(state.shareToken).toBeNull();
  expect(state.shareId).toBeNull();
  expect(sessionStorage.getItem('kmrc_share')).toBeNull();
  expect(mockHideBanner).toHaveBeenCalled();
});
