'use strict';

/**
 * tests/unit/group-side-cart.test.js
 *
 * Module js/group/group-side-cart.js — PROMPT_FINAL_IMPLEMENTATION_LISTE_
 * PARTAGEABLE_SIDE_CART. Couvre les invariants du mandat (§3, §6, §7, §8,
 * §9) : isolation des états, sélection locale sans appel réseau, statuts
 * disponible/déjà acheté, footer vide/non vide, indicateur mobile, actions
 * propriétaire, checkout avec shared_cart_item_id, et l'intégration avec
 * b-cart.js::renderCartBody() via isSharedListActive()/exitSharedListRenderMode()
 * (bug d'intégration trouvé et corrigé pendant cette session — b-cart.js
 * appelait ces deux exports alors qu'ils n'existaient pas encore ici).
 *
 * group-api.js, group-state.js, group-checkout-adapter.js et b-utils.js
 * (showToast) sont mockés — ce ne sont pas des dépendances sous test. b-store.js
 * et b-bus.js sont réels (état/bus partagés, convention des autres suites
 * boutique). sanitize/fmt de b-utils.js restent réels (assertions HTML lisibles).
 */

const mockShowToast = jest.fn();
const mockGetSharedCartPublic = jest.fn();
const mockGetSharedCartLibrary = jest.fn();
const mockSaveSharedCart = jest.fn();
const mockRemoveItemFromSharedList = jest.fn();
const mockCloseCart = jest.fn();
const mockAddItemToSharedList = jest.fn();
const mockUpdateSharedListItemQuantity = jest.fn();
const mockCheckoutSharedListSelection = jest.fn();
const mockIsDesktop = jest.fn();

jest.mock('../../js/b-utils.js', () => {
  const actual = jest.requireActual('../../js/b-utils.js');
  return { ...actual, showToast: mockShowToast };
});
jest.mock('../../js/b-scroll-owner.js', () => ({ isDesktop: mockIsDesktop }));
jest.mock('../../js/group/group-api.js', () => ({
  getSharedCartPublic: mockGetSharedCartPublic,
  getSharedCartLibrary: mockGetSharedCartLibrary,
  saveSharedCart: mockSaveSharedCart,
  removeItemFromSharedList: mockRemoveItemFromSharedList,
  closeCart: mockCloseCart,
  addItemToSharedList: mockAddItemToSharedList,
  updateSharedListItemQuantity: mockUpdateSharedListItemQuantity,
}));
jest.mock('../../js/group/group-checkout-adapter.js', () => ({
  checkoutSharedListSelection: mockCheckoutSharedListSelection,
}));

const { state, dom, initDom } = require('../../js/b-store.js');
const { bus } = require('../../js/b-bus.js');
const {
  activateSharedListContext,
  refreshSharedListContext,
  clearSharedListContext,
  toggleSharedListItem,
  renderSharedListInCart,
  renderLibraryInCart,
  isSharedListActive,
  isSharedListSurfaceActive,
  setCartSurface,
  exitSharedListRenderMode,
  addItemToSharedList,
  activateFromParticipantUrl,
  activateOwnerLibrary,
} = require('../../js/group/group-side-cart.js');

function mountShell() {
  document.body.innerHTML = `
    <div id="k-side-cart" class="k-side-cart"></div>
    <div id="k-cart-overlay"></div>
    <div id="k-cart-drawer">
      <div id="k-cart-header"><span id="k-cart-header-title"></span></div>
      <div id="k-cart-body"></div>
      <div id="k-cart-footer"></div>
    </div>
    <div id="k-order-modal"></div>
    <div id="k-toast"></div>
  `;
  initDom();
}

function resetSharedListState() {
  state.sharedListContext = {
    sharedCartId: null,
    token: null,
    status: 'open',
    isCreator: false,
    creatorFirstName: null,
    title: null,
    message: null,
    items: [],
  };
  state.sharedListSelection = new Set();
  state.cartSurface = 'personal';
}

function availableItem(overrides = {}) {
  return {
    id: 'item-1',
    product_id: 'p-1',
    name: 'Riz 25 kg',
    image: null,
    quantity: 1,
    unit_price_kmf: 6500,
    claimed: false,
    ...overrides,
  };
}

function publicPayload(overrides = {}) {
  return {
    cart: { id: 'sc-1', token: 'tok-1', status: 'open', creator_first_name: 'Samsam', title: null },
    items: [availableItem()],
    is_creator: false,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mountShell();
  resetSharedListState();
  state.cart = [];
  mockIsDesktop.mockReturnValue(true);
});

describe('activateSharedListContext', () => {
  it("remplit state.sharedListContext sans jamais toucher à state.cart (invariant mandat §3)", () => {
    const personalCart = [{ product: { id: 'x' }, qty: 2 }];
    state.cart = personalCart;

    activateSharedListContext(publicPayload(), 'tok-1');

    expect(state.cart).toBe(personalCart);
    expect(state.sharedListContext.sharedCartId).toBe('sc-1');
    expect(state.sharedListContext.token).toBe('tok-1');
    expect(state.sharedListContext.items).toHaveLength(1);
  });

  it('en-tête destinataire : "Liste de {prénom}" + sous-titre', () => {
    activateSharedListContext(publicPayload({ is_creator: false }), 'tok-1');
    renderSharedListInCart();
    const panel = document.getElementById('k-shared-list-panel');
    expect(panel.querySelector('.k-shared-list-title').textContent).toBe('Liste de Samsam');
    expect(panel.querySelector('.k-shared-list-subtitle').textContent).toContain('Samsam a préparé cette liste');
  });

  it('en-tête propriétaire : "Votre liste", aucun sous-titre', () => {
    activateSharedListContext(publicPayload({ is_creator: true }), 'tok-1');
    renderSharedListInCart();
    const panel = document.getElementById('k-shared-list-panel');
    expect(panel.querySelector('.k-shared-list-title').textContent).toBe('Votre liste');
    expect(panel.querySelector('.k-shared-list-subtitle')).toBeNull();
  });

  it('mobile : ouvre automatiquement le drawer après activation ; desktop : non', () => {
    mockIsDesktop.mockReturnValue(false);
    activateSharedListContext(publicPayload(), 'tok-1');
    expect(dom.cartDrawer.classList.contains('open')).toBe(true);

    document.body.classList.remove('cart-open');
    dom.cartDrawer.classList.remove('open');
    mockIsDesktop.mockReturnValue(true);
    activateSharedListContext(publicPayload(), 'tok-1');
    expect(dom.cartDrawer.classList.contains('open')).toBe(false);
  });
});

