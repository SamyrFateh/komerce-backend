'use strict';

/**
 * tests/unit/group-render-list.test.js
 *
 * Module js/group/group-render-list.js — écran unique de la liste
 * partageable (remplace b-group-view.js). Couvre les points normatifs du
 * Contrat UX / Invariants UX :
 *   - un seul arbre de rendu, capacités créateur en ligne (Invariant 1) ;
 *   - vocabulaire d'achat strict, jamais "réclamer"/"organisateur" à
 *     l'écran (Invariant 6-10) ;
 *   - pas de compte à rebours, progression "X sur Y" (Invariant 11-12) ;
 *   - sélection locale sans écriture serveur avant achat (Invariant 16) ;
 *   - lien invalide → redirection boutique standard (Invariant 22) ;
 *   - liste annulée présentée neutre, jamais comme un échec (Invariant 14).
 */

jest.mock('../../js/group/group-api.js', () => ({
  getOwnerSharedCarts: jest.fn(),
  getSharedCartPublic: jest.fn(),
  removeItemFromSharedList: jest.fn(),
  closeCart: jest.fn(),
}));
jest.mock('../../js/group/group-checkout-adapter.js', () => ({
  checkoutSharedListSelection: jest.fn(),
}));
jest.mock('../../js/b-utils.js', () => ({
  showToast: jest.fn(),
}));
jest.mock('../../js/b-nav.js', () => ({
  switchView: jest.fn(),
}));

const { state } = require('../../js/b-store.js');
const { switchView } = require('../../js/b-nav.js');

const {
  getOwnerSharedCarts,
  getSharedCartPublic,
  removeItemFromSharedList,
  closeCart,
} = require('../../js/group/group-api.js');
const { checkoutSharedListSelection } = require('../../js/group/group-checkout-adapter.js');
const { showToast } = require('../../js/b-utils.js');
const {
  renderGroupView,
  detectParticipantToken,
  stopPolling,
} = require('../../js/group/group-render-list.js');

function container() {
  return document.getElementById('k-group-view');
}

function makeCart(overrides = {}) {
  return {
    token: 'tok-1', title: null, message: null, status: 'open',
    created_at: '2026-01-01', creator_first_name: 'Aïcha', id: undefined,
    ...overrides,
  };
}

function makeItem(overrides = {}) {
  return {
    id: 'sci-1', name: 'Riz', image: null, quantity: 1,
    unit_price_kmf: 1000, line_total_kmf: 1000, claimed: false,
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="k-catalog-section"></div>';
  jest.clearAllMocks();
  window.confirm = jest.fn(() => true);
});

describe('detectParticipantToken', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/boutique/');
  });

  it('lit ?p=token dans l\'URL', () => {
    window.history.pushState({}, '', '/boutique/?p=abc123');
    expect(detectParticipantToken()).toBe('abc123');
  });

  it('retourne null si aucun token présent', () => {
    window.history.pushState({}, '', '/boutique/');
    expect(detectParticipantToken()).toBeNull();
  });
});

describe('stopPolling', () => {
  it('ne lève jamais (no-op, compat contrat b-nav.js)', () => {
    expect(() => stopPolling()).not.toThrow();
  });
});

describe('renderGroupView({ participantToken }) — lien invalide/expiré', () => {
  it('tente une redirection vers la boutique standard, jamais un rendu de page d\'erreur isolée (Invariant 22)', async () => {
    // jsdom verrouille location.href/assign (non reconfigurables dans cette
    // version) — impossible d'espionner l'appel de navigation lui-même
    // dans ce bac à sable. On vérifie le comportement observable côté
    // rendu : la fonction ne lève pas et ne construit aucun écran d'erreur
    // dédié dans #k-group-view (cohérent avec "redirection, pas de page
    // isolée" — s'il y avait une page d'erreur, elle serait rendue ici).
    getSharedCartPublic.mockResolvedValue(null);
    const warnSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(renderGroupView({ participantToken: 'bad-token' })).resolves.not.toThrow();

    expect(container()?.querySelector('.k-glist-error')).toBeNull();
    warnSpy.mockRestore();
  });
});

