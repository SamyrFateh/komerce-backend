'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => {
  const query = jest.fn();
  return { query, withTransaction: jest.fn((cb) => cb({ query })) };
});
const mockMarkRevealed = jest.fn();
jest.mock('../../services/order-mutation-service', () => ({ markPickupSecretRevealed: (...a) => mockMarkRevealed(...a) }));
jest.mock('../../utils/pickup-receipt-html', () => ({ buildReceiptHTML: jest.fn(() => '<html>receipt</html>') }));
jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), warn: jest.fn() }) }));

const db = require('../../db');
const {
  cacheCodeForReveal,
  issuePrintToken,
  getReceiptHTML,
  revealOnce,
  consumeRevealCodeOnce,
} = require('../../services/pickup-secret-access-service');

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
  mockMarkRevealed.mockReset();
});

describe('pickup-secret-access-service', () => {
  test('cacheCodeForReveal utilise un cache DB one-shot avec TTL', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await cacheCodeForReveal('o1', 'ABC-DEF-GH');
    expect(db.query).toHaveBeenCalledWith(expect.stringMatching(/pickup_reveal_codes[\s\S]*30 minutes/), ['o1', 'ABC-DEF-GH']);
  });

  test('cacheCodeForReveal peut partager la transaction qui rend le colis disponible', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await cacheCodeForReveal('o1', 'ABC-DEF-GH', client);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('pickup_reveal_codes'), ['o1', 'ABC-DEF-GH']);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('issuePrintToken crée un token éphémère de 48 caractères hex', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const token = await issuePrintToken({ orderId: 'o1', code: 'ABC-DEF-GH', payerName: 'Sam' });
    expect(token).toMatch(/^[a-f0-9]{48}$/);
    expect(db.query).toHaveBeenCalledWith(expect.stringMatching(/pickup_print_tokens[\s\S]*2 minutes/), [token, 'o1', 'ABC-DEF-GH', 'Sam']);
  });

  test('getReceiptHTML refuse un accès sans token avant toute requête', async () => {
    await expect(getReceiptHTML({ orderId: 'o1', token: null })).resolves.toEqual({ status: 400, error: 'Token manquant' });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('revealOnce ne révèle rien pour une commande inconnue', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(revealOnce({ orderId: 'missing', userId: 'u1' })).resolves.toEqual({
      status: 404,
      body: { error: 'Commande introuvable' },
    });
  });

  const freshOrder = (over = {}) => ({
    id: 'o1', reference: 'R1', user_id: 'u1', pickup_code_recipient_user_id: null,
    pickup_secret_channel: 'stripe', pickup_secret_emitted_at: new Date().toISOString(),
    pickup_secret_revealed_at: null, pickup_secret_last4: 'AB12', pickup_secret_hash: 'h', total_kmf: 100,
    ...over,
  });

  test('revealOnce : commande sans destinataire ni propriétaire -> 403 (jamais d\'accès ouvert)', async () => {
    db.query.mockResolvedValueOnce({ rows: [freshOrder({ user_id: null })] });
    const r = await revealOnce({ orderId: 'o1', userId: 'u1' });
    expect(r.status).toBe(403);
    expect(mockMarkRevealed).not.toHaveBeenCalled();
  });

  test('revealOnce : 2 appels concurrents -> exactement un 200 (garde IS NULL)', async () => {
    db.query.mockResolvedValue({ rows: [freshOrder()] });
    mockMarkRevealed.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValue({ rowCount: 0 });
    db.withTransaction.mockImplementation((cb) => cb({ query: jest.fn().mockResolvedValue({ rows: [{ code: 'A7K-3M9-P2' }] }) }));
    const [a, b] = await Promise.all([
      revealOnce({ orderId: 'o1', userId: 'u1' }),
      revealOnce({ orderId: 'o1', userId: 'u1' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 410]);
    expect(mockMarkRevealed).toHaveBeenCalledTimes(2);
  });

  test('revealOnce : code absent -> 410 et rollback (revealed_at non conservé)', async () => {
    db.query.mockResolvedValueOnce({ rows: [freshOrder()] });
    mockMarkRevealed.mockResolvedValueOnce({ rowCount: 1 });
    let rolledBack = false;
    db.withTransaction.mockImplementationOnce(async (cb) => {
      try { return await cb({ query: jest.fn().mockResolvedValue({ rows: [] }) }); }
      catch (e) { rolledBack = true; throw e; }
    });
    const r = await revealOnce({ orderId: 'o1', userId: 'u1' });
    expect(r.status).toBe(410);
    expect(rolledBack).toBe(true);
  });

  test('consumeRevealCodeOnce propage une erreur SQL inattendue', async () => {
    mockMarkRevealed.mockRejectedValueOnce(new Error('db down'));
    db.withTransaction.mockImplementationOnce((cb) => cb({ query: jest.fn() }));
    await expect(consumeRevealCodeOnce('o1')).rejects.toThrow('db down');
  });
});
