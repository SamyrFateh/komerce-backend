'use strict';

jest.mock('../../db', () => ({ query: jest.fn() }));

const db = require('../../db');
const {
  getSharedCartForPublic,
  getSharedCartForOwner,
  listMySharedCarts,
} = require('../../services/shared-cart-reads');

describe('shared-cart-reads (Boutique First, domaine minimal)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getSharedCartForPublic retourne null si le token est inconnu', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(getSharedCartForPublic('missing')).resolves.toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('getSharedCartForPublic calcule total_kmf/items_count/claimed_count et n\'expose aucune identité créateur', async () => {
    const cart = { id: 'cart-1', token: 'tok-1', title: 'Liste', message: 'Merci', status: 'open', delivery_relay_id: 'r1', created_at: '2026-01-01' };
    const items = [
      { id: 'sci-1', name: 'Riz', image: null, category: 'epicerie', quantity: 2, unit_price_kmf: 1000, line_total_kmf: 2000, claimed: true },
      { id: 'sci-2', name: 'Sucre', image: null, category: 'epicerie', quantity: 1, unit_price_kmf: 500, line_total_kmf: 500, claimed: false },
    ];
    db.query.mockResolvedValueOnce({ rows: [cart] }).mockResolvedValueOnce({ rows: items });

    const result = await getSharedCartForPublic('tok-1');

    expect(result.cart.token).toBe('tok-1');
    // Boutique First : aucun nom/téléphone créateur exposé publiquement.
    expect(result.cart.organizer_user_id).toBeUndefined();
    expect(result.cart.beneficiary_name_snapshot).toBeUndefined();
    expect(result.total_kmf).toBe(2500);
    expect(result.items_count).toBe(2);
    expect(result.claimed_count).toBe(1);
    expect(result.items[0].claimed).toBe(true);
  });

  it('getSharedCartForOwner retourne null si la liste ne correspond pas à l\'organisateur', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(getSharedCartForOwner('cart-1', 'user-1')).resolves.toBeNull();
    expect(db.query.mock.calls[0][0]).toContain('organizer_user_id');
  });

  it('getSharedCartForOwner expose claimed_by_order_id et total_kmf calculé', async () => {
    const cart = { id: 'cart-1', organizer_user_id: 'user-1' };
    const items = [
      { id: 'sci-1', line_total_kmf_snapshot: 1000, claimed: true, claimed_by_order_id: 'order-1' },
    ];
    db.query.mockResolvedValueOnce({ rows: [cart] }).mockResolvedValueOnce({ rows: items });

    const result = await getSharedCartForOwner('cart-1', 'user-1');

    expect(result.cart.total_kmf).toBe(1000);
    expect(result.items[0].claimed_by_order_id).toBe('order-1');
    expect(result.claimed_count).toBe(1);
  });

  it('listMySharedCarts agrège total_kmf/items_count/claimed_count par liste', async () => {
    const rows = [{ id: 'cart-1', total_kmf: 3000, items_count: 2, claimed_count: 1 }];
    db.query.mockResolvedValueOnce({ rows });

    await expect(listMySharedCarts('user-1')).resolves.toBe(rows);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('organizer_user_id = $1'), ['user-1']);
  });
});
