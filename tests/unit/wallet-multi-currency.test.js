'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @brief Wallet multi-devise : un wallet par (utilisateur, devise), jamais de conversion implicite.
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn(), withTransaction: jest.fn() }));
jest.mock('../../utils/logger', () => {
  const f = jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
  return { child: f, forModule: f, info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
});
const walletService = require('../../services/wallet-service');

describe('wallet-service multi-devise', () => {
  it('getOrCreateWallet cible (user, devise) et crée le wallet de la devise demandée', async () => {
    const calls = [];
    const client = { query: jest.fn(async (sql, p) => { calls.push({ sql, p }); return /^SELECT/.test(sql.trim()) ? { rows: [] } : { rows: [{ id: 'w', currency: p[1] }] }; }) };
    const w = await walletService.getOrCreateWallet(client, 'u1', { currency: 'xaf' });
    expect(w.currency).toBe('XAF');
    expect(calls[0].sql).toMatch(/user_id = \$1 AND currency = \$2/);
    expect(calls[1].sql).toMatch(/ON CONFLICT \(user_id, currency\)/);
  });

  it('devise absente = KMF (compat) ; devise invalide refusée', async () => {
    const client = { query: jest.fn(async () => ({ rows: [{ id: 'w', currency: 'KMF' }] })) };
    await walletService.getOrCreateWallet(client, 'u1');
    expect(client.query.mock.calls[0][1]).toEqual(['u1', 'KMF']);
    expect(() => walletService.normalizeWalletCurrency('EURO')).toThrow();
  });

  it('applyToOrder : un wallet n’est utilisable que sur une commande de sa devise (XAF → 409 WALLET_CURRENCY_MISMATCH)', async () => {
    const client = { query: jest.fn(async (sql) => {
      if (/FROM orders WHERE id/.test(sql)) return { rows: [{ id: 'o', user_id: 'u1', total_kmf: 1000, wallet_applied_kmf: 0, market_id: 'm-cm' }] };
      if (/FROM markets/.test(sql)) return { rows: [{ currency: 'XAF' }] };
      return { rows: [] };
    }) };
    await expect(walletService.applyToOrder(client, { userId: 'u1', orderId: 'o', amountKmf: 100 }))
      .rejects.toMatchObject({ code: 'WALLET_CURRENCY_MISMATCH', statusCode: 409 });
  });
});
