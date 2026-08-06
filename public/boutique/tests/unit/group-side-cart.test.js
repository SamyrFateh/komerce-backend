/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * @komerce-arch-lite
 * @role          shared-cart-snapshot-controller-tests
 * @domain        shared-cart
 * @layer         test
 * @status        production
 * @owner         public/boutique/tests/unit/group-side-cart.test.js
 * @purpose       Tests unitaires de js/group/group-side-cart.js en tant que
 *                contrôleur pur (Lot A/D) : plus aucun HTML de ligne testé
 *                ici (démantelé, voir b-cart.test.js). Couvre chargement du
 *                snapshot, adaptation du payload en contrat contextuel,
 *                calcul des capacités, transmission du contexte à b-cart.js,
 *                ouverture/rafraîchissement (dont conflit
 *                shared_cart_item_already_claimed), absence de boucle
 *                d'événements et absence de sélection locale.
 * @impact-areas  shared-cart, cart, boutique
 * @version       2026-08-lotD
 */
'use strict';

/**
 * tests/unit/group-side-cart.test.js — Lot D (refactor soustractif shared-cart, clôture)
 *
 * Périmètre Catégorie C du mandat de clôture : ce fichier ne teste plus
 * aucun HTML de ligne (retiré avec le panneau parallèle démantelé en Lot A
 * — voir tests/unit/b-cart.test.js pour le rendu des lignes, personnel et
 * snapshot). Il couvre uniquement le rôle de contrôleur pur de
 * group-side-cart.js :
 *
 *   - chargement du snapshot (activateSharedListContext / activateFromParticipantUrl)
 *   - adaptation du payload → contexte contractuel transmis à b-cart.js
 *   - calcul des capacités (lignes/total disponibles, non réclamées)
 *   - transmission du contexte à b-cart.js (renderCartSnapshot, jamais de
 *     HTML construit ici)
 *   - ouverture et rafraîchissement (drawer mobile, refresh après mutation
 *     ou conflit already_claimed)
 *   - absence de boucle d'événements (side-cart:render n'est plus émis par
 *     ce module à chaque rendu, et l'écouteur ne rappelle jamais le
 *     renderer)
 *   - absence de sélection locale (aucun state.sharedListSelection ;
 *     "disponible" = non réclamé, jamais un sous-ensemble choisi par clic)
 *
 * Lot D+ (correctif cycle d'import, point ouvert #2 rapport clôture Lot D) :
 * group-side-cart.js n'importe plus b-cart.js — il émet 'cart-snapshot:render'
 * / 'cart-snapshot:cleanup' sur b-bus.js, consommés par b-cart.js en
 * production. Ici, on espionne directement ces deux événements plutôt que de
 * mocker un import qui n'existe plus : mêmes assertions qu'avant (contexte/
 * items/actions transmis), sans dépendre du rendu réel. group-api.js et
 * group-checkout-adapter.js sont mockés (frontières réseau/checkout, hors
 * périmètre). b-store.js et b-bus.js sont réels (convention des autres
 * suites boutique).
 */

jest.mock('../../js/b-utils.js', () => {
  const actual = jest.requireActual('../../js/b-utils.js');
  return { ...actual, showToast: jest.fn() };
});

jest.mock('../../js/b-scroll-owner.js', () => ({
  isDesktop: jest.fn(() => false),
  getScrollY: jest.fn(() => 0),
  scrollToPosition: jest.fn(),
}));

jest.mock('../../js/group/group-api.js', () => ({
  getSharedCartPublic: jest.fn(),
  saveSharedCart: jest.fn(),
  removeItemFromSharedList: jest.fn(),
  closeCart: jest.fn(),
  updateSharedListItemQuantity: jest.fn(),
}));

jest.mock('../../js/group/group-checkout-adapter.js', () => ({
  checkoutSharedListSelection: jest.fn(() => true),
}));

const { state, dom, initDom } = require('../../js/b-store.js');
const { bus } = require('../../js/b-bus.js');
const { showToast } = require('../../js/b-utils.js');
const { isDesktop } = require('../../js/b-scroll-owner.js');
const {
  getSharedCartPublic,
} = require('../../js/group/group-api.js');
const { checkoutSharedListSelection } = require('../../js/group/group-checkout-adapter.js');

// Espions sur les 2 événements bus consommés par b-cart.js en production
// (voir note Lot D+ ci-dessus). Enregistrés une seule fois ; clearMocks
// (config Jest) réinitialise l'historique d'appels entre chaque test sans
// désabonner ces listeners, exactement comme l'ancien mock module.
const renderCartSnapshot = jest.fn();
const cleanupCartSnapshotDom = jest.fn();
bus.on('cart-snapshot:render', ({ context, items, actions }) => renderCartSnapshot(context, items, actions));
bus.on('cart-snapshot:cleanup', () => cleanupCartSnapshotDom());