describe('statuts des lignes (mandat §6)', () => {
  it('ligne disponible -> statut "Disponible", sélectionnable', () => {
    activateSharedListContext(publicPayload({ items: [availableItem({ claimed: false })] }), 'tok-1');
    renderSharedListInCart();
    const row = document.querySelector('.k-shared-list-item');
    expect(row.classList.contains('is-claimed')).toBe(false);
    expect(row.querySelector('.k-shared-item-status').textContent).toBe('Disponible');
    expect(row.querySelector('.k-shared-item-select').disabled).toBe(false);
  });

  it('ligne déjà achetée -> reste visible, statut "Déjà acheté", contrôle désactivé', () => {
    activateSharedListContext(publicPayload({ items: [availableItem({ claimed: true })] }), 'tok-1');
    renderSharedListInCart();
    const row = document.querySelector('.k-shared-list-item');
    expect(row.classList.contains('is-claimed')).toBe(true);
    expect(row.querySelector('.k-shared-item-status').textContent).toBe('Déjà acheté');
    const control = row.querySelector('.k-shared-item-select');
    expect(control.disabled).toBe(true);
    expect(control.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('sélection locale (mandat §3/§8 — aucun appel réseau)', () => {
  it("sélectionner une ligne disponible ne modifie jamais state.cart et n'appelle aucune API", () => {
    const personalCart = [];
    state.cart = personalCart;
    activateSharedListContext(publicPayload({ items: [availableItem({ id: 'i1' })] }), 'tok-1');

    toggleSharedListItem('i1');

    expect(state.sharedListSelection.has('i1')).toBe(true);
    expect(state.cart).toBe(personalCart);
    expect(mockAddItemToSharedList).not.toHaveBeenCalled();
    expect(mockGetSharedCartPublic).toHaveBeenCalledTimes(0);
  });

  it('une ligne claimed ne peut jamais être sélectionnée (invariant)', () => {
    activateSharedListContext(publicPayload({ items: [availableItem({ id: 'i1', claimed: true })] }), 'tok-1');
    toggleSharedListItem('i1');
    expect(state.sharedListSelection.has('i1')).toBe(false);
  });

  it('re-cliquer désélectionne', () => {
    activateSharedListContext(publicPayload({ items: [availableItem({ id: 'i1' })] }), 'tok-1');
    toggleSharedListItem('i1');
    toggleSharedListItem('i1');
    expect(state.sharedListSelection.has('i1')).toBe(false);
  });
});

describe('refreshSharedListContext — nettoyage après refresh', () => {
  it('retire de la sélection les lignes devenues invalides ou claimed', async () => {
    activateSharedListContext(
      publicPayload({ items: [availableItem({ id: 'i1' }), availableItem({ id: 'i2' })] }),
      'tok-1',
    );
    toggleSharedListItem('i1');
    toggleSharedListItem('i2');
    expect(state.sharedListSelection.size).toBe(2);

    // i1 a été acheté entre-temps, i2 a disparu de la réponse serveur.
    mockGetSharedCartPublic.mockResolvedValueOnce(
      publicPayload({ items: [availableItem({ id: 'i1', claimed: true })] }),
    );

    await refreshSharedListContext();

    expect(state.sharedListSelection.has('i1')).toBe(false);
    expect(state.sharedListSelection.has('i2')).toBe(false);
  });
});

describe('footer / mini-total (mandat §6)', () => {
  it('sélection vide -> hint + CTA disabled', () => {
    activateSharedListContext(publicPayload({ items: [availableItem({ id: 'i1' })] }), 'tok-1');
    renderSharedListInCart();
    const buy = document.getElementById('k-shared-list-buy');
    expect(buy.disabled).toBe(true);
    expect(document.querySelector('.k-shared-list-footer-hint')).not.toBeNull();
  });

  it('sélection non vide -> total calculé depuis prix snapshot et quantités sélectionnées', () => {
    activateSharedListContext(
      publicPayload({
        items: [
          availableItem({ id: 'i1', unit_price_kmf: 6500, quantity: 1 }),
          availableItem({ id: 'i2', unit_price_kmf: 4200, quantity: 2 }),
        ],
      }),
      'tok-1',
    );
    toggleSharedListItem('i1');
    toggleSharedListItem('i2');
    const buy = document.getElementById('k-shared-list-buy');
    expect(buy.disabled).toBe(false);
    expect(document.querySelector('.k-shared-list-footer-recap strong').textContent).toMatch(/14[\s\u00a0\u202f]900/);
  });
});

describe('indicateur mobile "Liste · N" (mandat §7)', () => {
  it('invisible hors contexte liste', () => {
    expect(document.getElementById('k-shared-list-chip')).toBeNull();
  });

  it("visible sur mobile en contexte, absent sur desktop", () => {
    mockIsDesktop.mockReturnValue(false);
    activateSharedListContext(publicPayload({ items: [availableItem({ id: 'i1' })] }), 'tok-1');
    toggleSharedListItem('i1');
    let chip = document.getElementById('k-shared-list-chip');
    expect(chip).not.toBeNull();
    expect(chip.textContent).toBe('Liste · 1');

    clearSharedListContext();
    mockIsDesktop.mockReturnValue(true);
    activateSharedListContext(publicPayload({ items: [availableItem({ id: 'i1' })] }), 'tok-1');
    chip = document.getElementById('k-shared-list-chip');
    expect(chip).toBeNull();
  });
});

describe('checkout (mandat §8)', () => {
  afterEach(() => {
    state.products = [];
  });

  it('Acheter la sélection -> construit les lignes avec shared_cart_item_id et délègue au checkout canonique', () => {
    state.products = [{ id: 'p-1', name: 'Riz 25 kg', image_url: '/img/riz.jpg', price_kmf: 6500 }];
    activateSharedListContext(
      publicPayload({ items: [availableItem({ id: 'i1', product_id: 'p-1', unit_price_kmf: 6500 })] }),
      'tok-1',
    );
    toggleSharedListItem('i1');
    mockCheckoutSharedListSelection.mockReturnValue(true);

    document.getElementById('k-shared-list-buy').click();

    expect(mockCheckoutSharedListSelection).toHaveBeenCalledWith([
      expect.objectContaining({ shared_cart_item_id: 'i1', quantity: 1 }),
    ]);
  });

  it("régression V2-E — product.id est celui du catalogue (product_id), jamais l'id de ligne de liste", () => {
    state.products = [{ id: 'p-1', name: 'Riz 25 kg', image_url: '/img/riz.jpg', price_kmf: 6500 }];
    activateSharedListContext(
      publicPayload({ items: [availableItem({ id: 'i1', product_id: 'p-1', unit_price_kmf: 6500 })] }),
      'tok-1',
    );
    toggleSharedListItem('i1');
    mockCheckoutSharedListSelection.mockReturnValue(true);

    document.getElementById('k-shared-list-buy').click();

    const [[calledWith]] = mockCheckoutSharedListSelection.mock.calls;
    expect(calledWith[0].shared_cart_item_id).toBe('i1');
    expect(calledWith[0].product.id).toBe('p-1');
    expect(calledWith[0].product.id).not.toBe('i1');
  });

  it('le produit envoyé au checkout porte le prix catalogue courant, pas le prix snapshot de la liste (montant affiché = montant facturé)', () => {
    // Le catalogue a évolué depuis le partage de la liste : le snapshot de
    // la ligne (6500) est resté figé, le prix courant du produit est 7200.
    state.products = [{ id: 'p-1', name: 'Riz 25 kg', image_url: '/img/riz.jpg', price_kmf: 7200 }];
    activateSharedListContext(
      publicPayload({ items: [availableItem({ id: 'i1', product_id: 'p-1', unit_price_kmf: 6500 })] }),
      'tok-1',
    );
    toggleSharedListItem('i1');
    mockCheckoutSharedListSelection.mockReturnValue(true);

    document.getElementById('k-shared-list-buy').click();

    const [[calledWith]] = mockCheckoutSharedListSelection.mock.calls;
    expect(calledWith[0].product.price_kmf).toBe(7200);
  });

  it("produit devenu indisponible (absent de state.products) -> retiré de la sélection, toast, exclu du checkout", () => {
    state.products = []; // supprimé/désactivé depuis le partage de la liste
    activateSharedListContext(
      publicPayload({ items: [availableItem({ id: 'i1', product_id: 'p-gone', unit_price_kmf: 6500 })] }),
      'tok-1',
    );
    toggleSharedListItem('i1');

    document.getElementById('k-shared-list-buy').click();

    expect(mockCheckoutSharedListSelection).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('disponible'), 'info');
    expect(state.sharedListSelection.has('i1')).toBe(false);
  });

  it('sélection mixte (un produit disponible, un devenu indisponible) -> checkout démarré seulement pour le disponible', () => {
    state.products = [{ id: 'p-1', name: 'Riz 25 kg', image_url: '/img/riz.jpg', price_kmf: 6500 }];
    activateSharedListContext(
      publicPayload({
        items: [
          availableItem({ id: 'i1', product_id: 'p-1', unit_price_kmf: 6500 }),
          availableItem({ id: 'i2', product_id: 'p-gone', unit_price_kmf: 4200 }),
        ],
      }),
      'tok-1',
    );
    toggleSharedListItem('i1');
    toggleSharedListItem('i2');
    mockCheckoutSharedListSelection.mockReturnValue(true);

    document.getElementById('k-shared-list-buy').click();

    expect(mockCheckoutSharedListSelection).toHaveBeenCalledTimes(1);
    const [[calledWith]] = mockCheckoutSharedListSelection.mock.calls;
    expect(calledWith).toHaveLength(1);
    expect(calledWith[0].shared_cart_item_id).toBe('i1');
    expect(state.sharedListSelection.has('i2')).toBe(false);
  });
});

describe('actions propriétaire (mandat §9)', () => {
  it('retirer un article -> confirmation puis DELETE puis refresh', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    activateSharedListContext(
      publicPayload({ is_creator: true, items: [availableItem({ id: 'i1' })] }),
      'tok-1',
    );
    mockRemoveItemFromSharedList.mockResolvedValueOnce({ ok: true });
    mockGetSharedCartPublic.mockResolvedValueOnce(publicPayload({ is_creator: true, items: [] }));

    document.querySelector('.k-shared-item-remove').click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRemoveItemFromSharedList).toHaveBeenCalledWith('sc-1', 'i1');
    confirmSpy.mockRestore();
  });

  it('refus de la confirmation -> aucun appel API', () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    activateSharedListContext(
      publicPayload({ is_creator: true, items: [availableItem({ id: 'i1' })] }),
      'tok-1',
    );
    document.querySelector('.k-shared-item-remove').click();
    expect(mockRemoveItemFromSharedList).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('fermer la liste -> confirmation puis POST /close puis refresh', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    activateSharedListContext(
      publicPayload({ is_creator: true, items: [availableItem({ id: 'i1' })] }),
      'tok-1',
    );
    mockCloseCart.mockResolvedValueOnce({ ok: true });
    mockGetSharedCartPublic.mockResolvedValueOnce(publicPayload({ is_creator: true, status: 'closed' }));

    document.getElementById('k-shared-list-close').click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockCloseCart).toHaveBeenCalledWith('sc-1');
    confirmSpy.mockRestore();
  });

  it('addItemToSharedList : ajout unitaire immédiat côté serveur (un seul appel)', async () => {
    activateSharedListContext(publicPayload({ is_creator: true, items: [] }), 'tok-1');
    mockAddItemToSharedList.mockResolvedValueOnce({ ok: true });
    mockGetSharedCartPublic.mockResolvedValueOnce(publicPayload({ is_creator: true, items: [availableItem()] }));

    const ok = await addItemToSharedList('p-9', 2);

    expect(ok).toBe(true);
    expect(mockAddItemToSharedList).toHaveBeenCalledTimes(1);
    expect(mockAddItemToSharedList).toHaveBeenCalledWith('sc-1', 'p-9', 2);
  });

  it('addItemToSharedList refuse si non propriétaire', async () => {
    activateSharedListContext(publicPayload({ is_creator: false, items: [] }), 'tok-1');
    const ok = await addItemToSharedList('p-9', 1);
    expect(ok).toBe(false);
    expect(mockAddItemToSharedList).not.toHaveBeenCalled();
  });
});

describe('sauvegarde explicite destinataire (amendement V2 §D)', () => {
  it("créateur -> bouton 'Sauvegarder cette liste' absent (déjà dans « Créées par moi »)", () => {
    activateSharedListContext(publicPayload({ is_creator: true }), 'tok-1');
    expect(document.getElementById('k-shared-list-save')).toBeNull();
  });

  it("destinataire -> bouton 'Sauvegarder cette liste' visible et actif", () => {
    activateSharedListContext(publicPayload({ is_creator: false }), 'tok-save-a');
    const btn = document.getElementById('k-shared-list-save');
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain('Sauvegarder');
  });

  it('clic -> POST /save avec le token courant, jamais posé automatiquement à l\'activation', async () => {
    const payloadB = publicPayload({ is_creator: false });
    payloadB.cart.token = 'tok-save-b';
    activateSharedListContext(payloadB, 'tok-save-b');
    expect(mockSaveSharedCart).not.toHaveBeenCalled();
    mockSaveSharedCart.mockResolvedValueOnce({ ok: true, shared_cart_id: 'sc-1', already_saved: false });

    document.getElementById('k-shared-list-save').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockSaveSharedCart).toHaveBeenCalledWith('tok-save-b');
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('ajoutée'), 'success');
  });

  it('après sauvegarde réussie -> le bouton passe en état "sauvegardée" (désactivé)', async () => {
    activateSharedListContext(publicPayload({ is_creator: false }), 'tok-save-c');
    mockSaveSharedCart.mockResolvedValueOnce({ ok: true, shared_cart_id: 'sc-1', already_saved: false });

    document.getElementById('k-shared-list-save').click();
    await Promise.resolve();
    await Promise.resolve();

    const btn = document.getElementById('k-shared-list-save');
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('sauvegardée');
  });

  it('déjà sauvegardée côté backend -> toast informatif dédié, pas d\'erreur', async () => {
    const payloadD = publicPayload({ is_creator: false });
    payloadD.cart.token = 'tok-save-d';
    activateSharedListContext(payloadD, 'tok-save-d');
    mockSaveSharedCart.mockResolvedValueOnce({ ok: true, shared_cart_id: 'sc-1', already_saved: true });

    document.getElementById('k-shared-list-save').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('déjà'), 'success');
  });

  it('échec réseau -> toast erreur, bouton reste actif', async () => {
    const payloadE = publicPayload({ is_creator: false });
    payloadE.cart.token = 'tok-save-e';
    activateSharedListContext(payloadE, 'tok-save-e');
    mockSaveSharedCart.mockRejectedValueOnce(new Error('boom'));

    document.getElementById('k-shared-list-save').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('Impossible'), 'error');
    expect(document.getElementById('k-shared-list-save').disabled).toBe(false);
  });
});

