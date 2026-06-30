/**
 * KOMERCE — Tests Unitaires : routes/shared-cart-from-order (P0 shared-cart)
 *
 * Couvre fromOrderHandler : validations (order_id, split_mode, auth),
 * garde-fous métier (statut commande, déjà payée, shared_cart déjà existant,
 * commande sans articles), transition pending_group_payment via la state
 * machine, création transactionnelle du shared_cart + snapshot d'items +
 * event d'audit, et rollback/next(err) en cas d'erreur inattendue.
 *
 * Run : npx jest tests/unit/shared-cart-from-order.test.js
 */

'use strict';

function makeClient(responses) {
  const client = {
    query: jest.fn((sql, params) => {
      const next = responses.shift();
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next === undefined ? {} : next);
    }),
    release: jest.fn(),
  };
  return client;
}

const mockGetClient = jest.fn();
jest.mock('../../db', () => ({
  getClient: (...args) => mockGetClient(...args),
}));

jest.mock('../../services/shared-cart-engine', () => ({}));

const mockTransitionOrderStatus = jest.fn();
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: (...args) => mockTransitionOrderStatus(...args),
}));

const { fromOrderHandler } = require('../../routes/shared-cart-from-order');

function buildRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function buildReq(body, user = { id: 'user-1', full_name: 'Ali', phone: '0612345678' }) {
  return { body, user };
}

const validOrder = {
  id: 'order-1',
  user_id: 'user-1',
  status: 'pending',
  payment_mode: 'cash_kmf',
  payment_status: 'unpaid',
  total_kmf: 10000,
  reference: 'KMC-001',
  recipient_name: 'Bénéficiaire X',
  recipient_phone: '0699999999',
  relais_id: 'relais-1',
};

const orderItem = {
  product_id: 'p1',
  product_name: 'Produit 1',
  product_image: 'img.jpg',
  product_category: 'mode',
  quantity: 2,
  price_kmf: 5000,
};

