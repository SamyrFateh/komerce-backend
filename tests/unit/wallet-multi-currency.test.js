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

  describe('dépense dans la devise du marché (XAF) — décision propriétaire 12/11, #3927', () => {
    // Taux de test uniquement dans le mock : la production passe par fx-authority / currency_parities.
    const mockParity = { available: true };
    const RATE = 1.33333333; // XAF pour 1 KMF (mock)
    let fx;
    beforeEach(() => {
      mockParity.available = true;
      fx = require('../../services/fx-authority');
      jest.spyOn(fx, 'convert').mockImplementation(async ({ amount, from, to }) => {
        if (!mockParity.available) throw new fx.FxError('parité absente', 'fx_parity_missing', 422);
        const v = from === 'KMF' ? Number(amount) * RATE : Number(amount) / RATE;
        return { amount: Math.round(v) };
      });
    });
    afterEach(() => jest.restoreAllMocks());

    function fakeClient({ balance, currency, total = 1000, applied = 0, market = 'XAF' }) {
      const state = { debits: [], balance, walletApplied: null };
      const client = { query: jest.fn(async (sql, p) => {
        if (/FROM orders WHERE id/.test(sql)) return { rows: [{ id: 'o', user_id: 'u1', reference: 'R', total_kmf: total, wallet_applied_kmf: applied, market_id: market ? 'm' : null }] };
        if (/FROM markets/.test(sql)) return { rows: [{ currency: market }] };
        if (/FROM wallets WHERE user_id/.test(sql)) return { rows: [{ id: 'w', currency: p[1], balance_kmf: state.balance }] };
        if (/idempotency_key/.test(sql) && /^\s*SELECT/.test(sql)) return { rows: [] };
        if (/UPDATE wallets SET balance_kmf = balance_kmf - /.test(sql)) { state.debits.push({ amount: p[0], currency }); return { rows: [{ balance_kmf: state.balance - p[0] }] }; }
        if (/INSERT INTO wallet_transactions/.test(sql)) return { rows: [{ id: 'tx', amount_kmf: p[2] }] };
        if (/FROM wallet_credit_lots/.test(sql)) return { rows: [{ id: 'lot', remaining_kmf: state.balance, created_at: 1 }] };
        if (/INSERT INTO wallet_consumptions/.test(sql)) return { rows: [{ id: 'c', amount_kmf: p[3] }] };
        if (/UPDATE orders SET wallet_applied_kmf/.test(sql)) { state.walletApplied = p[0]; return { rows: [] }; }
        return { rows: [{}] };
      }) };
      return { client, state };
    }

    it('KMF inchangé : débit = équivalent, aucune conversion', async () => {
      const { client } = fakeClient({ balance: 5000, total: 3000, market: null });
      const plan = await walletService.planWalletSpend(client, { userId: 'u1', currency: 'KMF', remainingKmf: 3000 });
      expect(plan).toEqual({ currency: 'KMF', debit: 3000, equivKmf: 3000 });
      expect(fx.convert).not.toHaveBeenCalled();
    });

    it('XAF : débit en XAF (entier), équivalent KMF via fx-authority, jamais au-delà du reste', async () => {
      const { client } = fakeClient({ balance: 500 });
      const partial = await walletService.planWalletSpend(client, { userId: 'u1', currency: 'XAF', remainingKmf: 1000 });
      expect(partial.currency).toBe('XAF');
      expect(Number.isInteger(partial.debit)).toBe(true);
      expect(partial.debit).toBe(500);
      expect(partial.equivKmf).toBeLessThanOrEqual(1000);
      const { client: rich } = fakeClient({ balance: 99999 });
      const full = await walletService.planWalletSpend(rich, { userId: 'u1', currency: 'XAF', remainingKmf: 1000 });
      expect(full.debit).toBe(1333);
      expect(full.equivKmf).toBe(1000);
    });

    it('applyToOrder XAF : débite le wallet XAF, écrit l’équivalent KMF sur la commande', async () => {
      const { client, state } = fakeClient({ balance: 500 });
      const r = await walletService.applyToOrder(client, { userId: 'u1', orderId: 'o' });
      expect(r.currency).toBe('XAF');
      expect(r.debited).toBe(500);
      expect(state.debits).toEqual([{ amount: 500, currency: undefined }]);
      expect(state.walletApplied).toBe(r.applied_kmf);
      expect(r.applied_kmf).toBeLessThan(1000);
      expect(client.query.mock.calls.some(([sql, p]) => /FROM wallets WHERE user_id/.test(sql) && p[1] !== 'XAF')).toBe(false);
    });

    it('parité absente : refus explicite 409 sans débit', async () => {
      mockParity.available = false;
      const { client, state } = fakeClient({ balance: 500 });
      await expect(walletService.applyToOrder(client, { userId: 'u1', orderId: 'o' }))
        .rejects.toMatchObject({ code: 'WALLET_FX_PARITY_UNAVAILABLE', statusCode: 409 });
      expect(state.debits).toHaveLength(0);
    });

    it('removeFromOrder recrédite le même montant, en XAF, sur le même wallet', async () => {
      const calls = [];
      const client = { query: jest.fn(async (sql, p) => {
        calls.push({ sql, p });
        if (/FROM wallet_consumptions wc/.test(sql)) return { rows: [{ amount_kmf: 500, credit_lot_id: 'lot', wallet_id: 'w' }] };
        if (/UPDATE wallets SET balance_kmf = balance_kmf \+/.test(sql)) return { rows: [{ balance_kmf: 500, currency: 'XAF' }] };
        if (/INSERT INTO wallet_transactions/.test(sql)) return { rows: [{ id: 'tx' }] };
        return { rows: [] };
      }) };
      const r = await walletService.removeFromOrder(client, { orderId: 'o' });
      expect(r.reversed_kmf).toBe(500);
      expect(r.currency).toBe('XAF');
      expect(fx.convert).not.toHaveBeenCalled();
      expect(calls.find(c => /UPDATE wallets SET balance_kmf = balance_kmf \+/.test(c.sql)).p).toEqual([500, 'w']);
    });
  });
});