describe('clearSharedListContext', () => {
  it('efface le contexte, la sélection, et les traces DOM du mode liste', () => {
    activateSharedListContext(publicPayload({ items: [availableItem({ id: 'i1' })] }), 'tok-1');
    toggleSharedListItem('i1');

    clearSharedListContext();

    expect(state.sharedListContext.token).toBeNull();
    expect(state.sharedListSelection.size).toBe(0);
    expect(document.body.classList.contains('is-shared-list-context')).toBe(false);
    expect(document.getElementById('k-side-cart').getAttribute('data-mode')).toBeNull();
  });
});

describe('activateFromParticipantUrl / activateOwnerLibrary (amendement V2 §D)', () => {
  it('lien invalide -> toast erreur, aucune activation', async () => {
    mockGetSharedCartPublic.mockResolvedValueOnce(null);
    const ok = await activateFromParticipantUrl('bad-token');
    expect(ok).toBe(false);
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('invalide'), 'error');
    expect(state.sharedListContext.token).toBeNull();
  });

  it('bibliothèque en erreur réseau -> toast erreur, cartSurface inchangé', async () => {
    mockGetSharedCartLibrary.mockRejectedValueOnce(new Error('boom'));
    const ok = await activateOwnerLibrary();
    expect(ok).toBe(false);
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('Impossible'), 'error');
    expect(state.cartSurface).toBe('personal');
  });

  it("bibliothèque vide (aucune liste créée ni sauvegardée) -> les deux sections restent vides, cartSurface = 'library'", async () => {
    mockGetSharedCartLibrary.mockResolvedValueOnce({ created: [], saved: [] });
    const ok = await activateOwnerLibrary();
    expect(ok).toBe(true);
    expect(state.cartSurface).toBe('library');
    expect(state.libraryContext).toEqual({ created: [], saved: [] });
  });

  it("bibliothèque avec listes -> rend les deux sections dans le panneau, data-mode='library'", async () => {
    mockGetSharedCartLibrary.mockResolvedValueOnce({
      created: [{ id: 'sc-1', token: 'tok-owner', title: 'Ma liste', status: 'open', total_kmf: 1000 }],
      saved: [{ id: 'sc-2', token: 'tok-recu', title: 'Liste reçue', organizer_full_name: 'Samsam', total_kmf: 2000 }],
    });

    const ok = await activateOwnerLibrary();

    expect(ok).toBe(true);
    expect(document.getElementById('k-side-cart').getAttribute('data-mode')).toBe('library');
    const panel = document.getElementById('k-shared-list-panel');
    expect(panel.textContent).toContain('Ma liste');
    expect(panel.textContent).toContain('Liste reçue');
    expect(panel.querySelectorAll('.k-library-item')).toHaveLength(2);
  });

  it("clic sur une liste de la bibliothèque -> ouvre la liste via activateFromParticipantUrl (même token)", async () => {
    mockGetSharedCartLibrary.mockResolvedValueOnce({
      created: [{ id: 'sc-1', token: 'tok-owner', title: 'Ma liste', status: 'open', total_kmf: 1000 }],
      saved: [],
    });
    mockGetSharedCartPublic.mockResolvedValueOnce(publicPayload({ is_creator: true }));

    await activateOwnerLibrary();
    document.querySelector('.k-library-item').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockGetSharedCartPublic).toHaveBeenCalledWith('tok-owner');
    expect(state.sharedListContext.isCreator).toBe(true);
  });
});

