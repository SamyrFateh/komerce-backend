/**
 * KOMERCE — Tests Unitaires: wallet-service.js (V2.5)
 *
 * Couvre:
 *   ✅ credit() — création de lots
 *   ✅ credit() — idempotence via idempotencyKey
 *   ✅ debit() — consommation FIFO
 *   ✅ debit() — insufficient balance
 *   ✅ reverseLot() — block if consumed
 *   ✅ reverseLot() — block negative balance
 *
 * Strategy: mock db.getClient() and db.query()
 * Run: npx jest tests/unit/wallet-service.test.js
 */

// ── Mock DB module before require ───────────────────────────────────────────

const mockQuery = jest.fn();
const mockClient = {
  query: mockQuery,
  release: jest.fn(),
};

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(() => mockClient),
  pool: { connect: jest.fn(() => mockClient) },
}));

const walletService = require('../../services/wallet-service');

beforeEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// credit()
// ═══════════════════════════════════════════════════════════════════════════════

describe('wallet credit()', () => {
  test('creates wallet + lot + transaction', async () => {
    const walletId = 'wallet-001';
    const txId = 'tx-001';
    const lotId = 'lot-001';

    // getOrCreateWallet: SELECT → not found → INSERT
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // SELECT wallet (not found)
      .mockResolvedValueOnce({ rows: [{ id: walletId, user_id: 'user-1', balance_kmf: 0 }] }) // INSERT wallet (ON CONFLICT)
      // credit: getOrCreateWallet FOR UPDATE
      // Actually the flow is: idempotence check → getOrCreateWallet(forUpdate) → UPDATE wallet → INSERT tx → INSERT lot
      // Let me re-mock properly...
    ;

    // Actually, let's mock the flow step by step:
    mockQuery.mockReset();
    // 1. Idempotence check (no idempotencyKey, so skipped)
    // 2. getOrCreateWallet (forUpdate: true)
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: walletId, user_id: 'user-1', balance_kmf: 0 }] }) // SELECT wallet FOR UPDATE
      // 3. UPDATE wallet balance
      .mockResolvedValueOnce({ rows: [{ balance_kmf: 5000 }] })
      // 4. INSERT wallet_transactions
      .mockResolvedValueOnce({ rows: [{ id: txId, type: 'credit', amount_kmf: 5000, balance_after_kmf: 5000 }] })
      // 5. INSERT wallet_credit_lots
      .mockResolvedValueOnce({ rows: [{ id: lotId, remaining_kmf: 5000 }] });

    const result = await walletService.credit(mockClient, {
      userId: 'user-1',
      amountKmf: 5000,
      reason: 'order_cancel',
      referenceId: 'order-1',
      note: 'Test credit',
    });

    expect(result.duplicate).toBe(false);
    expect(result.transaction.type).toBe('credit');
    expect(result.lot.remaining_kmf).toBe(5000);
  });

  test('returns duplicate=true on idempotencyKey match', async () => {
    const existingTx = { id: 'tx-existing', type: 'credit', amount_kmf: 5000 };

    // Idempotence check: found!
    mockQuery.mockResolvedValueOnce({ rows: [existingTx] });

    const result = await walletService.credit(mockClient, {
      userId: 'user-1',
      amountKmf: 5000,
      reason: 'order_cancel',
      idempotencyKey: 'cancel_order-1',
    });

    expect(result.duplicate).toBe(true);
    expect(result.transaction.id).toBe('tx-existing');
    // Only 1 query (the idempotence check)
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// debit()
// ═══════════════════════════════════════════════════════════════════════════════

describe('wallet debit()', () => {
  test('throws on insufficient balance', async () => {
    // getOrCreateWallet returns wallet with low balance
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'wallet-001', user_id: 'user-1', balance_kmf: 1000 }],
    });

    await expect(
      walletService.debit(mockClient, {
        userId: 'user-1',
        amountKmf: 5000,
        reason: 'checkout',
      })
    ).rejects.toThrow('Solde insuffisant');
  });

  test('FIFO consumption of credit lots', async () => {
    const walletId = 'wallet-001';

    mockQuery
      // getOrCreateWallet
      .mockResolvedValueOnce({ rows: [{ id: walletId, balance_kmf: 10000 }] })
      // UPDATE wallet balance
      .mockResolvedValueOnce({ rows: [{ balance_kmf: 5000 }] })
      // INSERT transaction
      .mockResolvedValueOnce({ rows: [{ id: 'tx-debit', type: 'debit', amount_kmf: 5000 }] })
      // SELECT lots FIFO (2 lots)
      .mockResolvedValueOnce({
        rows: [
          { id: 'lot-1', remaining_kmf: 3000, created_at: '2026-01-01' },
          { id: 'lot-2', remaining_kmf: 7000, created_at: '2026-01-02' },
        ],
      })
      // UPDATE lot-1
      .mockResolvedValueOnce({ rows: [{}] })
      // INSERT consumption for lot-1
      .mockResolvedValueOnce({ rows: [{ id: 'cons-1', amount_kmf: 3000 }] })
      // UPDATE lot-2
      .mockResolvedValueOnce({ rows: [{}] })
      // INSERT consumption for lot-2
      .mockResolvedValueOnce({ rows: [{ id: 'cons-2', amount_kmf: 2000 }] });

    const result = await walletService.debit(mockClient, {
      userId: 'user-1',
      amountKmf: 5000,
      reason: 'checkout',
      referenceId: 'order-1',
    });

    expect(result.duplicate).toBe(false);
    expect(result.consumptions).toHaveLength(2);
    // lot-1 fully consumed (3000), lot-2 partially (2000)
    expect(result.consumptions[0].amount_kmf).toBe(3000);
    expect(result.consumptions[1].amount_kmf).toBe(2000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// reverseLot()
// ═══════════════════════════════════════════════════════════════════════════════

describe('wallet reverseLot()', () => {
  test('blocks reversal on consumed lot', async () => {
    // SELECT lot FOR UPDATE
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'lot-1', status: 'active', remaining_kmf: 3000, wallet_id: 'w-1' }],
    });
    // SELECT consumption count
    mockQuery.mockResolvedValueOnce({ rows: [{ c: 2 }] });

    await expect(
      walletService.reverseLot(mockClient, { lotId: 'lot-1', adminId: 'admin-1' })
    ).rejects.toThrow('consommé');
  });

  test('blocks reversal on already reversed lot', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'lot-1', status: 'reversed', remaining_kmf: 0, wallet_id: 'w-1' }],
    });

    await expect(
      walletService.reverseLot(mockClient, { lotId: 'lot-1', adminId: 'admin-1' })
    ).rejects.toThrow('déjà annulé');
  });

  test('blocks if reversal would cause negative balance', async () => {
    // SELECT lot
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'lot-1', status: 'active', remaining_kmf: 5000, wallet_id: 'w-1' }],
    });
    // consumption count = 0
    mockQuery.mockResolvedValueOnce({ rows: [{ c: 0 }] });
    // SELECT wallet
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'w-1', balance_kmf: 3000 }], // less than lot remaining
    });

    await expect(
      walletService.reverseLot(mockClient, { lotId: 'lot-1', adminId: 'admin-1' })
    ).rejects.toThrow('négatif');
  });
});
