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
  addItemToSharedList: jest.fn(),
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
  addItemToSharedList,
  closeCart,
  removeItemFromSharedList,
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
  renderSharedListInCart,
  canAddToActiveSharedList,
  addProductToActiveSharedList,
  reopenSharedListCart,
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
  // GAP-04 — isPollableNow() exige body.k-view-shop. Le shell de test
  // simule la vue Boutique par défaut, précondition réaliste pour tout
  // scénario de rafraîchissement/polling de liste partagée.
  document.body.classList.add('k-view-shop');
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

afterEach(() => {
  // Toute activation démarre potentiellement la boucle de polling
  // (setInterval réel) : la détruire systématiquement évite un handle qui
  // fuite d'un test à l'autre (mandat "une seule boucle, détruite hors
  // contexte", lot temps réel 2026-08).
  clearSharedListContext();
  jest.useRealTimers();
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

  // Doctrine finale (2026-08) — editMode n'est plus une bascule persistée :
  // il est recalculé à chaque rendu depuis isCreator + statut de la liste
  // (voir buildSnapshotRenderContext). Changer de token n'a donc plus
  // besoin de "réinitialiser" quoi que ce soit : le contexte suivant est
  // simplement recalculé pour la nouvelle liste.
  it('editMode se recalcule à chaque activation depuis isCreator + statut, jamais depuis un état sticky', () => {
    activateSharedListContext(payload({ is_creator: true }), 'tok-1');
    let [context] = renderCartSnapshot.mock.calls.at(-1);
    expect(context.editMode).toBe(true);

    activateSharedListContext(
      payload({ is_creator: false, cart: { ...payload().cart, token: 'tok-2' } }),
      'tok-2'
    );
    [context] = renderCartSnapshot.mock.calls.at(-1);
    expect(context.editMode).toBe(false);
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

describe('group-side-cart — calcul des capacités (disponible = non réclamé)', () => {
  it('availableCount/availableTotal totalisent les lignes non réclamées uniquement', () => {
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

  it('deux lignes disponibles → availableTotal cumule les deux, jamais une seule', () => {
    const twoAvailable = payload({
      items: [
        { id: 'i1', product_id: 'p1', name: 'Riz', unit_price_kmf: 1000, quantity: 1, claimed: false },
        { id: 'i2', product_id: 'p2', name: 'Huile', unit_price_kmf: 3000, quantity: 1, claimed: false },
      ],
    });
    activateSharedListContext(twoAvailable, 'tok-1');
    const [context] = renderCartSnapshot.mock.calls.at(-1);
    expect(context.availableCount).toBe(2);
    expect(context.availableTotal).toBe(4000);
  });

  it('une ligne réclamée entre-temps sort des capacités disponibles après refresh, sans planter', async () => {
    activateSharedListContext(payload(), 'tok-1'); // i1 disponible

    getSharedCartPublic.mockResolvedValueOnce(payload({
      items: [{ id: 'i1', product_id: 'p1', name: 'Riz', unit_price_kmf: 1000, quantity: 2, claimed: true, buyer_first_name: 'Ali' }],
    }));
    await refreshSharedListContext();

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
      onRemove: expect.any(Function),
      onQuantityStep: expect.any(Function),
      onOpenProduct: expect.any(Function),
      onShare: expect.any(Function),
      onClose: expect.any(Function),
      onBuySingle: expect.any(Function),
      onBuyAll: expect.any(Function),
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

  it('shared_cart_item_id et le contexte de prix snapshot sont préservés vers le checkout canonique (achat d\'une ligne unique)', () => {
    activateSharedListContext(payload(), 'tok-1');
    const [, , actions] = renderCartSnapshot.mock.calls.at(-1);

    actions.onBuySingle('i1');

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

  it('onBuyAll achète systématiquement toutes les lignes disponibles en une seule commande', () => {
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

    actions.onBuyAll();

    expect(checkoutSharedListSelection).toHaveBeenCalledTimes(1);
    const [cartItems] = checkoutSharedListSelection.mock.calls[0];
    expect(cartItems).toHaveLength(2);
  });

  it('P1 (audit) — "Tout acheter" avec une ligne dont le produit catalogue est introuvable : message honnête, jamais "retiré" (la ligne reste dans la liste)', () => {
    activateSharedListContext(
      payload({
        items: [
          { id: 'i1', product_id: 'p1', name: 'Riz', unit_price_kmf: 1000, quantity: 1, claimed: false },
          // p-ghost n'existe pas dans state.products (mounté ci-dessus avec
          // seulement p1/p2) — simule un produit désactivé/supprimé.
          { id: 'i-ghost', product_id: 'p-ghost', name: 'Fantôme', unit_price_kmf: 500, quantity: 1, claimed: false },
        ],
      }),
      'tok-1'
    );
    const [, , actions] = renderCartSnapshot.mock.calls.at(-1);

    actions.onBuyAll();

    // La ligne indisponible n'entre pas dans CE checkout...
    expect(checkoutSharedListSelection).toHaveBeenCalledTimes(1);
    const [cartItems] = checkoutSharedListSelection.mock.calls[0];
    expect(cartItems).toHaveLength(1);
    expect(cartItems[0].shared_cart_item_id).toBe('i1');

    // ...mais elle n'est JAMAIS retirée de la liste elle-même : ni de
    // state.sharedListContext.items, ni d'aucun appel réseau de
    // suppression. Le message ne doit donc jamais prétendre "retiré".
    expect(state.sharedListContext.items.find((it) => it.id === 'i-ghost')).toBeTruthy();
    expect(removeItemFromSharedList).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.not.stringMatching(/retiré/i),
      'info',
    );
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining("n'a pas été inclus dans cet achat"),
      'info',
    );
  });

  it('P1 — "Tout acheter" avec plusieurs lignes indisponibles : message au pluriel, toujours sans "retiré"', () => {
    activateSharedListContext(
      payload({
        items: [
          { id: 'i-ghost-1', product_id: 'p-ghost-1', name: 'Fantôme 1', unit_price_kmf: 500, quantity: 1, claimed: false },
          { id: 'i-ghost-2', product_id: 'p-ghost-2', name: 'Fantôme 2', unit_price_kmf: 700, quantity: 1, claimed: false },
        ],
      }),
      'tok-1'
    );
    const [, , actions] = renderCartSnapshot.mock.calls.at(-1);

    actions.onBuyAll();

    expect(checkoutSharedListSelection).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('2 articles de la liste'),
      'info',
    );
    expect(showToast).toHaveBeenCalledWith(
      expect.not.stringMatching(/retiré/i),
      'info',
    );
  });

  it('P1 — articles déjà réclamés (claimed) : exclus du calcul disponible/checkout sans déclencher le message "indisponible" (ce n\'est pas le même cas qu\'un produit introuvable)', () => {
    activateSharedListContext(
      payload({
        items: [
          { id: 'i1', product_id: 'p1', name: 'Riz', unit_price_kmf: 1000, quantity: 1, claimed: false },
          { id: 'i2', product_id: 'p2', name: 'Huile', unit_price_kmf: 3000, quantity: 1, claimed: true },
        ],
      }),
      'tok-1'
    );
    showToast.mockClear();
    const [, , actions] = renderCartSnapshot.mock.calls.at(-1);

    actions.onBuyAll();

    // availableItems() exclut déjà les lignes claimed en amont (calcul
    // "disponible" = non réclamé, cf. describe dédié plus haut) : seule i1
    // atteint handleBuyAllAvailable, i2 n'est jamais vue comme
    // "indisponible/exclue" — ce n'est pas un cas d'échec, donc aucun toast
    // "n'a pas été inclus" ne doit être émis pour elle.
    expect(checkoutSharedListSelection).toHaveBeenCalledTimes(1);
    const [cartItems] = checkoutSharedListSelection.mock.calls[0];
    expect(cartItems).toHaveLength(1);
    expect(cartItems[0].shared_cart_item_id).toBe('i1');
    expect(showToast).not.toHaveBeenCalledWith(
      expect.stringContaining('retiré'),
      expect.anything(),
    );
    expect(showToast).not.toHaveBeenCalledWith(
      expect.stringContaining("n'a pas été inclus"),
      expect.anything(),
    );
  });


  describe('onClose — fermeture d\'une liste (P0, audit)', () => {
    let confirmSpy;

    beforeEach(() => {
      confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
      closeCart.mockResolvedValue({});
    });

    afterEach(() => {
      confirmSpy.mockRestore();
    });

    it('après succès API, démonte intégralement le contexte (token=null, cartSurface=personal), jamais un simple refresh', async () => {
      activateSharedListContext(payload({ is_creator: true }), 'tok-1');
      const [, , actions] = renderCartSnapshot.mock.calls.at(-1);

      await actions.onClose();

      expect(closeCart).toHaveBeenCalledWith('sc1');
      // P0 — la régression auditée : l'ancien code rappelait
      // refreshSharedListContext() (même token, cartSurface toujours
      // 'shared-list') au lieu de démonter le contexte. getSharedCartPublic
      // ne doit donc JAMAIS être appelé ici (ce serait la signature d'un
      // refresh, pas d'un démontage).
      expect(getSharedCartPublic).not.toHaveBeenCalled();
      expect(state.sharedListContext.token).toBeNull();
      expect(state.sharedListContext.sharedCartId).toBeNull();
      expect(state.cartSurface).toBe('personal');
      expect(cleanupCartSnapshotDom).toHaveBeenCalled();
    });

    it('après fermeture, le prochain openCart (isSharedListSurfaceActive) revient au panier personnel', async () => {
      activateSharedListContext(payload({ is_creator: true }), 'tok-1');
      const [, , actions] = renderCartSnapshot.mock.calls.at(-1);

      await actions.onClose();

      // isSharedListSurfaceActive() est le garde utilisé par b-cart.js::
      // openCart() pour décider de projeter la liste ou le panier
      // personnel — après fermeture il doit être faux.
      const { isSharedListSurfaceActive } = require('../../js/group/group-side-cart.js');
      expect(isSharedListSurfaceActive()).toBe(false);
    });

    it("après fermeture, reopenSharedListCart() (drawer mobile) ne réaffiche pas la liste fermée — no-op car isActiveContext() est faux", async () => {
      activateSharedListContext(payload({ is_creator: true }), 'tok-1');
      const [, , actions] = renderCartSnapshot.mock.calls.at(-1);
      await actions.onClose();

      renderCartSnapshot.mockClear();
      reopenSharedListCart();

      expect(renderCartSnapshot).not.toHaveBeenCalled();
      expect(state.cartSurface).toBe('personal');
    });

    it('après fermeture, aucun contrôle d\'édition ne reste actif (editMode retombe, plus de token à éditer)', async () => {
      activateSharedListContext(payload({ is_creator: true }), 'tok-1');
      state.sharedListEditMode = true;
      const [, , actions] = renderCartSnapshot.mock.calls.at(-1);

      await actions.onClose();

      expect(state.sharedListEditMode).toBe(false);
      expect(state.sharedListContext.isCreator).toBe(false);
    });

    it('confirmation refusée par l\'utilisateur : aucun appel API, contexte inchangé', async () => {
      confirmSpy.mockReturnValue(false);
      activateSharedListContext(payload({ is_creator: true }), 'tok-1');
      const [, , actions] = renderCartSnapshot.mock.calls.at(-1);

      await actions.onClose();

      expect(closeCart).not.toHaveBeenCalled();
      expect(state.sharedListContext.token).toBe('tok-1');
    });

    it('participant (non organisateur) : onClose est un no-op, jamais de confirm ni d\'appel API', async () => {
      activateSharedListContext(payload({ is_creator: false }), 'tok-1');
      const [, , actions] = renderCartSnapshot.mock.calls.at(-1);

      await actions.onClose();

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(closeCart).not.toHaveBeenCalled();
      expect(state.sharedListContext.token).toBe('tok-1');
    });

    it('erreur API : le contexte reste actif (pas de démontage sur échec), toast d\'erreur affiché', async () => {
      closeCart.mockRejectedValueOnce(new Error('boom'));
      activateSharedListContext(payload({ is_creator: true }), 'tok-1');
      const [, , actions] = renderCartSnapshot.mock.calls.at(-1);

      await actions.onClose();

      expect(state.sharedListContext.token).toBe('tok-1');
      expect(state.cartSurface).toBe('shared-list');
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('boom'), 'error');
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

  it('onBuyAll achète toutes les lignes disponibles sans dépendre d\'un état de sélection quelconque', () => {
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

    actions.onBuyAll();

    const [cartItems] = checkoutSharedListSelection.mock.calls[0];
    expect(cartItems).toHaveLength(2);
  });
});

describe('group-side-cart — temps réel (fraîcheur du snapshot, lot 2026-08)', () => {
  it('démarre une seule boucle de polling même si le contexte est activé plusieurs fois', () => {
    jest.useFakeTimers();
    activateSharedListContext(payload(), 'tok-1');
    activateSharedListContext(payload(), 'tok-1');
    activateSharedListContext(payload(), 'tok-1');
    getSharedCartPublic.mockResolvedValue(payload());

    jest.advanceTimersByTime(4000);

    // Une seule boucle → un seul tick → un seul appel réseau déclenché par
    // le polling (les 3 activations initiales n'appellent pas
    // getSharedCartPublic elles-mêmes, seul le refresh en dépend).
    expect(getSharedCartPublic).toHaveBeenCalledTimes(1);
  });

  it("n'interroge pas le backend quand l'onglet est masqué ou hors surface shared-list", () => {
    jest.useFakeTimers();
    activateSharedListContext(payload(), 'tok-1');
    getSharedCartPublic.mockClear();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    jest.advanceTimersByTime(4000);
    expect(getSharedCartPublic).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    state.cartSurface = 'personal'; // ex. bascule vers le panier perso, contexte toujours actif en arrière-plan
    jest.advanceTimersByTime(4000);
    expect(getSharedCartPublic).not.toHaveBeenCalled();
  });

  it('la boucle est détruite quand le contexte est nettoyé — aucun tick ultérieur', () => {
    jest.useFakeTimers();
    activateSharedListContext(payload(), 'tok-1');
    clearSharedListContext();
    getSharedCartPublic.mockClear();

    jest.advanceTimersByTime(20000);

    expect(getSharedCartPublic).not.toHaveBeenCalled();
  });

  it('visibilitychange (retour visible) déclenche un refresh immédiat sans attendre le prochain tick', async () => {
    activateSharedListContext(payload(), 'tok-1');
    getSharedCartPublic.mockClear();
    getSharedCartPublic.mockResolvedValueOnce(payload());
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    expect(getSharedCartPublic).toHaveBeenCalledWith('tok-1');
  });

  it('un refresh silencieux (poll/mutation) ne rouvre jamais un drawer mobile que l\'utilisateur a fermé', async () => {
    isDesktop.mockReturnValue(false);
    activateSharedListContext(payload(), 'tok-1');
    dom.cartDrawer.classList.remove('open'); // l'utilisateur ferme le drawer manuellement
    getSharedCartPublic.mockResolvedValueOnce(payload({ items: [{ id: 'i1', product_id: 'p1', name: 'Riz', unit_price_kmf: 1000, quantity: 3, claimed: false }] }));

    await refreshSharedListContext();

    expect(dom.cartDrawer.classList.contains('open')).toBe(false);
    // Le contenu, lui, doit être à jour.
    expect(state.sharedListContext.items[0].quantity).toBe(3);
  });

  it('signature inchangée entre deux refresh silencieux → aucun second appel à renderCartSnapshot', async () => {
    activateSharedListContext(payload(), 'tok-1');
    renderCartSnapshot.mockClear();
    getSharedCartPublic.mockResolvedValueOnce(payload()); // exactement les mêmes lignes/statut

    await refreshSharedListContext();

    expect(renderCartSnapshot).not.toHaveBeenCalled();
  });

  it('signature changée (quantité modifiée) entre deux refresh silencieux → rerend bien', async () => {
    activateSharedListContext(payload(), 'tok-1');
    renderCartSnapshot.mockClear();
    getSharedCartPublic.mockResolvedValueOnce(
      payload({ items: [{ id: 'i1', product_id: 'p1', name: 'Riz', unit_price_kmf: 1000, quantity: 9, claimed: false }] })
    );

    await refreshSharedListContext();

    expect(renderCartSnapshot).toHaveBeenCalled();
  });

  // Mandat §12 — la signature doit couvrir TOUTES les données visibles
  // susceptibles de changer, pas seulement id/quantité/claimed. Ces 5 tests
  // isolent chacun un seul champ pour prouver qu'il est bien couvert
  // (avant correctif, aucun des 5 n'aurait déclenché de rerender).
  describe('§12 — signature couvre tous les champs visibles', () => {
    it('prix modifié (même quantité/claimed) → rerend', async () => {
      activateSharedListContext(payload(), 'tok-1');
      renderCartSnapshot.mockClear();
      getSharedCartPublic.mockResolvedValueOnce(
        payload({ items: [{ id: 'i1', product_id: 'p1', name: 'Riz', unit_price_kmf: 1500, quantity: 2, claimed: false }] })
      );

      await refreshSharedListContext();

      expect(renderCartSnapshot).toHaveBeenCalled();
    });

    it('image modifiée → rerend', async () => {
      activateSharedListContext(payload({ items: [{ id: 'i1', product_id: 'p1', name: 'Riz', image: 'https://cdn/a.jpg', unit_price_kmf: 1000, quantity: 2, claimed: false }] }), 'tok-1');
      renderCartSnapshot.mockClear();
      getSharedCartPublic.mockResolvedValueOnce(
        payload({ items: [{ id: 'i1', product_id: 'p1', name: 'Riz', image: 'https://cdn/b.jpg', unit_price_kmf: 1000, quantity: 2, claimed: false }] })
      );

      await refreshSharedListContext();

      expect(renderCartSnapshot).toHaveBeenCalled();
    });

    it('variant_combo modifié → rerend', async () => {
      activateSharedListContext(payload({ items: [{ id: 'i1', product_id: 'p1', name: 'Chemise', variant_combo: { couleur: 'Noir' }, unit_price_kmf: 1000, quantity: 1, claimed: false }] }), 'tok-1');
      renderCartSnapshot.mockClear();
      getSharedCartPublic.mockResolvedValueOnce(
        payload({ items: [{ id: 'i1', product_id: 'p1', name: 'Chemise', variant_combo: { couleur: 'Blanc' }, unit_price_kmf: 1000, quantity: 1, claimed: false }] })
      );

      await refreshSharedListContext();

      expect(renderCartSnapshot).toHaveBeenCalled();
    });

    it('titre de la liste modifié (mêmes lignes) → rerend', async () => {
      activateSharedListContext(payload({ cart: { ...payload().cart, title: 'Ancien titre' } }), 'tok-1');
      renderCartSnapshot.mockClear();
      getSharedCartPublic.mockResolvedValueOnce(
        payload({ cart: { ...payload().cart, title: 'Nouveau titre' } })
      );

      await refreshSharedListContext();

      expect(renderCartSnapshot).toHaveBeenCalled();
    });

    it('contributeurs modifiés (mêmes lignes) → rerend', async () => {
      activateSharedListContext(
        payload({ is_creator: true, contributors: [{ first_name: 'Ali', items_count: 2 }] }),
        'tok-1'
      );
      renderCartSnapshot.mockClear();
      getSharedCartPublic.mockResolvedValueOnce(
        payload({ is_creator: true, contributors: [{ first_name: 'Ali', items_count: 3 }] })
      );

      await refreshSharedListContext();

      expect(renderCartSnapshot).toHaveBeenCalled();
    });
  });

  it("n'interroge pas le backend hors de la vue Boutique (body sans k-view-shop)", () => {
    jest.useFakeTimers();
    activateSharedListContext(payload(), 'tok-1');
    document.body.classList.remove('k-view-shop');
    getSharedCartPublic.mockClear();

    jest.advanceTimersByTime(4000);

    expect(getSharedCartPublic).not.toHaveBeenCalled();
  });

  it('reprend le polling dès que la vue Boutique redevient active (body.k-view-shop)', () => {
    jest.useFakeTimers();
    activateSharedListContext(payload(), 'tok-1');
    document.body.classList.remove('k-view-shop');
    getSharedCartPublic.mockClear();
    getSharedCartPublic.mockResolvedValue(payload());

    document.body.classList.add('k-view-shop');
    jest.advanceTimersByTime(4000);

    expect(getSharedCartPublic).toHaveBeenCalledTimes(1);
  });
});

// Lot 3 GAP-07 — CTA "Ajouter à cette liste" depuis la fiche produit.
describe('canAddToActiveSharedList / addProductToActiveSharedList (Lot 3 GAP-07)', () => {
  it('canAddToActiveSharedList : false si aucun contexte actif', () => {
    expect(canAddToActiveSharedList()).toBe(false);
  });

  it('canAddToActiveSharedList : false pour un participant (isCreator=false)', () => {
    activateSharedListContext(payload({ is_creator: false }), 'tok-1');
    expect(canAddToActiveSharedList()).toBe(false);
  });

  it('canAddToActiveSharedList : false si la liste est fermée', () => {
    activateSharedListContext(
      payload({ is_creator: true, cart: { ...payload().cart, status: 'closed' } }),
      'tok-1'
    );
    expect(canAddToActiveSharedList()).toBe(false);
  });

  it('canAddToActiveSharedList : true pour le créateur, liste ouverte, surface shared-list (plus de mode édition à activer)', () => {
    activateSharedListContext(payload({ is_creator: true }), 'tok-1');
    expect(canAddToActiveSharedList()).toBe(true);
  });

  it('canAddToActiveSharedList : false si cartSurface !== "shared-list", même pour le créateur d\'une liste ouverte', () => {
    activateSharedListContext(payload({ is_creator: true }), 'tok-1');
    state.cartSurface = 'personal';
    expect(canAddToActiveSharedList()).toBe(false);
  });

  it('addProductToActiveSharedList : false et aucun appel réseau si produit invalide', async () => {
    activateSharedListContext(payload({ is_creator: true }), 'tok-1');
    const ok = await addProductToActiveSharedList(null, 1, null);
    expect(ok).toBe(false);
    expect(addItemToSharedList).not.toHaveBeenCalled();
  });

  it('addProductToActiveSharedList : false et aucun appel réseau si participant (garde-fou serveur reflété côté front)', async () => {
    activateSharedListContext(payload({ is_creator: false }), 'tok-1');
    const ok = await addProductToActiveSharedList({ id: 'prod-1', name: 'Robe' }, 1, null);
    expect(ok).toBe(false);
    expect(addItemToSharedList).not.toHaveBeenCalled();
  });

  it('addProductToActiveSharedList : false et aucun appel réseau si liste fermée', async () => {
    activateSharedListContext(
      payload({ is_creator: true, cart: { ...payload().cart, status: 'closed' } }),
      'tok-1'
    );
    const ok = await addProductToActiveSharedList({ id: 'prod-1', name: 'Robe' }, 1, null);
    expect(ok).toBe(false);
    expect(addItemToSharedList).not.toHaveBeenCalled();
  });

  it('addProductToActiveSharedList : succès → POST avec sharedCartId + variant_combo, refresh, toast succès', async () => {
    activateSharedListContext(payload({ is_creator: true }), 'tok-1');
    addItemToSharedList.mockResolvedValueOnce({ ok: true, item: { id: 'sci-new' } });
    getSharedCartPublic.mockResolvedValueOnce(payload({ is_creator: true }));

    const ok = await addProductToActiveSharedList(
      { id: 'prod-sku', name: 'Chemise' }, 1, { couleur: 'Noir', taille: 'M' }
    );

    expect(ok).toBe(true);
    expect(addItemToSharedList).toHaveBeenCalledWith('sc1', 'prod-sku', 1, { couleur: 'Noir', taille: 'M' });
    expect(getSharedCartPublic).toHaveBeenCalled(); // refreshSharedListContext
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Chemise'), 'success');
  });

  it('addProductToActiveSharedList : échec serveur (ex. combinaison indisponible) → false, toast erreur, jamais de refresh', async () => {
    activateSharedListContext(payload({ is_creator: true }), 'tok-1');
    const err = new Error('Combinaison indisponible pour Chemise');
    err.code = 'sellable_unit_not_found';
    addItemToSharedList.mockRejectedValueOnce(err);
    getSharedCartPublic.mockClear();

    const ok = await addProductToActiveSharedList(
      { id: 'prod-sku', name: 'Chemise' }, 1, { couleur: 'Rose' }
    );

    expect(ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Combinaison indisponible'), 'error');
    expect(getSharedCartPublic).not.toHaveBeenCalled();
  });

  it('addProductToActiveSharedList : variant_combo absent → transmis tel quel (null), jamais un objet fabriqué', async () => {
    activateSharedListContext(payload({ is_creator: true }), 'tok-1');
    addItemToSharedList.mockResolvedValueOnce({ ok: true, item: { id: 'sci-new' } });
    getSharedCartPublic.mockResolvedValueOnce(payload({ is_creator: true }));

    await addProductToActiveSharedList({ id: 'prod-simple', name: 'Sac' }, 2);

    expect(addItemToSharedList).toHaveBeenCalledWith('sc1', 'prod-simple', 2, null);
  });
});