describe('isSharedListActive / exitSharedListRenderMode (contrat avec b-cart.js::renderCartBody, mandat §5)', () => {
  it('isSharedListActive() reflète l\'état du contexte', () => {
    expect(isSharedListActive()).toBe(false);
    activateSharedListContext(publicPayload(), 'tok-1');
    expect(isSharedListActive()).toBe(true);
  });

  it('exitSharedListRenderMode() est un no-op tant que le contexte reste actif', () => {
    activateSharedListContext(publicPayload({ items: [availableItem()] }), 'tok-1');
    renderSharedListInCart();
    exitSharedListRenderMode();
    // Le panneau liste reste en place — exitSharedListRenderMode() ne nettoie
    // rien tant qu'isSharedListActive() est vrai.
    expect(document.getElementById('k-shared-list-panel')).not.toBeNull();
  });

  it('exitSharedListRenderMode() nettoie les traces DOM une fois le contexte terminé', () => {
    activateSharedListContext(publicPayload({ items: [availableItem()] }), 'tok-1');
    renderSharedListInCart();
    clearSharedListContext(); // termine le contexte (état + premier nettoyage)
    document.body.classList.add('is-shared-list-context'); // simule un résidu DOM
    document.getElementById('k-side-cart').setAttribute('data-mode', 'shared-list');

    exitSharedListRenderMode();

    expect(document.body.classList.contains('is-shared-list-context')).toBe(false);
    expect(document.getElementById('k-side-cart').getAttribute('data-mode')).toBeNull();
  });
});

