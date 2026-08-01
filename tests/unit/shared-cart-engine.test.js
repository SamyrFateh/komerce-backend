'use strict';

/**
 * tests/unit/shared-cart-engine.test.js
 * Couvre services/shared-cart-engine.js
 *
 * Barrel de ré-export pur — aucune logique propre, donc le test vérifie
 * uniquement que chaque export pointe vers la bonne référence exportée
 * par le sous-module correspondant (identité de fonction).
 *
 * Boutique First : plus de contributions, plus de machine à états — le
 * barrel ne délègue plus qu'à creation/reads/lifecycle/internals.
 */

const mockInternals = { CONFIG: { foo: 'bar' }, generateToken: jest.fn(), unrelated: jest.fn() };
const mockCreation = {
  createSharedCartFromBasket: jest.fn(),
  createSharedCartFromCartItems: jest.fn(),
  clearCreatorBasketInTx: jest.fn(),
};
const mockReads = {
  getSharedCartForPublic: jest.fn(),
  getSharedCartForOwner: jest.fn(),
  listMySharedCarts: jest.fn(),
};
const mockLifecycle = {
  closeCart: jest.fn(),
  cancelSharedCart: jest.fn(),
};

jest.mock('../../services/shared-cart-internals', () => mockInternals);
jest.mock('../../services/shared-cart-creation', () => mockCreation);
jest.mock('../../services/shared-cart-reads', () => mockReads);
jest.mock('../../services/shared-cart-lifecycle', () => mockLifecycle);

const engine = require('../../services/shared-cart-engine');

describe('shared-cart-engine (facade)', () => {
  it('API principale — delegue vers shared-cart-creation et shared-cart-reads', () => {
    expect(engine.createSharedCartFromBasket).toBe(mockCreation.createSharedCartFromBasket);
    expect(engine.createSharedCartFromCartItems).toBe(mockCreation.createSharedCartFromCartItems);
    expect(engine.clearCreatorBasketInTx).toBe(mockCreation.clearCreatorBasketInTx);
    expect(engine.getSharedCartForPublic).toBe(mockReads.getSharedCartForPublic);
    expect(engine.getSharedCartForOwner).toBe(mockReads.getSharedCartForOwner);
    expect(engine.listMySharedCarts).toBe(mockReads.listMySharedCarts);
  });

  it('cycle de vie — delegue vers shared-cart-lifecycle', () => {
    expect(engine.closeCart).toBe(mockLifecycle.closeCart);
    expect(engine.cancelSharedCart).toBe(mockLifecycle.cancelSharedCart);
  });

  it('helpers et config — delegue vers shared-cart-internals', () => {
    expect(engine.generateToken).toBe(mockInternals.generateToken);
    expect(engine.CONFIG).toBe(mockInternals.CONFIG);
  });

  it('n\'expose pas de symboles non prevus par le barrel (pas de fuite accidentelle)', () => {
    expect(engine.unrelated).toBeUndefined();
  });

  it('appeler une fonction deleguee invoque bien l\'implementation du sous-module avec les memes arguments', async () => {
    mockCreation.createSharedCartFromBasket.mockResolvedValue({ id: 'cart-1' });
    const result = await engine.createSharedCartFromBasket('basket-1', { userId: 'u1' });
    expect(mockCreation.createSharedCartFromBasket).toHaveBeenCalledWith('basket-1', { userId: 'u1' });
    expect(result).toEqual({ id: 'cart-1' });
  });

  it('toutes les cles attendues sont presentes sur l\'export (contrat d\'API stable)', () => {
    const expectedKeys = [
      'createSharedCartFromBasket', 'createSharedCartFromCartItems', 'clearCreatorBasketInTx',
      'getSharedCartForPublic', 'getSharedCartForOwner', 'listMySharedCarts',
      'closeCart', 'cancelSharedCart',
      'generateToken', 'CONFIG',
    ];
    expect(Object.keys(engine).sort()).toEqual(expectedKeys.sort());
  });
});