const {
  activateSharedListContext,
  activateFromParticipantUrl,
  refreshSharedListContext,
  clearSharedListContext,
  exitSharedListRenderMode,
  setCartSurface,
  toggleEditMode,
  renderSharedListInCart,
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

function payload(overrides = {}) {
  return Object.assign({
    cart: {
      id: 'sc1',
      token: 'tok-1',
      status: 'open',
      creator_first_name: 'Awa',
      title: 'Liste de courses',
      message: null,
    },
    items: [
      { id: 'i1', product_id: 'p1', name: 'Riz', unit_price_kmf: 1000, quantity: 2, claimed: false },
      { id: 'i2', product_id: 'p2', name: 'Huile', unit_price_kmf: 3000, quantity: 1, claimed: true },
    ],
    is_creator: false,
  }, overrides);
}

beforeEach(() => {
  jest.clearAllMocks();
  mountShell();
  state.sharedListContext = {
    sharedCartId: null, token: null, status: 'open', isCreator: false,
    creatorFirstName: null, title: null, message: null, items: [],
  };
  state.sharedListEditMode = false;
  state.cartSurface = 'personal';
  state.cart = [];
  state.products = [{ id: 'p1', name: 'Riz' }, { id: 'p2', name: 'Huile' }];
  state.savedListTokensThisSession = new Set();
  state.modalReturnSurface = null;
  isDesktop.mockReturnValue(false);
});

describe('group-side-cart — chargement du snapshot', () => {
  it('activateSharedListContext peuple state.sharedListContext depuis le payload et bascule cartSurface', () => {
    activateSharedListContext(payload(), 'tok-1');

    expect(state.sharedListContext.sharedCartId).toBe('sc1');
    expect(state.sharedListContext.token).toBe('tok-1');
    expect(state.sharedListContext.status).toBe('open');
    expect(state.sharedListContext.creatorFirstName).toBe('Awa');
    expect(state.sharedListContext.items).toHaveLength(2);
    expect(state.cartSurface).toBe('shared-list');
  });

  it('payload sans cart → no-op strict (aucun state modifié)', () => {
    activateSharedListContext({}, 'tok-1');
    expect(state.sharedListContext.token).toBeNull();
    expect(state.cartSurface).toBe('personal');
    expect(renderCartSnapshot).not.toHaveBeenCalled();
  });

  it('changement de token → réinitialise le mode édition ; même token (refresh) → le préserve', () => {
    activateSharedListContext(payload({ is_creator: true }), 'tok-1');
    toggleEditMode();
    expect(state.sharedListEditMode).toBe(true);

    // Même liste (refresh) : le mode édition survit.
    activateSharedListContext(payload({ is_creator: true }), 'tok-1');
    expect(state.sharedListEditMode).toBe(true);

    // Lien différent ouvert : le mode édition ne doit pas fuiter sur l'autre liste.
    activateSharedListContext(
      payload({ is_creator: true, cart: { ...payload().cart, token: 'tok-2' } }),
      'tok-2'
    );
    expect(state.sharedListEditMode).toBe(false);
  });

  it('activateFromParticipantUrl : lien valide active le contexte, lien invalide affiche un toast et ne modifie rien', async () => {
    getSharedCartPublic.mockResolvedValueOnce(payload());
    const ok = await activateFromParticipantUrl('tok-1');
    expect(ok).toBe(true);
    expect(state.sharedListContext.token).toBe('tok-1');

    getSharedCartPublic.mockResolvedValueOnce(null);
    const ko = await activateFromParticipantUrl('tok-invalide');
    expect(ko).toBe(false);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('invalide'), 'error');
  });
});

describe('group-side-cart — adaptation du payload (contrat contextuel)', () => {
  it('transmet un contexte {source, readOnly, title, status, organizerName, isOrganizer} conforme au contrat', () => {
    activateSharedListContext(payload({ is_creator: true }), 'tok-1');

    const [context] = renderCartSnapshot.mock.calls.at(-1);
    expect(context).toMatchObject({
      source: 'shared-snapshot',
      readOnly: false,
      status: 'open',
      isOrganizer: true,
    });
  });

  it('readOnly reflète le statut de la liste (fermée = lecture seule)', () => {
    activateSharedListContext(payload({ cart: { ...payload().cart, status: 'closed' } }), 'tok-1');
    const [context] = renderCartSnapshot.mock.calls.at(-1);
    expect(context.readOnly).toBe(true);
  });

  it("showSaveAction/saved : uniquement pour un participant (non organisateur), pas l'organisateur", () => {
    activateSharedListContext(payload({ is_creator: false }), 'tok-1');
    let [context] = renderCartSnapshot.mock.calls.at(-1);
    expect(context.showSaveAction).toBe(true);
    expect(context.saved).toBe(false);

    renderCartSnapshot.mockClear();
    activateSharedListContext(payload({ is_creator: true }), 'tok-1');
    [context] = renderCartSnapshot.mock.calls.at(-1);
    expect(context.showSaveAction).toBe(false);
  });
});