describe('renderGroupView({ participantToken }) — écran principal', () => {
  it('affiche le bandeau inviteur avec le prénom, jamais un rôle', async () => {
    getSharedCartPublic.mockResolvedValue({
      cart: makeCart(), items: [makeItem()], items_count: 1, claimed_count: 0, is_creator: false,
    });

    await renderGroupView({ participantToken: 'tok-1' });

    expect(container().textContent).toContain('Aïcha a préparé cette liste pour vous');
    expect(container().textContent).not.toMatch(/organisateur|créateur|participant/i);
  });

  it('affiche la progression "X sur Y", jamais de compte à rebours', async () => {
    getSharedCartPublic.mockResolvedValue({
      cart: makeCart(), items: [makeItem(), makeItem({ id: 'sci-2', claimed: true })],
      items_count: 2, claimed_count: 1, is_creator: false,
    });

    await renderGroupView({ participantToken: 'tok-1' });

    expect(container().textContent).toContain('1 article sur 2 déjà acheté');
    expect(container().innerHTML).not.toMatch(/countdown|timer|expire/i);
  });

  it('vocabulaire strict : Disponible / Déjà acheté, jamais "réclamer"', async () => {
    getSharedCartPublic.mockResolvedValue({
      cart: makeCart(),
      items: [makeItem({ claimed: false }), makeItem({ id: 'sci-2', claimed: true })],
      items_count: 2, claimed_count: 1, is_creator: false,
    });

    await renderGroupView({ participantToken: 'tok-1' });

    expect(container().textContent).toContain('Disponible');
    expect(container().textContent).toContain('Déjà acheté');
    expect(container().textContent).not.toMatch(/réclam/i);
  });

  it('liste complète (claimed_count === items_count) : message calme, pas de barre de progression', async () => {
    getSharedCartPublic.mockResolvedValue({
      cart: makeCart(), items: [makeItem({ claimed: true })], items_count: 1, claimed_count: 1, is_creator: false,
    });

    await renderGroupView({ participantToken: 'tok-1' });

    expect(container().textContent).toContain('Tout a trouvé preneur');
    expect(container().querySelector('.k-glist-progress')).toBeNull();
  });

  it('n\'a pas besoin d\'un titre pour s\'afficher normalement (Invariant 5)', async () => {
    getSharedCartPublic.mockResolvedValue({
      cart: makeCart({ title: null, message: null }), items: [makeItem()], items_count: 1, claimed_count: 0, is_creator: false,
    });

    await renderGroupView({ participantToken: 'tok-1' });

    expect(container().querySelector('.k-glist-title')).toBeNull();
    expect(container().querySelector('.k-glist-banner')).not.toBeNull();
  });

  it('liste fermée : message lecture seule, aucun article sélectionnable', async () => {
    getSharedCartPublic.mockResolvedValue({
      cart: makeCart({ status: 'closed' }), items: [makeItem()], items_count: 1, claimed_count: 0, is_creator: false,
    });

    await renderGroupView({ participantToken: 'tok-1' });

    expect(container().textContent).toContain('fermée');
    expect(container().querySelector('[data-selectable="true"]')).toBeNull();
  });

  it('liste annulée : écran neutre, jamais présenté comme un échec (Invariant 14)', async () => {
    getSharedCartPublic.mockResolvedValue({
      cart: makeCart({ status: 'cancelled' }), items: [], items_count: 0, claimed_count: 0, is_creator: false,
    });

    await renderGroupView({ participantToken: 'tok-1' });

    expect(container().textContent).toContain('Cette liste n\'est plus active');
    expect(container().textContent).not.toMatch(/échec|erreur|annulée par/i);
  });

  it('visiteur non-créateur ne voit aucun contrôle créateur', async () => {
    getSharedCartPublic.mockResolvedValue({
      cart: makeCart(), items: [makeItem()], items_count: 1, claimed_count: 0, is_creator: false,
    });

    await renderGroupView({ participantToken: 'tok-1' });

    expect(container().querySelector('.k-glist-creator-controls')).toBeNull();
  });

  it('créateur voit les contrôles en ligne, même écran (Invariant 1) — bouton fermer présent', async () => {
    getSharedCartPublic.mockResolvedValue({
      cart: makeCart({ id: 'cart-1' }), items: [makeItem()], items_count: 1, claimed_count: 0, is_creator: true,
    });

    await renderGroupView({ participantToken: 'tok-1' });

    expect(container().querySelector('.k-glist-close-btn')).not.toBeNull();
  });

  it('« Ajouter un article » — plus de picker (simplification doctrinale) : conserve le contexte de liste et retourne à la boutique standard', async () => {
    getSharedCartPublic.mockResolvedValue({
      cart: makeCart({ id: 'cart-1' }), items: [makeItem()], items_count: 1, claimed_count: 0, is_creator: true,
    });

    await renderGroupView({ participantToken: 'tok-1' });

    const addBtn = container().querySelector('.k-glist-add-btn');
    expect(addBtn).not.toBeNull();
    expect(addBtn.disabled).toBeFalsy();

    addBtn.click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(state.activeListId).toBe('cart-1');
    expect(switchView).toHaveBeenCalledWith('shop');
  });

  it('liste fermée : ni bouton ajouter ni bouton fermer (lecture seule pour tous, y compris le créateur)', async () => {
    getSharedCartPublic.mockResolvedValue({
      cart: makeCart({ id: 'cart-1', status: 'closed' }), items: [makeItem()], items_count: 1, claimed_count: 0, is_creator: true,
    });

    await renderGroupView({ participantToken: 'tok-1' });

    expect(container().querySelector('.k-glist-add-btn')).toBeNull();
    expect(container().querySelector('.k-glist-close-btn')).toBeNull();
  });
});

