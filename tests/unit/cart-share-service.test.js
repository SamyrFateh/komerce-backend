'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const db = require('../../db');
const {
  markShareConvertedToOrder,
  closeCompletedSharedCartForOrderItems,
} = require('../../services/cart-share-service');

describe('cart-share-service — markShareConvertedToOrder (frontière owner shared-cart pour cart_shares)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('met à jour cart_shares et renvoie true quand une ligne est affectée', async () => {
    db.query.mockResolvedValueOnce({ rowCount: 1 });

    const result = await markShareConvertedToOrder('tok-123', 'order-456');

    expect(result).toBe(true);
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE cart_shares/);
    expect(sql).toMatch(/converted_order_id IS NULL/);
    expect(params).toEqual(['order-456', 'tok-123']);
  });

  test('renvoie false quand aucune ligne ne correspond (déjà converti / token inconnu) — jamais d\'exception', async () => {
    db.query.mockResolvedValueOnce({ rowCount: 0 });

    const result = await markShareConvertedToOrder('tok-unknown', 'order-456');

    expect(result).toBe(false);
  });

  test('renvoie false sans lever si la requête échoue (contrat fire-and-forget, ne doit jamais faire échouer la commande)', async () => {
    db.query.mockRejectedValueOnce(new Error('connection lost'));

    await expect(markShareConvertedToOrder('tok-123', 'order-456')).resolves.toBe(false);
  });

  test('renvoie false immédiatement si shareToken ou orderId est manquant, sans appeler la DB', async () => {
    expect(await markShareConvertedToOrder(null, 'order-456')).toBe(false);
    expect(await markShareConvertedToOrder('tok-123', undefined)).toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('cart-share-service — fermeture automatique à 100% réclamé', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('ne touche pas la DB pour une commande hors liste partagée', async () => {
    const result = await closeCompletedSharedCartForOrderItems(
      [{ product_id: 'prod-1', quantity: 1 }],
      'order-1'
    );

    expect(result).toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('ferme et audite atomiquement quand toutes les lignes sont désormais réclamées', async () => {
    db.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ shared_cart_id: 'cart-1' }],
    });

    const result = await closeCompletedSharedCartForOrderItems([
      { product_id: 'prod-1', shared_cart_item_id: '11111111-1111-4111-8111-111111111111' },
      { product_id: 'prod-2', shared_cart_item_id: '22222222-2222-4222-8222-222222222222' },
    ], 'order-1');

    expect(result).toBe(true);
    expect(db.query).toHaveBeenCalledTimes(1);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/WITH target_carts AS/);
    expect(sql).toMatch(/UPDATE shared_carts sc/);
    expect(sql).toMatch(/sc\.status = 'open'/);
    expect(sql).toMatch(/NOT EXISTS/);
    expect(sql).toMatch(/FROM order_items oi/);
    expect(sql).toMatch(/INSERT INTO shared_cart_events/);
    expect(sql).toMatch(/'cart_closed'/);
    expect(sql).toMatch(/'all_items_claimed'/);
    expect(params).toEqual([
      [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
      'order-1',
    ]);
  });

  test('reste OPEN si au moins une ligne n\'est pas encore réclamée', async () => {
    db.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const result = await closeCompletedSharedCartForOrderItems([
      { shared_cart_item_id: '11111111-1111-4111-8111-111111111111' },
    ], 'order-1');

    expect(result).toBe(false);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('déduplique les shared_cart_item_id avant la réconciliation', async () => {
    db.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await closeCompletedSharedCartForOrderItems([
      { shared_cart_item_id: '11111111-1111-4111-8111-111111111111' },
      { shared_cart_item_id: '11111111-1111-4111-8111-111111111111' },
    ], 'order-1');

    expect(db.query.mock.calls[0][1][0]).toEqual([
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  test('une erreur de projection ne transforme jamais la commande déjà commitée en exception', async () => {
    db.query.mockRejectedValueOnce(new Error('shared-cart temporarily unavailable'));

    await expect(closeCompletedSharedCartForOrderItems([
      { shared_cart_item_id: '11111111-1111-4111-8111-111111111111' },
    ], 'order-1')).resolves.toBe(false);
  });
});