describe('group-side-cart — calcul des capacités', () => {
  it('availableCount/availableTotal excluent les lignes réclamées', () => {
    activateSharedListContext(payload(), 'tok-1');
    const [context] = renderCartSnapshot.mock.calls.at(-1);
    // i1 (2 x 1000, non réclamé) compte ; i2 (réclamé) exclu.
    expect(context.availableCount).toBe(1);
    expect(context.availableTotal).toBe(2000);
  });

  it('tout est réclamé → capacités à zéro', () => {
    activateSharedListContext(
      payload({ items: [{ id: 'i1', product_id: 'p1', name: 'Riz', unit_price_kmf: 1000, quantity: 1, claimed: true }] }),
      'tok-1'
    );
    const [context] = renderCartSnapshot.mock.calls.at(-1);
    expect(context.availableCount).toBe(0);
    expect(context.availableTotal).toBe(0);
  });
});

describe('group-side-cart — transmission du contexte à b-cart.js', () => {
  it('délègue le rendu à renderCartSnapshot(context, items, actions) — jamais de HTML construit ici', () => {
    // Desktop : un seul cycle de rendu (mobile en ajoute un second via
    // reopenSharedListCart(), couvert séparément dans "ouverture et
    // rafraîchissement" — pas une boucle, juste l'ouverture du drawer).
    isDesktop.mockReturnValue(true);
    activateSharedListContext(payload(), 'tok-1');

    expect(renderCartSnapshot).toHaveBeenCalledTimes(1);
    const [, items, actions] = renderCartSnapshot.mock.calls[0];
    expect(items).toBe(state.sharedListContext.items);
    expect(actions).toEqual(expect.objectContaining({
      onToggleEditMode: expect.any(Function),
      onRemove: expect.any(Function),
      onQuantityStep: expect.any(Function),
      onOpenProduct: expect.any(Function),
      onShare: expect.any(Function),
      onClose: expect.any(Function),
      onBuy: expect.any(Function),
      onSave: expect.any(Function),
    }));
  });

  it('clearSharedListContext / setCartSurface("personal") nettoient le DOM snapshot via cleanupCartSnapshotDom, sans reconstruire de panneau', () => {
    activateSharedListContext(payload(), 'tok-1');
    clearSharedListContext();

    expect(cleanupCartSnapshotDom).toHaveBeenCalled();
    expect(state.sharedListContext.token).toBeNull();
    expect(state.cartSurface).toBe('personal');
    expect(document.getElementById('k-shared-list-panel')).toBeNull();
  });

  it('exitSharedListRenderMode : no-op tant que le contexte est actif, nettoie sinon', () => {
    activateSharedListContext(payload(), 'tok-1');
    cleanupCartSnapshotDom.mockClear();

    exitSharedListRenderMode();
    expect(cleanupCartSnapshotDom).not.toHaveBeenCalled();

    state.sharedListContext.token = null;
    exitSharedListRenderMode();
    expect(cleanupCartSnapshotDom).toHaveBeenCalled();
  });

  it('shared_cart_item_id et le contexte de prix snapshot sont préservés vers le checkout canonique (achat des lignes disponibles)', () => {
    activateSharedListContext(payload(), 'tok-1');
    const [, , actions] = renderCartSnapshot.mock.calls.at(-1);

    actions.onBuy();

    expect(checkoutSharedListSelection).toHaveBeenCalledTimes(1);
    const [cartItems] = checkoutSharedListSelection.mock.calls[0];
    expect(cartItems).toHaveLength(1); // seule i1 (non réclamé) est achetable
    expect(cartItems[0]).toMatchObject({
      shared_cart_item_id: 'i1',
      quantity: 2,
      product: { id: 'p1' },
      shared_list_context: expect.objectContaining({ snapshot_unit_price_kmf: 1000 }),
    });
  });
});