describe('Amendement V2 §A — cartSurface (coexistence panier personnel / liste)', () => {
  it("activer un contexte de liste force cartSurface='shared-list' sans jamais toucher state.cart", () => {
    const personalCart = [{ product: { id: 'x' }, qty: 2 }];
    state.cart = personalCart;

    activateSharedListContext(publicPayload({ items: [availableItem()] }), 'tok-1');

    expect(state.cartSurface).toBe('shared-list');
    expect(state.cart).toBe(personalCart);
  });

  it("isSharedListSurfaceActive() est faux si le contexte est actif mais la surface est 'personal'", () => {
    activateSharedListContext(publicPayload({ items: [availableItem()] }), 'tok-1');
    expect(isSharedListSurfaceActive()).toBe(true);

    setCartSurface('personal');
    expect(isSharedListActive()).toBe(true); // le contexte reste en arrière-plan
    expect(isSharedListSurfaceActive()).toBe(false); // mais la surface affichée est le panier
  });

  it("setCartSurface('personal') nettoie le DOM du side cart sans effacer le contexte ni la sélection", () => {
    activateSharedListContext(publicPayload({ items: [availableItem({ id: 'i1' })] }), 'tok-1');
    toggleSharedListItem('i1');
    expect(state.sharedListSelection.has('i1')).toBe(true);

    setCartSurface('personal');

    expect(document.body.classList.contains('is-shared-list-context')).toBe(false);
    expect(document.getElementById('k-side-cart').getAttribute('data-mode')).toBeNull();
    // Le contexte et la sélection locale survivent au passage en arrière-plan.
    expect(state.sharedListContext.token).toBe('tok-1');
    expect(state.sharedListSelection.has('i1')).toBe(true);
  });

  it("setCartSurface('shared-list') restaure la projection de la liste dans le side cart", () => {
    activateSharedListContext(publicPayload({ items: [availableItem({ id: 'i1' })] }), 'tok-1');
    setCartSurface('personal');
    expect(document.getElementById('k-shared-list-panel')).toBeNull();

    setCartSurface('shared-list');

    expect(document.getElementById('k-side-cart').getAttribute('data-mode')).toBe('shared-list');
    expect(document.getElementById('k-shared-list-panel')).not.toBeNull();
  });

  it("alternance répétée panier <-> liste ne perd ni le panier personnel ni la sélection de liste", () => {
    const personalCart = [{ product: { id: 'x' }, qty: 3 }];
    state.cart = personalCart;
    activateSharedListContext(publicPayload({ items: [availableItem({ id: 'i1' })] }), 'tok-1');
    toggleSharedListItem('i1');

    setCartSurface('personal');
    setCartSurface('shared-list');
    setCartSurface('personal');
    setCartSurface('shared-list');

    expect(state.cart).toBe(personalCart);
    expect(state.sharedListSelection.has('i1')).toBe(true);
    expect(state.sharedListContext.token).toBe('tok-1');
  });

  it("clearSharedListContext() ramène cartSurface à 'personal'", () => {
    activateSharedListContext(publicPayload({ items: [availableItem()] }), 'tok-1');
    expect(state.cartSurface).toBe('shared-list');

    clearSharedListContext();

    expect(state.cartSurface).toBe('personal');
    expect(isSharedListSurfaceActive()).toBe(false);
  });

  it("renderSharedListInCart() est un no-op si la surface n'est pas 'shared-list' (appel direct défensif)", () => {
    activateSharedListContext(publicPayload({ items: [availableItem()] }), 'tok-1');
    setCartSurface('personal');
    document.getElementById('k-shared-list-panel')?.remove();

    renderSharedListInCart();

    expect(document.getElementById('k-shared-list-panel')).toBeNull();
  });

  describe('sélecteur desktop [Panier] [Liste] (§A — coexistence)', () => {
    it('absent si le panier personnel est vide, même en contexte liste actif', () => {
      mockIsDesktop.mockReturnValue(true);
      state.cart = [];
      activateSharedListContext(publicPayload({ items: [availableItem()] }), 'tok-1');
      expect(document.getElementById('k-cart-surface-switch')).toBeNull();
    });

    it('absent hors contexte liste, même avec un panier personnel non vide', () => {
      mockIsDesktop.mockReturnValue(true);
      state.cart = [{ product: { id: 'x' }, qty: 1 }];
      // aucun activateSharedListContext appelé -> pas de contexte actif
      expect(document.getElementById('k-cart-surface-switch')).toBeNull();
    });

    it('présent sur desktop quand panier non vide + contexte liste actif ; absent sur mobile', () => {
      mockIsDesktop.mockReturnValue(true);
      state.cart = [{ product: { id: 'x' }, qty: 2 }];
      activateSharedListContext(publicPayload({ items: [availableItem({ id: 'i1' })] }), 'tok-1');

      const switcher = document.getElementById('k-cart-surface-switch');
      expect(switcher).not.toBeNull();
      const buttons = switcher.querySelectorAll('.k-cart-surface-btn');
      expect(buttons).toHaveLength(2);
      expect(buttons[0].textContent).toContain('Panier (2)');
      expect(buttons[0].getAttribute('aria-pressed')).toBe('false'); // surface = shared-list
      expect(buttons[1].getAttribute('aria-pressed')).toBe('true');

      mockIsDesktop.mockReturnValue(false);
      buttons[0].click(); // relance un rendu qui recalcule shouldShow via renderCartSurfaceSwitch
      // setCartSurface('personal') ré-émet side-cart:render -> renderCartSurfaceSwitch() le retire.
      expect(document.getElementById('k-cart-surface-switch')).toBeNull();
    });

    it('cliquer le bouton "Panier" bascule cartSurface sans quitter le contexte', () => {
      mockIsDesktop.mockReturnValue(true);
      state.cart = [{ product: { id: 'x' }, qty: 1 }];
      activateSharedListContext(publicPayload({ items: [availableItem()] }), 'tok-1');

      document.querySelector('.k-cart-surface-btn[data-surface="personal"]').click();

      expect(state.cartSurface).toBe('personal');
      expect(state.sharedListContext.token).toBe('tok-1');
    });
  });
});

