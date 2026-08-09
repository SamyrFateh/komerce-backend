'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/** Couverture du partage immédiat et du POST actif de b-share-cart.js. */

const mockShowToast = jest.fn();
const mockClearCart = jest.fn();
const mockRefreshGroupBadge = jest.fn();
const mockActivateSharedListContext = jest.fn();
const mockGetSharedCartPublic = jest.fn();
const mockShowBanner = jest.fn();
const mockHideBanner = jest.fn();
const mockRefreshBanner = jest.fn();
const mockRequireIdentity = jest.fn();

jest.mock('../../js/b-cart-core.js', () => ({ showToast: mockShowToast }));
jest.mock('../../js/b-cart.js', () => ({ clearCart: mockClearCart }));
jest.mock('../../js/group/group-state.js', () => ({
  refreshGroupBadge: mockRefreshGroupBadge,
}));
// PROMPT_FINAL_IMPLEMENTATION_LISTE_PARTAGEABLE_SIDE_CART — après création,
// b-share-cart.js n'appelle plus switchView('group')/renderGroupView() ; il
// active la liste dans le side cart / drawer canonique via un import()
// dynamique de group-side-cart.js + group-api.js (mandat §2/§4).
jest.mock('../../js/group/group-side-cart.js', () => ({
  activateSharedListContext: mockActivateSharedListContext,
  // L7 (mandat §11) — primitive de confirmation chargée dynamiquement par
  // b-share-cart.js (publication / conflit OPEN). Auto-résolution à true,
  // équivalent du window.confirm(true) qu'elle remplace, pour ne pas changer
  // le comportement attendu par les tests existants de ce fichier.
  showKomerceConfirm: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../js/group/group-api.js', () => ({
  fetchWithTimeout: jest.requireActual('../../js/group/group-api.js').fetchWithTimeout,
  getSharedCartPublic: mockGetSharedCartPublic,
}));
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
    <button class="k-bnav-item" data-tab="komerce"></button>
    <button class="k-header-nav-btn" data-tab="komerce"></button>
  `;
  sessionStorage.clear();

  state.cart = [cartItem('p-1', 2), cartItem('p-2', 1)];
  state.shareToken = null;
  state.shareId = null;
  state.shareExpiry = null;
  state.cartName = '';
  state.shareStatus = null;
  state.shareUrl = null;
  // Isolation — sharedListContext est la source de vérité prioritaire de
  // activeShareTarget() : un test qui le pose (ex. « ouverture de B via
  // Mes listes ») ne doit jamais fuiter dans les tests suivants.
  state.sharedListContext = {
    sharedCartId: null,
    token: null,
    status: 'open',
    isCreator: false,
    creatorFirstName: null,
    contributors: [],
    title: null,
    message: null,
    items: [],
  };

  mockRequireIdentity.mockResolvedValue({ id: 'user-1' });
  mockGetSharedCartPublic.mockResolvedValue({
    cart: { id: 'sc-101', token: 'tok-101', status: 'open' },
    items: [],
    is_creator: true,
  });
  global.fetch = jest.fn();
  window.open = jest.fn();
  // L7 — showKomerceConfirm (modale native) est mocké dans group-side-cart.js
  // ci-dessus. window.confirm n'est plus utilisé pour les flux création/conflit.
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
    reason: 'créer cette liste',
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
      { product_id: 'p-1', quantity: 2, variant_combo: null },
      { product_id: 'p-2', quantity: 1, variant_combo: null },
    ],
  });

  expect(state).toMatchObject({
    shareToken: 'tok-101',
    shareId: 'sc-101',
    cartName: 'Ma liste',
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
    title: 'Ma liste',
    status: 'open',
  });
  expect(mockGetSharedCartPublic).toHaveBeenCalledWith('tok-101');
  expect(mockActivateSharedListContext).toHaveBeenCalledWith(
    expect.objectContaining({ cart: expect.objectContaining({ token: 'tok-101' }) }),
    'tok-101',
    { silent: false },
  );
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

test('P0-B — un clic normal repartage le lien existant au lieu de recréer une liste tant qu\'une liste est active', async () => {
  // Doctrine finale (§4/§9) : « Partager » repartage la liste active, il
  // ne recrée JAMAIS silencieusement. É2 (2026-08) : activeShareTarget()
  // lit uniquement sharedListContext — c'est lui qu'on pose ici.
  state.sharedListContext = {
    sharedCartId: 'sc-old',
    token: 'tok-old',
    status: 'open',
    isCreator: true,
    creatorFirstName: null,
    contributors: [],
    title: 'Ancienne liste',
    message: null,
    items: [],
  };
  // L2 (mandat §4) — le bouton "Partager" testé ici ne rend que sur la
  // surface shared-list ; sans elle startShareFlow() considère qu'on clique
  // depuis Mon panier et tente TOUJOURS de créer MA liste (doctrine P0-2).
  state.cartSurface = 'shared-list';

  await startShareFlow();

  expect(global.fetch).not.toHaveBeenCalled();
  expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({
    text: expect.stringContaining('sélection Komerce'),
    url: expect.stringContaining('tok-old'),
  }));
  // sharedListContext est la source — le token y reste inchangé.
  expect(state.sharedListContext.token).toBe('tok-old');
});

test('P0-B — une liste FERMÉE n\'empêche pas un clic normal de créer une nouvelle liste', async () => {
  // Une liste CLOSED n'est plus « active » (doctrine §9) : un token/session
  // résiduel pointant vers une liste fermée ne doit pas bloquer la création
  // d'une nouvelle liste ni la faire passer pour un repartage.
  state.shareToken = 'tok-old-closed';
  state.shareStatus = 'closed';
  state.cartName = 'Liste fermée';
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

  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(state.shareToken).toBe('tok-new');
});

test('P0-D — transmet variant_combo au payload de création, sans le perdre', async () => {
  state.cart = [
    { product: { id: 'p-3', name: 'Chemise' }, qty: 2, variant_combo: { couleur: 'Noir', taille: 'M' } },
  ];
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      shared_cart_id: 'sc-sku',
      token: 'tok-sku',
      share_url: 'https://komerce.test/boutique/?p=tok-sku',
      status: 'open',
      clear_local_cart: true,
    }),
  });

  await startShareFlow();

  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
    cart_items: [
      { product_id: 'p-3', quantity: 2, variant_combo: { couleur: 'Noir', taille: 'M' } },
    ],
  });
});

test('P0 — liste A active/restaurée puis ouverture de B via « Mes listes » : Partager repartage B, jamais A, aucune création', async () => {
  // A a été créée/restaurée par CE module : ses métadonnées vivent encore
  // dans state.shareToken/shareUrl/cartName (chemin historique).
  state.shareToken = 'tok-A';
  state.shareStatus = 'open';
  state.shareUrl = 'https://komerce.test/boutique/?p=tok-A';
  state.cartName = 'Liste A';

  // L'organisateur ouvre ensuite B depuis « Mes listes » : seul
  // group-side-cart.js écrit state.sharedListContext (pas state.shareToken).
  state.sharedListContext = {
    sharedCartId: 'sc-B',
    token: 'tok-B',
    status: 'open',
    isCreator: true,
    creatorFirstName: null,
    title: 'Liste B',
    message: null,
    items: [],
  };
  // L2 (mandat §4) — même remarque : "Partager" ne s'affiche que sur la
  // surface shared-list (ici, B est affichée après l'ouverture depuis
  // « Mes listes »).
  state.cartSurface = 'shared-list';

  await startShareFlow();

  expect(global.fetch).not.toHaveBeenCalled();
  expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({
    text: expect.stringContaining('sélection Komerce'),
    url: `${window.location.origin}/boutique/?p=tok-B`,
  }));
  expect(navigator.share).not.toHaveBeenCalledWith(expect.objectContaining({
    url: expect.stringContaining('tok-A'),
  }));
});

test('Partager la liste affichée fonctionne sans panier local et sans nouvelle création', async () => {
  state.cart = [];
  state.cartSurface = 'shared-list';
  state.sharedListContext = {
    sharedCartId: 'sc-existing',
    token: 'tok-existing',
    status: 'open',
    isCreator: false,
    creatorFirstName: 'Awa',
    title: 'Ancien titre libre ignoré',
    message: null,
    items: [],
  };

  await startShareFlow();

  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockRequireIdentity).not.toHaveBeenCalled();
  expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({
    text: expect.stringContaining('Liste de Awa'),
    url: `${window.location.origin}/boutique/?p=tok-existing`,
  }));
});

test('sans partage natif, le lien est copié et aucun canal n\'est ouvert automatiquement', async () => {
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
  expect(window.open).not.toHaveBeenCalledWith(
    expect.stringContaining('wa.me'),
    expect.anything(),
    expect.anything(),
  );
  expect(mockShowToast).toHaveBeenCalledWith(
    expect.stringContaining('WhatsApp'),
    'success',
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
