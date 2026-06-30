'use strict';

jest.mock('../../db', () => ({ query: jest.fn() }));

const db = require('../../db');
const {
  getSharedCartForPublic,
  getSharedCartForOwner,
  listMySharedCarts,
  incrementViewCount,
} = require('../../services/shared-cart-reads');

describe('shared-cart-reads', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getSharedCartForPublic retourne null si le token est inconnu', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await expect(getSharedCartForPublic('missing-token')).resolves.toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('getSharedCartForPublic expose une vue publique sans UUID interne', async () => {
    const cart = {
      id: 'cart-001', token: 'token-001', beneficiary_name_snapshot: 'Creator',
      title: 'Panier groupe', total_kmf_snapshot: 10000, contributed_kmf: 2500, remaining_kmf: 7500,
      status: 'closed', view_count: 3,
    };
    const items = [{ name: 'Riz', quantity: 2, unit_price_kmf: 1000, line_total_kmf: 2000 }];
    const contributions = [{ first_name: 'Ali', amount_kmf: 2500, message: 'ok' }];
    const summary = { count: 2, total_estimated_kmf: 8000 };
    db.query
      .mockResolvedValueOnce({ rows: [cart] })
      .mockResolvedValueOnce({ rows: items })
      .mockResolvedValueOnce({ rows: contributions })
      .mockResolvedValueOnce({ rows: [summary] });

    const result = await getSharedCartForPublic('token-001');

    expect(result.cart.id).toBeUndefined();
    expect(result.cart.token).toBe('token-001');
    expect(result.items).toBe(items);
    expect(result.contributions).toBe(contributions);
    expect(result.estimations_summary).toBe(summary);
    expect(db.query.mock.calls[2][0]).toContain("status = 'paid'");
  });

  it('getSharedCartForOwner retourne null si le panier ne correspond pas au createur', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await expect(getSharedCartForOwner('cart-001', 'user-001')).resolves.toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('getSharedCartForOwner retourne cart, items, contributions et estimations completes', async () => {
    const cart = { id: 'cart-001', beneficiary_user_id: 'user-001' };
    const items = [{ id: 'item-001' }];
    const contributions = [{ id: 'contrib-001', contributor_email: 'ali@example.com' }];
    const estimations = [{ id: 'estim-001', participant_phone: '+269000' }];
    db.query
      .mockResolvedValueOnce({ rows: [cart] })
      .mockResolvedValueOnce({ rows: items })
      .mockResolvedValueOnce({ rows: contributions })
      .mockResolvedValueOnce({ rows: estimations });

    await expect(getSharedCartForOwner('cart-001', 'user-001')).resolves.toEqual({
      cart,
      items,
      contributions,
      estimations,
    });
  });

  it('listMySharedCarts retourne les paniers du beneficiaire', async () => {
    const rows = [{ id: 'cart-001', contributors_count: 2 }];
    db.query.mockResolvedValueOnce({ rows });

    await expect(listMySharedCarts('user-001')).resolves.toBe(rows);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE beneficiary_user_id = $1'), ['user-001']);
  });

  it('incrementViewCount incremente par token', async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await incrementViewCount('token-001');

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('view_count = view_count + 1'), ['token-001']);
  });
});
