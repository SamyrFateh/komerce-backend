'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/group-checkout-adapter.test.js
 *
 * Module js/group/group-checkout-adapter.js — adaptateur entre une
 * sélection de liste partagée et le checkout canonique. Zéro modification
 * de b-checkout.js pour l'isolation du panier : ce test vérifie
 * exactement ce contrat, via l'observation réelle de dom.orderModal
 * (b-store.js), sans mock du mécanisme d'isolation lui-même.
 *
 * checkoutCart() est mocké — seul son déclenchement (ou non) est vérifié
 * ici, pas son comportement interne (couvert par b-checkout.test.js).
 */

jest.mock('../../js/b-checkout.js', () => ({
  checkoutCart: jest.fn(),
}));

const { state, dom, initDom } = require('../../js/b-store.js');
const { checkoutCart } = require('../../js/b-checkout.js');
const { checkoutSharedListSelection } = require('../../js/group/group-checkout-adapter.js');

function flushMutations() {
  // Les callbacks MutationObserver sont microtask — un tick suffit en jsdom.
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('checkoutSharedListSelection', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="k-order-modal"></div>';
    initDom();
    state.cart = [];
    jest.clearAllMocks();
  });

  it('retourne false et ne touche à rien si la sélection est vide', () => {
    const personalCart = [{ product: { id: 1 }, qty: 1 }];
    state.cart = personalCart;

    const result = checkoutSharedListSelection([]);

    expect(result).toBe(false);
    expect(checkoutCart).not.toHaveBeenCalled();
    expect(state.cart).toBe(personalCart);
  });

  it('retourne false si aucun item de la sélection n\'a shared_cart_item_id (garde-fou)', () => {
    const personalCart = [{ product: { id: 1 }, qty: 1 }];
    state.cart = personalCart;

    const result = checkoutSharedListSelection([{ product: { id: 9 }, quantity: 1 }]);

    expect(result).toBe(false);
    expect(checkoutCart).not.toHaveBeenCalled();
    expect(state.cart).toBe(personalCart);
  });

  it('construit un panier éphémère et déclenche checkoutCart()', () => {
    state.cart = [{ product: { id: 1 }, qty: 1 }]; // panier personnel avant

    const result = checkoutSharedListSelection([
      { shared_cart_item_id: 'sci-1', product: { id: 42, name: 'Riz' }, quantity: 2 },
    ]);

    expect(result).toBe(true);
    expect(checkoutCart).toHaveBeenCalledTimes(1);
    expect(state.cart).toEqual([
      { product: { id: 42, name: 'Riz' }, qty: 2, shared_cart_item_id: 'sci-1', variant_combo: null },
    ]);
  });

  // GAP-07 §12 — l'unité vendable (variant_combo) doit survivre jusqu'au
  // payload de commande via la ligne éphémère, jamais nichée sous
  // it.product (le catalogue générique, pas la combinaison choisie).
  it('propage variant_combo tel quel dans la ligne éphémère (GAP-07)', () => {
    const result = checkoutSharedListSelection([
      {
        shared_cart_item_id: 'sci-2', product: { id: 43, name: 'Chemise' },
        quantity: 1, variant_combo: { couleur: 'Noir', taille: 'M' },
      },
    ]);

    expect(result).toBe(true);
    expect(state.cart).toEqual([
      {
        product: { id: 43, name: 'Chemise' }, qty: 1,
        shared_cart_item_id: 'sci-2', variant_combo: { couleur: 'Noir', taille: 'M' },
      },
    ]);
  });

  it('conserve shared_cart_item_id et product.id distincts (mandat V2-E §1)', () => {
    checkoutSharedListSelection([
      { shared_cart_item_id: 'shared-item-1', product: { id: 'product-42' }, quantity: 1 },
    ]);
    const line = state.cart[0];
    expect(line.shared_cart_item_id).toBe('shared-item-1');
    expect(line.product.id).toBe('product-42');
    expect(line.product.id).not.toBe(line.shared_cart_item_id);
  });

  it('propage shared_list_context (métadonnées snapshot) quand fourni par l\'appelant (mandat V2-E §2)', () => {
    checkoutSharedListSelection([
      {
        shared_cart_item_id: 'sci-1',
        product: { id: 42, price_kmf: 7200 },
        quantity: 1,
        shared_list_context: { snapshot_unit_price_kmf: 6500, snapshot_name: 'Riz', snapshot_image_url: null },
      },
    ]);
    expect(state.cart[0].shared_list_context).toEqual({
      snapshot_unit_price_kmf: 6500,
      snapshot_name: 'Riz',
      snapshot_image_url: null,
    });
  });

  it('n\'ajoute pas de champ shared_list_context si absent de l\'appelant (pas de métadonnée fantôme)', () => {
    checkoutSharedListSelection([
      { shared_cart_item_id: 'sci-1', product: { id: 42 }, quantity: 1 },
    ]);
    expect(state.cart[0].shared_list_context).toBeUndefined();
  });

  it('quantity par défaut à 1 si absente', () => {
    checkoutSharedListSelection([{ shared_cart_item_id: 'sci-1', product: { id: 42 } }]);
    expect(state.cart[0].qty).toBe(1);
  });

  it('restaure le panier personnel exact à la fermeture du modal (succès ou annulation, même signal)', async () => {
    const personalCart = [{ product: { id: 1 }, qty: 3 }];
    state.cart = personalCart;

    checkoutSharedListSelection([{ shared_cart_item_id: 'sci-1', product: { id: 42 }, quantity: 1 }]);
    expect(state.cart).not.toBe(personalCart); // panier éphémère actif

    // Simule le cycle réel : ouverture (b-checkout ajoute 'open'), puis
    // fermeture (closeOrderModal retire 'open') — même signal pour succès
    // et annulation, l'adaptateur ne les distingue jamais.
    dom.orderModal.classList.add('open');
    await flushMutations();
    expect(state.cart).not.toBe(personalCart); // toujours éphémère, modal encore ouvert

    dom.orderModal.classList.remove('open');
    await flushMutations();

    expect(state.cart).toBe(personalCart);
  });

  it('ne restaure qu\'une seule fois même si la classe change plusieurs fois après fermeture (idempotence)', async () => {
    const personalCart = [{ product: { id: 1 }, qty: 1 }];
    state.cart = personalCart;

    checkoutSharedListSelection([{ shared_cart_item_id: 'sci-1', product: { id: 42 }, quantity: 1 }]);
    dom.orderModal.classList.add('open');
    await flushMutations();
    dom.orderModal.classList.remove('open');
    await flushMutations();
    expect(state.cart).toBe(personalCart);

    // Mutation supplémentaire après restauration — ne doit rien casser,
    // l'observer est déconnecté (restored=true, observer.disconnect()).
    state.cart = [{ product: { id: 99 }, qty: 1 }]; // simule navigation normale post-restauration
    dom.orderModal.classList.add('unrelated-class');
    await flushMutations();
    expect(state.cart).toEqual([{ product: { id: 99 }, qty: 1 }]); // inchangé par l'adaptateur
  });

  it('le checkout ne connaît jamais la liste : aucun champ shared_cart_item_id sur le panier personnel restauré', async () => {
    const personalCart = [{ product: { id: 1 }, qty: 1 }]; // pas de shared_cart_item_id
    state.cart = personalCart;

    checkoutSharedListSelection([{ shared_cart_item_id: 'sci-1', product: { id: 42 }, quantity: 1 }]);
    dom.orderModal.classList.add('open');
    await flushMutations();
    dom.orderModal.classList.remove('open');
    await flushMutations();

    expect(state.cart[0].shared_cart_item_id).toBeUndefined();
  });
});