describe('amendement V2 §B — contrôles de quantité par ligne', () => {
  beforeEach(() => {
    mockIsDesktop.mockReturnValue(true);
  });

  it('rend les boutons +/- uniquement pour le créateur, panier open, ligne non réclamée', () => {
    activateSharedListContext(publicPayload({ is_creator: true, items: [availableItem({ id: 'i1' })] }), 'tok-1');
    // Scopé à #k-side-cart : renderSharedListInCart() rend aussi dans le
    // drawer (dom.cartBody), présent en parallèle dans ce DOM de test — un
    // querySelectorAll global compterait les deux surfaces et doublerait
    // le total (cf. les autres tests de ce fichier scopés de la même façon,
    // ex. ligne ~552 `switcher.querySelectorAll(...)`).
    const desktopPanel = document.getElementById('k-side-cart');
    expect(desktopPanel.querySelectorAll('.k-shared-item-qty-btn')).toHaveLength(2);
  });

  it("n'affiche aucun contrôle de quantité pour un visiteur non créateur", () => {
    activateSharedListContext(publicPayload({ is_creator: false, items: [availableItem({ id: 'i1' })] }), 'tok-1');
    expect(document.querySelectorAll('.k-shared-item-qty-btn')).toHaveLength(0);
  });

  it("n'affiche aucun contrôle de quantité pour une ligne déjà réclamée", () => {
    activateSharedListContext(publicPayload({ is_creator: true, items: [availableItem({ id: 'i1', claimed: true })] }), 'tok-1');
    expect(document.querySelectorAll('.k-shared-item-qty-btn')).toHaveLength(0);
  });

  it('clic sur "+" appelle updateSharedListItemQuantity avec quantité+1 puis rafraîchit', async () => {
    mockUpdateSharedListItemQuantity.mockResolvedValue({ ok: true });
    activateSharedListContext(publicPayload({ is_creator: true, items: [availableItem({ id: 'i1', quantity: 2 })] }), 'tok-1');
    mockGetSharedCartPublic.mockResolvedValue(publicPayload({ is_creator: true, items: [availableItem({ id: 'i1', quantity: 3 })] }));

    document.querySelector('.k-shared-item-qty-btn[data-qty-step="1"]').click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(mockUpdateSharedListItemQuantity).toHaveBeenCalledWith('sc-1', 'i1', 3);
    expect(mockGetSharedCartPublic).toHaveBeenCalled();
  });

  it('clic sur "-" à quantité 1 déclenche un retrait confirmé (pas de PATCH quantity=0) — correctif V2-B.1 §4', () => {
    window.confirm = jest.fn(() => true);
    mockRemoveItemFromSharedList.mockResolvedValue({});
    mockGetSharedCartPublic.mockResolvedValue(publicPayload({ is_creator: true, items: [] }));
    activateSharedListContext(publicPayload({ is_creator: true, items: [availableItem({ id: 'i1', quantity: 1 })] }), 'tok-1');

    document.querySelector('.k-shared-item-qty-btn[data-qty-step="-1"]').click();

    expect(window.confirm).toHaveBeenCalled();
    expect(mockUpdateSharedListItemQuantity).not.toHaveBeenCalled();
    expect(mockRemoveItemFromSharedList).toHaveBeenCalledWith('sc-1', 'i1');
  });

  it('clic sur "-" à quantité 1, confirmation refusée -> aucun appel réseau', () => {
    window.confirm = jest.fn(() => false);
    activateSharedListContext(publicPayload({ is_creator: true, items: [availableItem({ id: 'i1', quantity: 1 })] }), 'tok-1');

    document.querySelector('.k-shared-item-qty-btn[data-qty-step="-1"]').click();

    expect(mockUpdateSharedListItemQuantity).not.toHaveBeenCalled();
    expect(mockRemoveItemFromSharedList).not.toHaveBeenCalled();
  });

  it("verrouille la ligne pendant l'appel réseau (désactive les boutons), déverrouille ensuite", async () => {
    let resolvePatch;
    mockUpdateSharedListItemQuantity.mockReturnValue(new Promise((res) => { resolvePatch = res; }));
    mockGetSharedCartPublic.mockResolvedValue(publicPayload({ is_creator: true, items: [availableItem({ id: 'i1', quantity: 2 })] }));
    activateSharedListContext(publicPayload({ is_creator: true, items: [availableItem({ id: 'i1', quantity: 1 })] }), 'tok-1');

    document.querySelector('.k-shared-item-qty-btn[data-qty-step="1"]').click();
    await Promise.resolve();

    expect(document.querySelector('.k-shared-item-qty-btn[data-qty-step="1"]').disabled).toBe(true);

    resolvePatch({ ok: true });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(document.querySelector('.k-shared-item-qty-btn[data-qty-step="1"]').disabled).toBe(false);
  });

  it('affiche une erreur et déverrouille la ligne si le serveur refuse (ex: item_already_claimed)', async () => {
    mockUpdateSharedListItemQuantity.mockRejectedValue(new Error('Cet article a déjà été acheté'));
    activateSharedListContext(publicPayload({ is_creator: true, items: [availableItem({ id: 'i1', quantity: 1 })] }), 'tok-1');

    document.querySelector('.k-shared-item-qty-btn[data-qty-step="1"]').click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('Erreur'), 'error');
    expect(document.querySelector('.k-shared-item-qty-btn[data-qty-step="1"]').disabled).toBe(false);
  });
});

