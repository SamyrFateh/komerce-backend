'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../js/b-checkout.js', () => ({
  buildCheckoutSelection: jest.fn((items, context) => ({
    source: context?.origin === 'SHARED_LIST'
      ? 'shared-list'
      : 'personal-cart',
    sourceId: context?.sharedCartId || null,
    items,
    total: items.reduce((sum, item) => {
      const unitPrice =
        item.price ??
        item.product?.price_kmf ??
        item.product?.price ??
        0;

      return sum + Number(unitPrice || 0) * Number(item.qty || 0);
    }, 0),
  })),
  checkoutCart: jest.fn(),
}));

const { state, dom, initDom } = require('../../js/b-store.js');
const {
  buildCheckoutSelection,
  checkoutCart,
} = require('../../js/b-checkout.js');

const {
  checkoutSharedListSelection,
} = require('../../js/group/group-checkout-adapter.js');

function flushMutations() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('checkoutSharedListSelection — CheckoutSelection', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="k-order-modal"></div>';
    initDom();

    state.cart = [];
    state.checkoutDisplayContext = null;

    localStorage.clear();
    jest.clearAllMocks();
  });

  it('sélection vide → false, aucun checkout, panier intact', () => {
    const personalCart = [{ product: { id: 1 }, qty: 1 }];
    state.cart = personalCart;

    expect(checkoutSharedListSelection([])).toBe(false);
    expect(buildCheckoutSelection).not.toHaveBeenCalled();
    expect(checkoutCart).not.toHaveBeenCalled();
    expect(state.cart).toBe(personalCart);
  });

  it('ligne sans shared_cart_item_id → false, panier intact', () => {
    const personalCart = [{ product: { id: 1 }, qty: 1 }];
    state.cart = personalCart;

    const result = checkoutSharedListSelection([
      { product: { id: 42 }, quantity: 1 },
    ]);

    expect(result).toBe(false);
    expect(checkoutCart).not.toHaveBeenCalled();
    expect(state.cart).toBe(personalCart);
  });

  it('construit CheckoutSelection et appelle checkoutCart(selection)', () => {
    const result = checkoutSharedListSelection([{
      shared_cart_item_id: 'sci-1',
      product: { id: 42, name: 'Riz', price_kmf: 1500 },
      quantity: 2,
    }]);

    expect(result).toBe(true);
    expect(buildCheckoutSelection).toHaveBeenCalledTimes(1);
    expect(checkoutCart).toHaveBeenCalledTimes(1);

    const selection = checkoutCart.mock.calls[0][0];

    expect(selection).toEqual(expect.objectContaining({
      source: 'shared-list',
      sourceId: null,
      total: 3000,
    }));

    expect(selection.items).toHaveLength(1);
  });

  it('le panier personnel garde exactement la même référence', () => {
    const personalCart = [{
      product: { id: 1, name: 'Personnel' },
      qty: 3,
    }];

    state.cart = personalCart;

    checkoutSharedListSelection([{
      shared_cart_item_id: 'sci-1',
      product: { id: 42 },
      quantity: 1,
    }]);

    expect(state.cart).toBe(personalCart);
  });

  it('transmet le contexte relationnel canonique', () => {
    checkoutSharedListSelection(
      [{
        shared_cart_item_id: 'sci-1',
        product: { id: 42 },
        quantity: 1,
      }],
      {
        origin: 'SHARED_LIST',
        sharedCartId: 'cart-1',
        isCreator: false,
        creatorFirstName: 'Samsam',
        title: 'Achat pour la liste de Samsam',
      }
    );

    expect(state.checkoutDisplayContext).toEqual({
      origin: 'SHARED_LIST',
      sharedCartId: 'cart-1',
      isCreator: false,
      creatorFirstName: 'Samsam',
      title: 'Achat pour la liste de Samsam',
    });

    expect(checkoutCart).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'shared-list',
        sourceId: 'cart-1',
      })
    );
  });

  it('une sélection de liste reste source shared-list même sans contexte fourni', () => {
    checkoutSharedListSelection([{
      shared_cart_item_id: 'sci-1',
      product: { id: 42 },
      quantity: 1,
    }]);

    expect(buildCheckoutSelection).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        origin: 'SHARED_LIST',
      })
    );

    expect(checkoutCart).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'shared-list',
      })
    );
  });

  it('propage variant_combo tel quel', () => {
    checkoutSharedListSelection([{
      shared_cart_item_id: 'sci-2',
      product: { id: 43 },
      quantity: 1,
      variant_combo: {
        couleur: 'Noir',
        taille: 'M',
      },
    }]);

    const [lines] = buildCheckoutSelection.mock.calls[0];

    expect(lines[0].variant_combo).toEqual({
      couleur: 'Noir',
      taille: 'M',
    });
  });

  it('conserve shared_cart_item_id distinct de product.id', () => {
    checkoutSharedListSelection([{
      shared_cart_item_id: 'shared-item-1',
      product: { id: 'product-42' },
      quantity: 1,
    }]);

    const [lines] = buildCheckoutSelection.mock.calls[0];

    expect(lines[0].shared_cart_item_id).toBe('shared-item-1');
    expect(lines[0].product.id).toBe('product-42');
    expect(lines[0].product.id).not.toBe(lines[0].shared_cart_item_id);
  });

  it('propage shared_list_context quand fourni', () => {
    checkoutSharedListSelection([{
      shared_cart_item_id: 'sci-1',
      product: { id: 42 },
      quantity: 1,
      shared_list_context: {
        snapshot_unit_price_kmf: 6500,
        snapshot_name: 'Riz',
        snapshot_image_url: null,
      },
    }]);

    const [lines] = buildCheckoutSelection.mock.calls[0];

    expect(lines[0].shared_list_context).toEqual({
      snapshot_unit_price_kmf: 6500,
      snapshot_name: 'Riz',
      snapshot_image_url: null,
    });
  });

  it('complète nom et image depuis le snapshot sans remplacer le prix catalogue', () => {
    checkoutSharedListSelection([{
      shared_cart_item_id: 'sci-1',
      product: { id: 42, price_kmf: 7200 },
      quantity: 1,
      shared_list_context: {
        snapshot_unit_price_kmf: 6500,
        snapshot_name: 'Riz parfumé',
        snapshot_image_url: 'https://cdn.example.test/riz.jpg',
      },
    }]);

    const [lines] = buildCheckoutSelection.mock.calls[0];

    expect(lines[0].product).toEqual(expect.objectContaining({
      id: 42,
      name: 'Riz parfumé',
      image_url: 'https://cdn.example.test/riz.jpg',
      price_kmf: 7200,
    }));
    expect(lines[0].product.price_kmf).not.toBe(6500);
  });

  it('conserve la présentation catalogue quand elle existe déjà', () => {
    checkoutSharedListSelection([{
      shared_cart_item_id: 'sci-1',
      product: {
        id: 42,
        name: 'Nom catalogue',
        image_url: 'https://cdn.example.test/current.jpg',
      },
      quantity: 1,
      shared_list_context: {
        snapshot_name: 'Ancien nom',
        snapshot_image_url: 'https://cdn.example.test/snapshot.jpg',
      },
    }]);

    const [lines] = buildCheckoutSelection.mock.calls[0];

    expect(lines[0].product.name).toBe('Nom catalogue');
    expect(lines[0].product.image_url).toBe('https://cdn.example.test/current.jpg');
  });

  it('n’invente aucun shared_list_context absent', () => {
    checkoutSharedListSelection([{
      shared_cart_item_id: 'sci-1',
      product: { id: 42 },
      quantity: 1,
    }]);

    const [lines] = buildCheckoutSelection.mock.calls[0];

    expect(lines[0].shared_list_context).toBeUndefined();
  });

  it('propage requested_transport_rail quand fourni', () => {
    checkoutSharedListSelection([{
      shared_cart_item_id: 'sci-1',
      product: { id: 42 },
      quantity: 1,
      requested_transport_rail: 'AIR_EXPRESS',
    }]);

    const [lines] = buildCheckoutSelection.mock.calls[0];

    expect(lines[0].requested_transport_rail).toBe('AIR_EXPRESS');
  });

  it('quantity absente → qty 1', () => {
    checkoutSharedListSelection([{
      shared_cart_item_id: 'sci-1',
      product: { id: 42 },
    }]);

    const [lines] = buildCheckoutSelection.mock.calls[0];

    expect(lines[0].qty).toBe(1);
  });

  it('fermeture du modal → efface le contexte sans toucher au panier', async () => {
    const personalCart = [{ product: { id: 1 }, qty: 3 }];
    state.cart = personalCart;

    checkoutSharedListSelection([{
      shared_cart_item_id: 'sci-1',
      product: { id: 42 },
      quantity: 1,
    }], {
      origin: 'SHARED_LIST',
      title: 'Achat pour la liste de Samsam',
    });

    dom.orderModal.classList.add('open');
    await flushMutations();

    expect(state.cart).toBe(personalCart);
    expect(state.checkoutDisplayContext).not.toBeNull();

    dom.orderModal.classList.remove('open');
    await flushMutations();

    expect(state.cart).toBe(personalCart);
    expect(state.checkoutDisplayContext).toBeNull();
  });

  it('le checkout partagé ne modifie jamais le panier localStorage', async () => {
    const personalCart = [{
      product: { id: 1 },
      qty: 4,
    }];

    state.cart = personalCart;
    localStorage.setItem('kmrc_cart', JSON.stringify(personalCart));

    checkoutSharedListSelection([{
      shared_cart_item_id: 'sci-1',
      product: { id: 42 },
      quantity: 1,
    }]);

    dom.orderModal.classList.add('open');
    await flushMutations();

    expect(JSON.parse(localStorage.getItem('kmrc_cart'))).toEqual(personalCart);

    dom.orderModal.classList.remove('open');
    await flushMutations();

    expect(JSON.parse(localStorage.getItem('kmrc_cart'))).toEqual(personalCart);
    expect(state.cart).toBe(personalCart);
  });

  it('absence du modal → false sans mutation globale', () => {
    const originalOrderModal = dom.orderModal;
    const personalCart = [{ product: { id: 1 }, qty: 1 }];

    state.cart = personalCart;
    dom.orderModal = null;

    try {
      const result = checkoutSharedListSelection([{
        shared_cart_item_id: 'sci-1',
        product: { id: 42 },
      }]);

      expect(result).toBe(false);
      expect(buildCheckoutSelection).not.toHaveBeenCalled();
      expect(checkoutCart).not.toHaveBeenCalled();
      expect(state.cart).toBe(personalCart);
      expect(state.checkoutDisplayContext).toBeNull();
    } finally {
      dom.orderModal = originalOrderModal;
    }
  });

  it('erreur synchrone checkoutCart → contexte nettoyé, panier intact', () => {
    const personalCart = [{ product: { id: 1 }, qty: 1 }];
    state.cart = personalCart;

    checkoutCart.mockImplementationOnce(() => {
      throw new Error('checkout indisponible');
    });

    expect(() => checkoutSharedListSelection(
      [{
        shared_cart_item_id: 'sci-1',
        product: { id: 42 },
      }],
      {
        origin: 'SHARED_LIST',
        title: 'Achat pour la liste de Samsam',
      }
    )).toThrow('checkout indisponible');

    expect(state.cart).toBe(personalCart);
    expect(state.checkoutDisplayContext).toBeNull();
  });
});
