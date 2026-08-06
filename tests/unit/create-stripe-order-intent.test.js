/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : create-stripe-order-intent (P0 payments)
 *
 * Couvre createStripeOrderIntent : validation des entrées, contrôle d'accès,
 * garde-fous métier (mode de paiement, statut déjà payé, montant invalide),
 * et idempotence de création du PaymentIntent Stripe.
 *
 * Run : npx jest tests/unit/create-stripe-order-intent.test.js
 */

'use strict';

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockRetrieve = jest.fn();
const mockCreate = jest.fn();
jest.mock('stripe', () => {
  return jest.fn(() => ({
    paymentIntents: {
      retrieve: (...args) => mockRetrieve(...args),
      create: (...args) => mockCreate(...args),
    },
  }));
});

const { createStripeOrderIntent } = require('../../services/create-stripe-order-intent');

function buildOrder(overrides = {}) {
  return {
    id: 'order-1',
    reference: 'KMC-001',
    user_id: 'user-1',
    total_eur: '49.90',
    payment_mode: 'stripe_eur',
    payment_status: 'pending',
    stripe_payment_id: null,
    ...overrides,
  };
}

describe('createStripeOrderIntent', () => {
  beforeEach(() => {
    mockDbQuery.mockReset();
    mockRetrieve.mockReset();
    mockCreate.mockReset();
  });

  test('rejette si order_reference manquant', async () => {
    const result = await createStripeOrderIntent({ user: { id: 'user-1', role: 'client' } });
    expect(result.status).toBe(400);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('lève si user absent ou incomplet', async () => {
    await expect(
      createStripeOrderIntent({ orderReference: 'KMC-001', user: null })
    ).rejects.toThrow('[createStripeOrderIntent] user requis');

    await expect(
      createStripeOrderIntent({ orderReference: 'KMC-001', user: { id: 'user-1' } })
    ).rejects.toThrow('[createStripeOrderIntent] user requis');
  });

  test('renvoie 404 si commande introuvable', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const result = await createStripeOrderIntent({
      orderReference: 'KMC-999',
      user: { id: 'user-1', role: 'client' },
    });

    expect(result.status).toBe(404);
  });

  test('refuse l\'accès si la commande n\'appartient pas au client', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [buildOrder({ user_id: 'other-user' })] });

    const result = await createStripeOrderIntent({
      orderReference: 'KMC-001',
      user: { id: 'user-1', role: 'client' },
    });

    expect(result.status).toBe(403);
  });

  test('autorise un rôle privilégié sur une commande d\'un autre utilisateur', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [buildOrder({ user_id: 'other-user' })] })
      .mockResolvedValueOnce({});

    mockCreate.mockResolvedValueOnce({
      id: 'pi_new',
      client_secret: 'secret_new',
    });

    const result = await createStripeOrderIntent({
      orderReference: 'KMC-001',
      user: { id: 'admin-1', role: 'admin' },
    });

    expect(result.status).toBe(200);
  });

  test('rejette si le mode de paiement n\'est pas stripe_eur', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [buildOrder({ payment_mode: 'cash_kmf' })] });

    const result = await createStripeOrderIntent({
      orderReference: 'KMC-001',
      user: { id: 'user-1', role: 'client' },
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/Stripe/);
  });

  test('rejette si la commande est déjà payée', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [buildOrder({ payment_status: 'paid' })] });

    const result = await createStripeOrderIntent({
      orderReference: 'KMC-001',
      user: { id: 'user-1', role: 'client' },
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/déjà payée/);
  });

  test('rejette si le montant est invalide (<= 0)', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [buildOrder({ total_eur: '0' })] });

    const result = await createStripeOrderIntent({
      orderReference: 'KMC-001',
      user: { id: 'user-1', role: 'client' },
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/Montant Stripe invalide/);
  });

  test('réutilise un PaymentIntent existant si encore valide', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [buildOrder({ stripe_payment_id: 'pi_existing' })],
    });

    mockRetrieve.mockResolvedValueOnce({
      id: 'pi_existing',
      status: 'requires_payment_method',
      client_secret: 'secret_existing',
    });

    const result = await createStripeOrderIntent({
      orderReference: 'KMC-001',
      user: { id: 'user-1', role: 'client' },
    });

    expect(result.status).toBe(200);
    expect(result.body.reused).toBe(true);
    expect(result.body.stripe_payment_id).toBe('pi_existing');
    expect(mockCreate).not.toHaveBeenCalled();
    // Pas de second appel DB (pas d'UPDATE) puisque l'intent existant est réutilisé
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  test('crée un nouvel intent si l\'intent existant est succeeded/canceled', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [buildOrder({ stripe_payment_id: 'pi_old' })] })
      .mockResolvedValueOnce({});

    mockRetrieve.mockResolvedValueOnce({ id: 'pi_old', status: 'succeeded' });
    mockCreate.mockResolvedValueOnce({ id: 'pi_new', client_secret: 'secret_new' });

    const result = await createStripeOrderIntent({
      orderReference: 'KMC-001',
      user: { id: 'user-1', role: 'client' },
    });

    expect(result.status).toBe(200);
    expect(result.body.reused).toBe(false);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][1]).toEqual({ idempotencyKey: 'pi_order_order-1' });
  });

  test('continue la création si le retrieve Stripe échoue', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [buildOrder({ stripe_payment_id: 'pi_broken' })] })
      .mockResolvedValueOnce({});

    mockRetrieve.mockRejectedValueOnce(new Error('stripe down'));
    mockCreate.mockResolvedValueOnce({ id: 'pi_new', client_secret: 'secret_new' });

    const result = await createStripeOrderIntent({
      orderReference: 'KMC-001',
      user: { id: 'user-1', role: 'client' },
    });

    expect(result.status).toBe(200);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test('crée un nouvel intent sans stripe_payment_id préalable et met à jour la commande', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [buildOrder()] })
      .mockResolvedValueOnce({});

    mockCreate.mockResolvedValueOnce({ id: 'pi_new', client_secret: 'secret_new' });

    const result = await createStripeOrderIntent({
      orderReference: 'KMC-001',
      user: { id: 'user-1', role: 'client' },
    });

    expect(result.status).toBe(200);
    expect(result.body.client_secret).toBe('secret_new');
    expect(result.body.amount_cents).toBe(4990);
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
    expect(mockDbQuery.mock.calls[1][0]).toMatch(/UPDATE orders/);
  });
});