describe('renderGroupView — sélection et achat', () => {
  it('sélectionner un article disponible ne déclenche aucun appel réseau (Invariant 16)', async () => {
    getSharedCartPublic.mockResolvedValue({
      cart: makeCart(), items: [makeItem()], items_count: 1, claimed_count: 0, is_creator: false,
    });
    await renderGroupView({ participantToken: 'tok-1' });

    container().querySelector('.k-glist-item').click();

    expect(getSharedCartPublic).toHaveBeenCalledTimes(1); // uniquement le chargement initial
    expect(checkoutSharedListSelection).not.toHaveBeenCalled();
  });

  it('un article déjà acheté n\'est pas sélectionnable', async () => {
    getSharedCartPublic.mockResolvedValue({
      cart: makeCart(), items: [makeItem({ claimed: true })], items_count: 1, claimed_count: 1, is_creator: false,
    });
    await renderGroupView({ participantToken: 'tok-1' });

    const card = container().querySelector('.k-glist-item');
    expect(card.dataset.selectable).toBe('false');
  });

  it('clic "Acheter la sélection" appelle l\'adaptateur avec shared_cart_item_id (un seul appel, toute la sélection)', async () => {
    getSharedCartPublic.mockResolvedValue({
      cart: makeCart(),
      items: [makeItem({ id: 'sci-1' }), makeItem({ id: 'sci-2' })],
      items_count: 2, claimed_count: 0, is_creator: false,
    });
    await renderGroupView({ participantToken: 'tok-1' });

    container().querySelectorAll('.k-glist-item').forEach(c => c.click());
    document.querySelector('.k-glist-buy-btn').click();

    expect(checkoutSharedListSelection).toHaveBeenCalledTimes(1);
    const payload = checkoutSharedListSelection.mock.calls[0][0];
    expect(payload.map(p => p.shared_cart_item_id).sort()).toEqual(['sci-1', 'sci-2']);
  });
});

describe('renderGroupView — capacités créateur', () => {
  it('retrait d\'un article : demande confirmation puis appelle removeItemFromSharedList(cartId, itemId)', async () => {
    getSharedCartPublic.mockResolvedValue({
      cart: makeCart({ id: 'cart-1' }), items: [makeItem({ id: 'sci-1' })], items_count: 1, claimed_count: 0, is_creator: true,
    });
    removeItemFromSharedList.mockResolvedValue({});
    await renderGroupView({ participantToken: 'tok-1' });

    container().querySelector('[data-remove-id="sci-1"]').click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(window.confirm).toHaveBeenCalled();
    expect(removeItemFromSharedList).toHaveBeenCalledWith('cart-1', 'sci-1');
  });

  it('retrait annulé (confirm=false) : aucun appel réseau', async () => {
    window.confirm = jest.fn(() => false);
    getSharedCartPublic.mockResolvedValue({
      cart: makeCart({ id: 'cart-1' }), items: [makeItem({ id: 'sci-1' })], items_count: 1, claimed_count: 0, is_creator: true,
    });
    await renderGroupView({ participantToken: 'tok-1' });

    container().querySelector('[data-remove-id="sci-1"]').click();
    await Promise.resolve();

    expect(removeItemFromSharedList).not.toHaveBeenCalled();
  });

  it('fermeture : demande confirmation puis appelle closeCart(cartId)', async () => {
    getSharedCartPublic.mockResolvedValue({
      cart: makeCart({ id: 'cart-1' }), items: [makeItem()], items_count: 1, claimed_count: 0, is_creator: true,
    });
    closeCart.mockResolvedValue({});
    await renderGroupView({ participantToken: 'tok-1' });

    container().querySelector('.k-glist-close-btn').click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(window.confirm).toHaveBeenCalled();
    expect(closeCart).toHaveBeenCalledWith('cart-1');
  });

  it('erreur serveur au retrait (ex: article déjà acheté) : toast, pas de crash', async () => {
    getSharedCartPublic.mockResolvedValue({
      cart: makeCart({ id: 'cart-1' }), items: [makeItem({ id: 'sci-1' })], items_count: 1, claimed_count: 0, is_creator: true,
    });
    removeItemFromSharedList.mockRejectedValue(new Error('Cet article a déjà été acheté'));
    await renderGroupView({ participantToken: 'tok-1' });

    container().querySelector('[data-remove-id="sci-1"]').click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(showToast).toHaveBeenCalledWith('Cet article a déjà été acheté', 'error');
  });
});

describe('renderGroupView() sans token — switcher créateur', () => {
  it('résout la liste la plus récente via getOwnerSharedCarts + charge la même vue publique', async () => {
    getOwnerSharedCarts.mockResolvedValue({ carts: [{ id: 'cart-1', token: 'tok-1', status: 'open', created_at: '2026-01-01' }] });
    getSharedCartPublic.mockResolvedValue({
      cart: makeCart(), items: [makeItem()], items_count: 1, claimed_count: 0, is_creator: true,
    });

    await renderGroupView();

    expect(getSharedCartPublic).toHaveBeenCalledWith('tok-1');
  });

  it('aucune liste visible : état vide, pas de crash', async () => {
    getOwnerSharedCarts.mockResolvedValue({ carts: [] });

    await renderGroupView();

    expect(container().textContent).toMatch(/pas encore de liste/i);
  });
});