describe('amendement V2 §B — ouverture fiche produit depuis une ligne de liste', () => {
  let modalOpenHandler;

  beforeEach(() => {
    mockIsDesktop.mockReturnValue(true);
    modalOpenHandler = jest.fn();
    bus.on('modal:open', modalOpenHandler);
    state.products = [{ id: 'p-42' }];
  });

  afterEach(() => {
    bus.off('modal:open', modalOpenHandler);
    state.modalReturnSurface = null;
    state.products = [];
  });

  it('clic sur la ligne émet modal:open avec product_id, source et sharedCartItemId, et pose modalReturnSurface', () => {
    activateSharedListContext(publicPayload({ items: [availableItem({ id: 'i1', product_id: 'p-42' })] }), 'tok-1');

    document.querySelector('.k-shared-item-open').click();

    expect(modalOpenHandler).toHaveBeenCalledWith({ id: 'p-42', source: 'shared-list', sharedCartItemId: 'i1' });
    expect(state.modalReturnSurface).toBe('shared-list');
  });

  it("bus.emit('modal:closed') restaure cartSurface='shared-list' et consomme modalReturnSurface une seule fois", () => {
    activateSharedListContext(publicPayload({ items: [availableItem({ id: 'i1', product_id: 'p-42' })] }), 'tok-1');
    document.querySelector('.k-shared-item-open').click();
    setCartSurface('personal');
    expect(state.cartSurface).toBe('personal');

    bus.emit('modal:closed');

    expect(state.cartSurface).toBe('shared-list');
    expect(state.modalReturnSurface).toBeNull();

    setCartSurface('personal');
    bus.emit('modal:closed'); // fermeture ultérieure, sans rapport avec la liste
    expect(state.cartSurface).toBe('personal'); // pas rejouée
  });

  it("modal:closed est un no-op si modalReturnSurface n'a jamais été posé", () => {
    activateSharedListContext(publicPayload({ items: [availableItem()] }), 'tok-1');
    setCartSurface('personal');

    bus.emit('modal:closed');

    expect(state.cartSurface).toBe('personal');
  });

  it("produit absent ou inactif (introuvable dans state.products) -> toast, aucun modal:open, aucune fermeture de drawer — correctif V2-B.1 §3", () => {
    state.products = []; // produit supprimé/désactivé depuis le partage
    activateSharedListContext(publicPayload({ items: [availableItem({ id: 'i1', product_id: 'p-gone' })] }), 'tok-1');

    document.querySelector('.k-shared-item-open').click();

    expect(modalOpenHandler).not.toHaveBeenCalled();
    expect(state.modalReturnSurface).toBeNull();
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('disponible'), 'info');
  });

  describe('mobile — fermeture/réouverture réelle du drawer (correctif V2-B.1 §1/§2)', () => {
    beforeEach(() => {
      mockIsDesktop.mockReturnValue(false);
    });

    it('clic sur la ligne ferme réellement le drawer avant modal:open', () => {
      activateSharedListContext(publicPayload({ items: [availableItem({ id: 'i1', product_id: 'p-42' })] }), 'tok-1');
      expect(dom.cartDrawer.classList.contains('open')).toBe(true); // auto-ouvert à l'activation (mandat §4)

      document.querySelector('.k-shared-item-open').click();

      expect(dom.cartDrawer.classList.contains('open')).toBe(false);
      expect(dom.cartOverlay.classList.contains('open')).toBe(false);
      expect(document.body.classList.contains('cart-open')).toBe(false);
      expect(modalOpenHandler).toHaveBeenCalled();
    });

    it("bus.emit('modal:closed') rouvre réellement le drawer après une ouverture depuis la liste", () => {
      activateSharedListContext(publicPayload({ items: [availableItem({ id: 'i1', product_id: 'p-42' })] }), 'tok-1');
      document.querySelector('.k-shared-item-open').click();
      expect(dom.cartDrawer.classList.contains('open')).toBe(false);

      bus.emit('modal:closed');

      expect(dom.cartDrawer.classList.contains('open')).toBe(true);
      expect(dom.cartOverlay.classList.contains('open')).toBe(true);
      expect(document.body.classList.contains('cart-open')).toBe(true);
    });

    it('produit absent -> le drawer ne se ferme jamais (aucune fermeture sans ouverture de modale)', () => {
      state.products = [];
      activateSharedListContext(publicPayload({ items: [availableItem({ id: 'i1', product_id: 'p-gone' })] }), 'tok-1');
      expect(dom.cartDrawer.classList.contains('open')).toBe(true);

      document.querySelector('.k-shared-item-open').click();

      expect(dom.cartDrawer.classList.contains('open')).toBe(true);
    });
  });
});