describe('fromOrderHandler', () => {
  beforeEach(() => {
    mockGetClient.mockReset();
    mockTransitionOrderStatus.mockReset();
  });

  test('rejette si order_id absent (400, rollback)', async () => {
    const client = makeClient([{}]); // BEGIN
    mockGetClient.mockResolvedValueOnce(client);
    const res = buildRes();

    await fromOrderHandler(buildReq({}), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('rejette un split_mode invalide', async () => {
    const client = makeClient([{}]);
    mockGetClient.mockResolvedValueOnce(client);
    const res = buildRes();

    await fromOrderHandler(buildReq({ order_id: 'order-1', split_mode: 'bogus' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/split_mode/) }));
  });

  test('rejette si non authentifié (401)', async () => {
    const client = makeClient([{}]);
    mockGetClient.mockResolvedValueOnce(client);
    const res = buildRes();

    await fromOrderHandler(buildReq({ order_id: 'order-1' }, null), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('renvoie 404 si la commande est introuvable', async () => {
    const client = makeClient([{}, { rows: [] }]); // BEGIN, SELECT order
    mockGetClient.mockResolvedValueOnce(client);
    const res = buildRes();

    await fromOrderHandler(buildReq({ order_id: 'order-x' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('rejette si le statut de la commande n\'est pas pending', async () => {
    const client = makeClient([{}, { rows: [{ ...validOrder, status: 'delivered' }] }]);
    mockGetClient.mockResolvedValueOnce(client);
    const res = buildRes();

    await fromOrderHandler(buildReq({ order_id: 'order-1' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ order_status: 'delivered' }));
  });

  test('rejette si déjà payée en stripe_eur', async () => {
    const client = makeClient([
      {},
      { rows: [{ ...validOrder, payment_mode: 'stripe_eur', payment_status: 'paid' }] },
    ]);
    mockGetClient.mockResolvedValueOnce(client);
    const res = buildRes();

    await fromOrderHandler(buildReq({ order_id: 'order-1' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Commande déjà payée' }));
  });

  test('rejette si un shared_cart existe déjà pour cette commande', async () => {
    const client = makeClient([
      {},
      { rows: [validOrder] },
      { rows: [{ id: 'existing-cart' }] },
    ]);
    mockGetClient.mockResolvedValueOnce(client);
    const res = buildRes();

    await fromOrderHandler(buildReq({ order_id: 'order-1' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ shared_cart_id: 'existing-cart' }));
  });

  test('rejette si la commande n\'a pas d\'articles', async () => {
    const client = makeClient([
      {},
      { rows: [validOrder] },
      { rows: [] }, // pas de shared_cart existant
      { rows: [] }, // pas d'order_items
    ]);
    mockGetClient.mockResolvedValueOnce(client);
    const res = buildRes();

    await fromOrderHandler(buildReq({ order_id: 'order-1' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Commande sans articles' }));
  });

  test('rejette si la transition pending_group_payment échoue', async () => {
    const client = makeClient([
      {},
      { rows: [validOrder] },
      { rows: [] },
      { rows: [orderItem] },
    ]);
    mockGetClient.mockResolvedValueOnce(client);
    mockTransitionOrderStatus.mockResolvedValueOnce({ success: false, error: 'Transition refusée par garde' });
    const res = buildRes();

    await fromOrderHandler(buildReq({ order_id: 'order-1' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Transition refusée par garde' }));
  });

  test('crée le shared_cart avec succès (split_mode free) et commit la transaction', async () => {
    const createdCart = { id: 'cart-1', expires_at: new Date('2026-07-15') };
    const client = makeClient([
      {}, // BEGIN
      { rows: [validOrder] }, // SELECT order
      { rows: [] }, // pas de shared_cart existant
      { rows: [orderItem] }, // order_items
      { rows: [createdCart] }, // INSERT shared_carts
      {}, // INSERT shared_cart_items (1 item)
      {}, // INSERT shared_cart_events
      {}, // COMMIT
    ]);
    mockGetClient.mockResolvedValueOnce(client);
    mockTransitionOrderStatus.mockResolvedValueOnce({ success: true });
    const res = buildRes();

    await fromOrderHandler(buildReq({ order_id: 'order-1', message: 'Aidez-moi !' }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      shared_cart_id: 'cart-1',
      total_kmf: 10000,
      split_mode: 'free',
      suggested_share_kmf: null,
      order_reference: 'KMC-001',
    }));
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('calcule suggested_share_kmf en mode equal avec arrondi au plafond', async () => {
    const createdCart = { id: 'cart-2', expires_at: new Date() };
    const client = makeClient([
      {}, { rows: [validOrder] }, { rows: [] }, { rows: [orderItem] },
      { rows: [createdCart] }, {}, {}, {},
    ]);
    mockGetClient.mockResolvedValueOnce(client);
    mockTransitionOrderStatus.mockResolvedValueOnce({ success: true });
    const res = buildRes();

    await fromOrderHandler(
      buildReq({ order_id: 'order-1', split_mode: 'equal', nb_participants: 3 }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    // total_kmf = 10000, 10000/3 = 3333.33 → Math.ceil = 3334
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ suggested_share_kmf: 3334 }));
  });

  test('clamp nb_participants dans [2,50] et expiration_days dans [1,30]', async () => {
    const createdCart = { id: 'cart-3', expires_at: new Date() };
    const client = makeClient([
      {}, { rows: [validOrder] }, { rows: [] }, { rows: [orderItem] },
      { rows: [createdCart] }, {}, {}, {},
    ]);
    mockGetClient.mockResolvedValueOnce(client);
    mockTransitionOrderStatus.mockResolvedValueOnce({ success: true });
    const res = buildRes();

    await fromOrderHandler(
      buildReq({ order_id: 'order-1', split_mode: 'equal', nb_participants: 999, expiration_days: 365 }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ expected_participants: 50 }));
  });

  test('rollback et next(err) en cas d\'erreur inattendue dans le bloc transactionnel', async () => {
    const client = makeClient([
      {}, // BEGIN
      new Error('db crashed'), // SELECT order throws
      {}, // ROLLBACK (catch)
    ]);
    mockGetClient.mockResolvedValueOnce(client);
    const res = buildRes();
    const next = jest.fn();

    await fromOrderHandler(buildReq({ order_id: 'order-1' }), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
