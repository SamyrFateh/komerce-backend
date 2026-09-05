'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/order-mutation-service', () => ({ markPickupSecretRevealed: jest.fn() }));
jest.mock('../../utils/pickup-receipt-html', () => ({ buildReceiptHTML: jest.fn(() => '<html>receipt</html>') }));
jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), warn: jest.fn() }) }));

const db = require('../../db');
const {
  cacheCodeForReveal,
  issuePrintToken,
  getReceiptHTML,
  revealOnce,
} = require('../../services/pickup-secret-access-service');

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
});

describe('pickup-secret-access-service', () => {
  test('cacheCodeForReveal utilise un cache DB one-shot avec TTL', async () => {
    db.query.mockResolvedValue({ rows: [] });
    await cacheCodeForReveal('o1', 'ABC-DEF-GH');
    expect(db.query).toHaveBeenCalledWith(expect.stringMatching(/pickup_reveal_codes[\s\S]*30 minutes/), ['o1', 'ABC-DEF-GH']);
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
});
