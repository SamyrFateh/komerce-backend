'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => {
  const getClient = jest.fn();
  return {
    getClient,
    query: jest.fn(),
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

const db = require('../../db');
const { closeCart, cancelSharedCart } = require('../../services/shared-cart-lifecycle');

function makeCart(overrides = {}) {
  return { id: 'cart-001', organizer_user_id: 'user-001', status: 'open', ...overrides };
}

function mockWithTransaction(responses) {
  const calls = [];
  let idx = 0;
  const client = {
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      const r = responses[idx++];
      if (r instanceof Error) throw r;
      return r ?? { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
    _calls: calls,
  };
  db.getClient.mockResolvedValue(client);
  return client;
}

const OK = { rows: [], rowCount: 1 };

beforeEach(() => jest.clearAllMocks());

describe('closeCart', () => {
  test('liste introuvable → throw', async () => {
    mockWithTransaction([OK, { rows: [] }]);
    await expect(closeCart('cart-999', 'user-001')).rejects.toThrow('Panier introuvable ou non autorisé');
  });

  test('panier pas open → throw avec le statut', async () => {
    const cart = makeCart({ status: 'closed' });
    mockWithTransaction([OK, { rows: [cart] }]);
    await expect(closeCart('cart-001', 'user-001')).rejects.toThrow(/Impossible de fermer un panier au statut closed/);
  });

  test('ferme le panier open : statut closed + event cart_closed', async () => {
    const cart = makeCart({ status: 'open' });
    const closed = { ...cart, status: 'closed', closed_at: '2026-08-01T00:00:00Z' };
    // Séquence : BEGIN, SELECT cart FOR UPDATE, SELECT progress (items_count/
    // claimed_count — demande produit 22-08-2026), UPDATE, addEvent, COMMIT.
    const client = mockWithTransaction([
      OK, { rows: [cart] }, { rows: [{ items_count: 3, claimed_count: 3 }] },
      { rows: [closed] }, OK, OK,
    ]);

    const result = await closeCart('cart-001', 'user-001');

    expect(result.status).toBe('closed');
    const progressCall = client._calls[2];
    expect(progressCall.sql).toMatch(/shared_cart_items/);
    const updateCall = client._calls[3];
    expect(updateCall.sql).toMatch(/UPDATE shared_carts/);
    expect(updateCall.sql).toMatch(/status = 'closed'/);
    const eventCall = client._calls[4];
    expect(eventCall.sql).toMatch(/INSERT INTO shared_cart_events/);
    expect(eventCall.params[1]).toBe('cart_closed');
  });

  // Demande produit 22-08-2026 — clôture possible UNIQUEMENT si tous les
  // articles sont réclamés.
  test('liste vide (0 article) : throw shared_cart_empty, jamais UPDATE', async () => {
    const cart = makeCart({ status: 'open' });
    const client = mockWithTransaction([
      OK, { rows: [cart] }, { rows: [{ items_count: 0, claimed_count: 0 }] },
    ]);

    await expect(closeCart('cart-001', 'user-001')).rejects.toMatchObject({
      message: 'Cette liste ne contient aucun article.',
      status: 400,
      code: 'shared_cart_empty',
    });
    // Aucun appel au-delà de la requête de progression — jamais un UPDATE.
    expect(client._calls).toHaveLength(4); // ... + ROLLBACK (withTransaction mock)
  });

  test('articles restants (2/3 réclamés) : throw shared_cart_not_fully_claimed avec le compte exact, jamais UPDATE', async () => {
    const cart = makeCart({ status: 'open' });
    const client = mockWithTransaction([
      OK, { rows: [cart] }, { rows: [{ items_count: 3, claimed_count: 2 }] },
    ]);

    await expect(closeCart('cart-001', 'user-001')).rejects.toMatchObject({
      message: expect.stringContaining('1 article'),
      status: 409,
      code: 'shared_cart_not_fully_claimed',
    });
    expect(client._calls).toHaveLength(4); // ... + ROLLBACK (withTransaction mock)
  });

  test('vérification de progression exécutée DANS la même transaction que le verrou FOR UPDATE — jamais une lecture hors transaction', async () => {
    const cart = makeCart({ status: 'open' });
    const client = mockWithTransaction([
      OK, { rows: [cart] }, { rows: [{ items_count: 1, claimed_count: 0 }] },
    ]);

    await expect(closeCart('cart-001', 'user-001')).rejects.toBeDefined();

    // La requête SELECT cart porte bien FOR UPDATE (verrou posé avant la
    // vérification de progression, jamais une fenêtre de lecture non verrouillée).
    expect(client._calls[1].sql).toMatch(/FOR UPDATE/);
  });
});

describe('cancelSharedCart', () => {
  test('liste introuvable → throw', async () => {
    mockWithTransaction([OK, { rows: [] }]);
    await expect(cancelSharedCart('cart-999', 'user-001', null)).rejects.toThrow('Panier introuvable ou non autorisé');
  });

  test('panier cancelled → throw statut inéligible', async () => {
    const cart = makeCart({ status: 'cancelled' });
    mockWithTransaction([OK, { rows: [cart] }]);
    await expect(cancelSharedCart('cart-001', 'user-001', null)).rejects.toThrow(/Impossible d'annuler un panier au statut cancelled/);
  });

  test('panier open → cancelled ; retourne la ligne APRÈS mise à jour (pas avant)', async () => {
    const cart = makeCart({ status: 'open' });
    const updated = { ...cart, status: 'cancelled', cancelled_at: '2026-08-01T00:00:00Z' };
    const client = mockWithTransaction([OK, { rows: [cart] }, { rows: [updated] }, OK, OK]);

    const result = await cancelSharedCart('cart-001', 'user-001', null);

    // Le service fait RETURNING * sur l'UPDATE : le statut retourné est le nouveau, pas l'ancien.
    expect(result.status).toBe('cancelled');
    const updateCall = client._calls[2];
    expect(updateCall.sql).toMatch(/status = 'cancelled'/);
    const eventCall = client._calls[3];
    expect(eventCall.params[1]).toBe('cart_cancelled');
  });

  test('raison transmise dans le payload de l\'event', async () => {
    const cart = makeCart({ status: 'open' });
    const updated = { ...cart, status: 'cancelled' };
    const client = mockWithTransaction([OK, { rows: [cart] }, { rows: [updated] }, OK, OK]);

    await cancelSharedCart('cart-001', 'user-001', "changement d'avis");

    expect(client._calls[3].params[4].reason).toBe("changement d'avis");
  });

  test("n'effectue aucun remboursement (Boutique First — aucune contribution stockée sur la liste)", async () => {
    const cart = makeCart({ status: 'open' });
    const updated = { ...cart, status: 'cancelled' };
    const client = mockWithTransaction([OK, { rows: [cart] }, { rows: [updated] }, OK, OK]);

    await cancelSharedCart('cart-001', 'user-001', null);

    for (const call of client._calls) {
      expect(call.sql).not.toMatch(/refund/i);
      expect(call.sql).not.toMatch(/contribution/i);
    }
  });
});