describe('amendement V2 §B — conflit checkout "item_already_claimed" (correctif V2-B.1 §5)', () => {
  it('bus.emit(\'checkout:order-failed\', { code: shared_cart_item_already_claimed }) rafraîchit la liste active', async () => {
    mockGetSharedCartPublic.mockResolvedValue(publicPayload({ items: [availableItem({ id: 'i1', claimed: true })] }));
    activateSharedListContext(publicPayload({ items: [availableItem({ id: 'i1' })] }), 'tok-1');
    mockGetSharedCartPublic.mockClear();

    bus.emit('checkout:order-failed', { code: 'shared_cart_item_already_claimed' });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('acheté'), 'info');
    expect(mockGetSharedCartPublic).toHaveBeenCalledWith('tok-1');
  });

  it('bus.emit(\'checkout:order-failed\', ...) avec un autre code ne touche pas la liste', async () => {
    activateSharedListContext(publicPayload({ items: [availableItem({ id: 'i1' })] }), 'tok-1');
    mockGetSharedCartPublic.mockClear();

    bus.emit('checkout:order-failed', { code: 'some_other_error' });
    await Promise.resolve();

    expect(mockGetSharedCartPublic).not.toHaveBeenCalled();
  });

  it("hors contexte de liste actif, l'événement est un no-op", async () => {
    clearSharedListContext();
    mockGetSharedCartPublic.mockClear();

    bus.emit('checkout:order-failed', { code: 'shared_cart_item_already_claimed' });
    await Promise.resolve();

    expect(mockGetSharedCartPublic).not.toHaveBeenCalled();
  });
});
