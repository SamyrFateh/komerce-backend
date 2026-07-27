'use strict';

/**
 * KOMERCE — Tests de réconciliation V4.1
 *
 * Verrouille les deux bugs inter-fichiers détectés à la réconciliation :
 *  1. startContribution refusait AWAITING_CHOICE alors que la route
 *     awaiting-choice/complete (créateur paie le gap) en dépend
 *     → option explicite { allowAwaitingChoice: true }.
 *  2. « Ajuster » (Cas B sortie 2) : le créateur édite la liste ;
 *     guards anti trop-perçu et anti augmentation.
 */

const { makeClient, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => {
  const getClient = jest.fn();
  return {
    getClient,
    query: jest.fn(),
    // P5-N3 : primitive partagée, calquée sur l'implémentation réelle (db.js).
    withTransaction: async (callback) => {
      const client = await getClient();
      try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  };
});
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  forModule: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const db = require('../../db');
const engine = require('../../services/shared-cart-engine');
const items = require('../../services/shared-cart-items-service');

const CART_CLOSED = {
  id: 'cart-1', token: 'tok', status: 'closed',
  payment_window_ends_at: new Date(Date.now() + 24 * 3600 * 1000),
  remaining_kmf: 50000, contributed_kmf: 14000, total_kmf_snapshot: 64000,
};
const CART_AWAITING = { ...CART_CLOSED, status: 'awaiting_choice', payment_window_ends_at: new Date(Date.now() - 3600 * 1000) };

const CONTRIBUTOR = { name: 'Ahmed', email: 'ahmed@test.km', amountKmf: 15000, amountPaid: 30.5, currency: 'EUR' };

describe('startContribution — guard AWAITING_CHOICE (bug réconciliation n°1)', () => {

  test('refuse AWAITING_CHOICE sans option (participant lambda)', async () => {
    const client = makeClient([{ rows: [CART_AWAITING] }]);
    db.getClient.mockResolvedValue(client);

    await expect(engine.startContribution('tok', CONTRIBUTOR))
      .rejects.toThrow(/n'accepte pas de contributions/);
    expectTransactionRolledBack(client);
  });

  test('accepte AWAITING_CHOICE avec allowAwaitingChoice (créateur complète)', async () => {
    const client = makeClient([
      { rows: [CART_AWAITING] },                                   // SELECT cart FOR UPDATE
      { rows: [{ id: 'contrib-1', amount_kmf: 15000 }] },          // INSERT contribution
      { rows: [] },                                                // INSERT event
    ]);
    db.getClient.mockResolvedValue(client);

    const { contribution } = await engine.startContribution('tok', CONTRIBUTOR, { allowAwaitingChoice: true });
    expect(contribution.id).toBe('contrib-1');
  });

  test('CLOSED hors fenêtre : refuse même un montant valide', async () => {
    const stale = { ...CART_CLOSED, payment_window_ends_at: new Date(Date.now() - 1000) };
    const client = makeClient([{ rows: [stale] }]);
    db.getClient.mockResolvedValue(client);

    await expect(engine.startContribution('tok', CONTRIBUTOR))
      .rejects.toThrow(/fenêtre de paiement.*expirée/);
  });

  test('AWAITING_CHOICE + option : la fenêtre expirée ne bloque pas (hors fenêtre par définition)', async () => {
    const client = makeClient([
      { rows: [CART_AWAITING] },
      { rows: [{ id: 'contrib-2', amount_kmf: 15000 }] },
      { rows: [] },
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(engine.startContribution('tok', CONTRIBUTOR, { allowAwaitingChoice: true }))
      .resolves.toBeTruthy();
  });
});

describe('adjustAwaitingCartItems — guards Cas B « Ajuster » (bug réconciliation n°2)', () => {

  const PRODUCT = {
    id: 'p1', name: 'Riz 25kg', image_url: null, category: 'epicerie',
    price_kmf: 12500, promo_pct: 0, is_promo: false, promo_until: null, is_active: true,
  };

  test('refuse hors statut awaiting_choice', async () => {
    const client = makeClient([{ rows: [{ ...CART_CLOSED }] }]);
    db.getClient.mockResolvedValue(client);

    await expect(items.adjustAwaitingCartItems('cart-1', 'user-1', [{ product_id: 'p1', quantity: 1 }]))
      .rejects.toMatchObject({ code: 'cart_not_awaiting_choice', status: 409 });
    expectTransactionRolledBack(client);
  });

  test('refuse un ajustement qui AUGMENTE le total', async () => {
    const small = { ...CART_AWAITING, total_kmf_snapshot: 10000, contributed_kmf: 0 };
    const client = makeClient([
      { rows: [small] },          // SELECT cart
      { rows: [PRODUCT] },        // SELECT products (12500 > 10000)
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(items.adjustAwaitingCartItems('cart-1', 'user-1', [{ product_id: 'p1', quantity: 1 }]))
      .rejects.toMatchObject({ code: 'adjustment_must_reduce' });
  });

  test('refuse un total réduit SOUS les paiements déjà reçus (zéro remboursement)', async () => {
    const funded = { ...CART_AWAITING, total_kmf_snapshot: 64000, contributed_kmf: 20000 };
    const client = makeClient([
      { rows: [funded] },
      { rows: [PRODUCT] },        // nouveau total 12500 < contributed 20000
    ]);
    db.getClient.mockResolvedValue(client);

    await expect(items.adjustAwaitingCartItems('cart-1', 'user-1', [{ product_id: 'p1', quantity: 1 }]))
      .rejects.toMatchObject({ code: 'adjustment_below_contributed' });
  });

  test('ajustement valide : rouvre une fenêtre 48 h (status closed, awaiting_* purgés)', async () => {
    const funded = { ...CART_AWAITING, total_kmf_snapshot: 64000, contributed_kmf: 10000 };
    let cartUpdateSql = null;
    const client = makeClient([
      { rows: [funded] },                                 // SELECT cart
      { rows: [PRODUCT] },                                // SELECT products
      { rows: [], rowCount: 3 },                          // DELETE items
      { rows: [{ id: 'it-1' }] },                         // INSERT item
      (sql) => { cartUpdateSql = sql; return { rows: [{ id: 'cart-1', status: 'closed', remaining_kmf: 2500 }] }; }, // UPDATE cart
      { rows: [] },                                       // INSERT event
    ]);
    db.getClient.mockResolvedValue(client);

    const result = await items.adjustAwaitingCartItems('cart-1', 'user-1', [{ product_id: 'p1', quantity: 1 }]);
    expect(result.cart.status).toBe('closed');
    expect(cartUpdateSql).toMatch(/status = 'closed'/);
    expect(cartUpdateSql).toMatch(/payment_window_ends_at = NOW\(\) \+ INTERVAL '48 hours'/);
    expect(cartUpdateSql).toMatch(/awaiting_choice_started_at = NULL/);
  });
});
