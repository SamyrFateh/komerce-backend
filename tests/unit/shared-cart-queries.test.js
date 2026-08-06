'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * shared-cart-queries.js (Boutique First, domaine minimal)
 * adminExpireCart est conservé (renommé en substance : force-annulation
 * admin, plus "expiration" — voir doc en tête du fichier source).
 */

let mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

const {
  getSharedCartByToken,
  getCartByOwner,
  logEvent,
  adminListCarts,
  adminGetCartDetail,
  adminExpireCart,
} = require('../../services/shared-cart-queries');

function makeDbQueue(responses) {
  const queue = [...responses];
  return jest.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('No db.query mock remaining');
    return { rows: next.rows || [], rowCount: next.rowCount ?? (next.rows?.length ?? 0) };
  });
}

beforeEach(() => jest.clearAllMocks());

describe('getSharedCartByToken', () => {
  test('token existant → retourne le panier', async () => {
    const cart = { id: 42, token: 'tok-1' };
    mockDbQuery = makeDbQueue([{ rows: [cart] }]);
    expect(await getSharedCartByToken('tok-1')).toEqual(cart);
  });
  test('token inconnu → null', async () => {
    mockDbQuery = makeDbQueue([{ rows: [] }]);
    expect(await getSharedCartByToken('missing')).toBeNull();
  });
});

describe('getCartByOwner', () => {
  test('cart appartient à l\'organisateur -> retourne le cart', async () => {
    const cart = { id: 42, organizer_user_id: 7 };
    mockDbQuery = makeDbQueue([{ rows: [cart] }]);
    expect(await getCartByOwner(42, 7)).toEqual(cart);
  });
  test('mauvais user_id → null', async () => {
    mockDbQuery = makeDbQueue([{ rows: [] }]);
    expect(await getCartByOwner(42, 999)).toBeNull();
  });
});

describe('logEvent', () => {
  test('INSERT sans retour — ne throw pas', async () => {
    mockDbQuery = makeDbQueue([{ rows: [] }]);
    await expect(logEvent(42, 'cart_closed', 'system', null, { reason: 'x' })).resolves.toBeUndefined();
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });
});

describe('adminListCarts', () => {
  test('sans filtre → retourne toutes les lignes', async () => {
    mockDbQuery = makeDbQueue([{ rows: [{ id: 1 }, { id: 2 }] }]);
    expect(await adminListCarts()).toHaveLength(2);
  });
  test('filtre status → query paramétrée', async () => {
    mockDbQuery = makeDbQueue([{ rows: [{ id: 3 }] }]);
    await adminListCarts({ status: 'open' });
    expect(mockDbQuery.mock.calls[0][1]).toContain('open');
  });
  test('filtre user_id → sur organizer_user_id', async () => {
    mockDbQuery = makeDbQueue([{ rows: [{ id: 4 }] }]);
    await adminListCarts({ user_id: 7 });
    expect(mockDbQuery.mock.calls[0][0]).toContain('organizer_user_id');
    expect(mockDbQuery.mock.calls[0][1]).toContain(7);
  });
});

describe('adminGetCartDetail', () => {
  test('cart existant → { cart, items, events }, claimed sans filtre de statut de commande', async () => {
    const cart = { id: 42, status: 'open' };
    mockDbQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [cart] })
      .mockResolvedValueOnce({ rows: [{ id: 'item1', claimed: true, claimed_by_order_id: 'order-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'evt1' }] });

    const result = await adminGetCartDetail(42);
    expect(result.cart).toEqual(cart);
    expect(result.items[0].claimed).toBe(true);
    expect(result.events).toHaveLength(1);
  });
  test('cart introuvable → null', async () => {
    mockDbQuery = makeDbQueue([{ rows: [] }]);
    expect(await adminGetCartDetail(999)).toBeNull();
  });
});

describe('adminExpireCart (force-annulation admin)', () => {
  test('panier open/closed → cancelled', async () => {
    const cancelled = { id: 42, status: 'cancelled' };
    mockDbQuery = makeDbQueue([{ rows: [cancelled] }]);
    const result = await adminExpireCart(42);
    expect(result.status).toBe('cancelled');
  });
  test('panier déjà cancelled (statut incompatible) → null', async () => {
    mockDbQuery = makeDbQueue([{ rows: [] }]);
    expect(await adminExpireCart(42)).toBeNull();
  });
  test('ne cible jamais un statut "expired" (n\'existe plus, migration 124)', async () => {
    mockDbQuery = makeDbQueue([{ rows: [{ id: 42, status: 'cancelled' }] }]);
    await adminExpireCart(42);
    expect(mockDbQuery.mock.calls[0][0]).not.toContain('expired');
    expect(mockDbQuery.mock.calls[0][0]).toContain('cancelled');
  });
});
