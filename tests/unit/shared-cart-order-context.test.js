'use strict';

const {
  SharedCartOrderContextError,
  buildSharedCartOrderContext,
  resolveInitialPickupCodeRecipient,
  isSharedCartOrder,
} = require('../../services/shared-cart-order-context');

describe('buildSharedCartOrderContext', () => {
  test('construit un rattachement minimal et immutable', () => {
    const context = buildSharedCartOrderContext({
      sharedCartId: 'cart-1',
      sharedCartItemId: 'item-1',
      organizerUserId: 'user-1',
    });

    expect(context).toEqual({
      sharedCartId: 'cart-1',
      sharedCartItemId: 'item-1',
      organizerUserId: 'user-1',
    });
    expect(Object.isFrozen(context)).toBe(true);
  });

  test.each([
    [{ sharedCartItemId: 'item-1', organizerUserId: 'user-1' }, 'SHARED_CART_ID_REQUIRED'],
    [{ sharedCartId: 'cart-1', organizerUserId: 'user-1' }, 'SHARED_CART_ITEM_ID_REQUIRED'],
    [{ sharedCartId: 'cart-1', sharedCartItemId: 'item-1' }, 'ORGANIZER_USER_ID_REQUIRED'],
  ])('refuse un contexte incomplet', (input, expectedCode) => {
    expect(() => buildSharedCartOrderContext(input)).toThrow(SharedCartOrderContextError);

    try {
      buildSharedCartOrderContext(input);
    } catch (error) {
      expect(error.code).toBe(expectedCode);
    }
  });
});

describe('resolveInitialPickupCodeRecipient', () => {
  test('utilise l acheteur pour une commande ordinaire', () => {
    expect(resolveInitialPickupCodeRecipient({
      buyerVerifiedWhatsapp: ' +2693330000 ',
    })).toEqual({
      role: 'buyer',
      whatsapp: '+2693330000',
    });
  });

  test('utilise l organisateur pour une commande rattachee a une liste', () => {
    expect(resolveInitialPickupCodeRecipient({
      sharedCartId: 'cart-1',
      buyerVerifiedWhatsapp: '+33600000000',
      organizerVerifiedWhatsapp: '+2694440000',
    })).toEqual({
      role: 'shared_cart_organizer',
      whatsapp: '+2694440000',
    });
  });

  test('ne retombe jamais silencieusement sur l acheteur si l organisateur manque', () => {
    expect(() => resolveInitialPickupCodeRecipient({
      sharedCartId: 'cart-1',
      buyerVerifiedWhatsapp: '+33600000000',
    })).toThrow(expect.objectContaining({
      code: 'SHARED_CART_ORGANIZER_WHATSAPP_REQUIRED',
    }));
  });

  test('refuse une commande ordinaire sans WhatsApp acheteur verifie', () => {
    expect(() => resolveInitialPickupCodeRecipient({})).toThrow(expect.objectContaining({
      code: 'BUYER_WHATSAPP_REQUIRED',
    }));
  });
});

describe('isSharedCartOrder', () => {
  test('detecte uniquement les commandes rattachees', () => {
    expect(isSharedCartOrder({ shared_cart_id: 'cart-1' })).toBe(true);
    expect(isSharedCartOrder({ shared_cart_id: null })).toBe(false);
    expect(isSharedCartOrder(null)).toBe(false);
  });
});