describe('group-side-cart — ouverture et rafraîchissement', () => {
  it("mobile : activation ouvre automatiquement le drawer ; desktop : ne l'ouvre pas (panneau persistant déjà visible)", () => {
    isDesktop.mockReturnValue(false);
    activateSharedListContext(payload(), 'tok-1');
    expect(dom.cartDrawer.classList.contains('open')).toBe(true);

    dom.cartDrawer.classList.remove('open');
    isDesktop.mockReturnValue(true);
    activateSharedListContext(payload(), 'tok-2');
    expect(dom.cartDrawer.classList.contains('open')).toBe(false);
  });

  it('refreshSharedListContext recharge depuis le backend et réapplique le contexte', async () => {
    activateSharedListContext(payload(), 'tok-1');
    getSharedCartPublic.mockResolvedValueOnce(payload({ items: [] }));

    await refreshSharedListContext();

    expect(getSharedCartPublic).toHaveBeenCalledWith('tok-1');
    expect(state.sharedListContext.items).toHaveLength(0);
  });

  it("refreshSharedListContext : lien devenu invalide → efface le contexte plutôt que d'afficher un état incohérent", async () => {
    activateSharedListContext(payload(), 'tok-1');
    getSharedCartPublic.mockResolvedValueOnce(null);

    await refreshSharedListContext();

    expect(state.sharedListContext.token).toBeNull();
    expect(state.cartSurface).toBe('personal');
  });

  it('conflit shared_cart_item_already_claimed (checkout:order-failed) → rafraîchit la liste et informe sans blâmer', async () => {
    activateSharedListContext(payload(), 'tok-1');
    getSharedCartPublic.mockResolvedValueOnce(payload({ items: [] }));

    bus.emit('checkout:order-failed', { code: 'shared_cart_item_already_claimed' });
    await Promise.resolve();
    await Promise.resolve();

    expect(getSharedCartPublic).toHaveBeenCalledWith('tok-1');
    expect(showToast).toHaveBeenCalled();
  });

  it("un code d'échec de commande sans rapport avec la liste n'entraîne aucun rafraîchissement", async () => {
    activateSharedListContext(payload(), 'tok-1');
    getSharedCartPublic.mockClear();

    bus.emit('checkout:order-failed', { code: 'insufficient_stock' });
    await Promise.resolve();

    expect(getSharedCartPublic).not.toHaveBeenCalled();
  });
});

describe("group-side-cart — absence de boucle d'événements", () => {
  it('activateSharedListContext / renderSharedListInCart ne réémettent pas side-cart:render eux-mêmes', () => {
    const spy = jest.fn();
    bus.on('side-cart:render', spy);

    activateSharedListContext(payload(), 'tok-1');
    spy.mockClear();
    renderSharedListInCart();

    expect(spy).not.toHaveBeenCalled();
    bus.off('side-cart:render', spy);
  });

  it("l'écouteur side-cart:render ne rappelle jamais renderCartSnapshot (pas de second cycle de rendu déclenché par lui-même)", () => {
    activateSharedListContext(payload(), 'tok-1');
    renderCartSnapshot.mockClear();

    bus.emit('side-cart:render');

    expect(renderCartSnapshot).not.toHaveBeenCalled();
  });

  it('setCartSurface émet side-cart:render une seule fois par appel (pas de double émission)', () => {
    const spy = jest.fn();
    bus.on('side-cart:render', spy);

    setCartSurface('personal');

    expect(spy).toHaveBeenCalledTimes(1);
    bus.off('side-cart:render', spy);
  });
});

describe('group-side-cart — absence de sélection locale', () => {
  it('aucun état de sélection locale : "disponible" est calculé uniquement depuis items[].claimed, jamais depuis un choix utilisateur', () => {
    activateSharedListContext(payload(), 'tok-1');
    // Lot D (audit de clôture) : sharedListSelection a été retiré de
    // b-store.js — zéro producteur/consommateur restant après le passage
    // à la doctrine "disponible = non réclamé" (Lot B). Absent de state,
    // pas seulement vide.
    expect(Object.prototype.hasOwnProperty.call(state, 'sharedListSelection')).toBe(false);

    const [context] = renderCartSnapshot.mock.calls.at(-1);
    // 1 seule ligne non réclamée dans le fixture ; aucune API de sélection
    // (toggle/clear) n'existe plus sur le module.
    expect(context.availableCount).toBe(1);
    const mod = require('../../js/group/group-side-cart.js');
    expect(typeof mod.toggleSharedListItem).toBe('undefined');
  });

  it('handleBuyAvailableItems achète systématiquement toutes les lignes disponibles, sans sous-ensemble sélectionné', () => {
    activateSharedListContext(
      payload({
        items: [
          { id: 'i1', product_id: 'p1', name: 'Riz', unit_price_kmf: 1000, quantity: 1, claimed: false },
          { id: 'i2', product_id: 'p2', name: 'Huile', unit_price_kmf: 3000, quantity: 1, claimed: false },
        ],
      }),
      'tok-1'
    );
    const [, , actions] = renderCartSnapshot.mock.calls.at(-1);

    actions.onBuy();

    const [cartItems] = checkoutSharedListSelection.mock.calls[0];
    expect(cartItems).toHaveLength(2);
  });
});
