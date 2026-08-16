/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires: wallet-service.js (V2.6 — P1 concurrence)
 *
 * Couvre:
 *   ✅ credit() — création de lots
 *   ✅ credit() — idempotence via idempotencyKey
 *   ✅ credit()/debit() — récupération 23505 via SAVEPOINT
 *   ✅ debit() — consommation FIFO
 *   ✅ debit() — insufficient balance
 *   ✅ reverseLot() — block if consumed
 *   ✅ reverseLot() — block negative balance
 *
 * Strategy: mock db.getClient() and db.query(). Les commandes transactionnelles
 * SAVEPOINT/ROLLBACK TO/RELEASE sont interceptées séparément pour ne pas
 * consommer les fixtures de requêtes métier ; elles restent assertables via
 * mockClient.query.mock.calls.
 * Run: npx jest tests/unit/wallet-service.test.js
 */

// ── Mock DB module before require ───────────────────────────────────────────

const mockQuery = jest.fn();
const mockClient = {
  query: jest.fn((sql, params) => {
    const command = typeof sql === 'string' ? sql.trim() : '';
    if (/^(SAVEPOINT|ROLLBACK TO SAVEPOINT|RELEASE SAVEPOINT)\b/i.test(command)) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    return mockQuery(sql, params);
  }),
  release: jest.fn(),
};
const mockWithTransaction = jest.fn(async (callback) => callback(mockClient));

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(() => mockClient),
  pool: { connect: jest.fn(() => mockClient) },
  withTransaction: mockWithTransaction,
}));

jest.mock('../../services/documents/wallet-receipt', () => ({
  issue: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
}));

const db = require('../../db');
const walletReceiptService = require('../../services/documents/wallet-receipt');
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
    // Only 1 data query (the idempotence check)
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('23505 concurrent sur idx_wtx_idempotency → rollback du mouvement perdant puis duplicate=true', async () => {
    const uniqueViolation = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'idx_wtx_idempotency',
      detail: 'Key (idempotency_key)=(refund_same) already exists.',
    });
    const existingTx = { id: 'tx-winner', type: 'credit', amount_kmf: 5000, idempotency_key: 'refund_same' };

    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // fast dup check
      .mockResolvedValueOnce({ rows: [{ id: 'wallet-1', user_id: 'user-1', balance_kmf: 0 }] }) // wallet FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ balance_kmf: 5000 }] }) // losing balance UPDATE
      .mockRejectedValueOnce(uniqueViolation) // INSERT ledger loses uniqueness race
      .mockResolvedValueOnce({ rows: [existingTx] }); // winner visible after ROLLBACK TO

    const result = await walletService.credit(mockClient, {
      userId: 'user-1',
      amountKmf: 5000,
      reason: 'order_cancel',
      idempotencyKey: 'refund_same',
    });

    expect(result).toEqual({ transaction: existingTx, duplicate: true });
    const controlSql = mockClient.query.mock.calls.map(([sql]) => String(sql).trim());
    expect(controlSql).toContain('SAVEPOINT wallet_idempotency_guard');
    expect(controlSql).toContain('ROLLBACK TO SAVEPOINT wallet_idempotency_guard');
    expect(controlSql).toContain('RELEASE SAVEPOINT wallet_idempotency_guard');
    // Aucun lot n'est créé par le perdant : 5 requêtes métier, la dernière est
    // la relecture de la transaction gagnante.
    expect(mockQuery).toHaveBeenCalledTimes(5);
  });

  test('pool canonique db → mutation automatiquement enveloppée par withTransaction', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'wallet-1', user_id: 'user-1', balance_kmf: 0 }] })
      .mockResolvedValueOnce({ rows: [{ balance_kmf: 1000 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tx-1', type: 'credit', amount_kmf: 1000 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'lot-1', remaining_kmf: 1000 }] });

    const result = await walletService.credit(db, {
      userId: 'user-1', amountKmf: 1000, reason: 'order_cancel',
    });

    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(result.duplicate).toBe(false);
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

  test('23505 concurrent sur idx_wtx_idempotency → rollback du débit perdant puis duplicate=true', async () => {
    const uniqueViolation = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'idx_wtx_idempotency',
      detail: 'Key (idempotency_key)=(checkout_same) already exists.',
    });
    const existingTx = { id: 'tx-winner', type: 'debit', amount_kmf: 3000, idempotency_key: 'checkout_same' };

    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // fast dup check
      .mockResolvedValueOnce({ rows: [{ id: 'wallet-1', user_id: 'user-1', balance_kmf: 10000 }] })
      .mockResolvedValueOnce({ rows: [{ balance_kmf: 7000 }] }) // losing debit UPDATE
      .mockRejectedValueOnce(uniqueViolation) // INSERT ledger loses race
      .mockResolvedValueOnce({ rows: [existingTx] }); // winner read after rollback-to-savepoint

    const result = await walletService.debit(mockClient, {
      userId: 'user-1', amountKmf: 3000, reason: 'checkout', idempotencyKey: 'checkout_same',
    });

    expect(result).toEqual({ transaction: existingTx, consumptions: [], duplicate: true });
    const controlSql = mockClient.query.mock.calls.map(([sql]) => String(sql).trim());
    expect(controlSql).toContain('SAVEPOINT wallet_idempotency_guard');
    expect(controlSql).toContain('ROLLBACK TO SAVEPOINT wallet_idempotency_guard');
    expect(controlSql).toContain('RELEASE SAVEPOINT wallet_idempotency_guard');
    // Pas de SELECT lots / consommation par le perdant.
    expect(mockQuery).toHaveBeenCalledTimes(5);
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

  test('succeeds — deducts balance, marks lot reversed, insert reversal tx', async () => {
    mockQuery
      // SELECT lot FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'lot-1', status: 'active', remaining_kmf: 2000, wallet_id: 'w-1', source_order_id: 'order-1' }] })
      // consumption count
      .mockResolvedValueOnce({ rows: [{ c: 0 }] })
      // SELECT wallet balance
      .mockResolvedValueOnce({ rows: [{ balance_kmf: 5000 }] })
      // UPDATE wallet balance (atomic)
      .mockResolvedValueOnce({ rows: [{ balance_kmf: 3000 }] })
      // UPDATE lot status
      .mockResolvedValueOnce({ rows: [{}] })
      // INSERT wallet_transactions
      .mockResolvedValueOnce({ rows: [{ id: 'tx-rev', amount_kmf: 2000 }] });

    const result = await walletService.reverseLot(mockClient, {
      lotId: 'lot-1', adminId: 'admin-1', note: 'Erreur saisie',
    });

    expect(result.reversed_kmf).toBe(2000);
    expect(result.walletTxId).toBe('tx-rev');
    expect(result.transaction.id).toBe('tx-rev');
  });

  test('throws when lot not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      walletService.reverseLot(mockClient, { lotId: 'missing', adminId: 'admin-1' })
    ).rejects.toThrow('introuvable');
  });

  test('throws for a non-active, non-reversed lot status', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'lot-1', status: 'expired', remaining_kmf: 1000, wallet_id: 'w-1' }],
    });

    await expect(
      walletService.reverseLot(mockClient, { lotId: 'lot-1', adminId: 'admin-1' })
    ).rejects.toThrow('expired');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// debit() — idempotence
// ═══════════════════════════════════════════════════════════════════════════════

describe('wallet debit() idempotence', () => {
  test('returns duplicate=true on idempotencyKey match, no further queries', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'tx-existing', type: 'debit' }] });

    const result = await walletService.debit(mockClient, {
      userId: 'user-1',
      amountKmf: 1000,
      reason: 'checkout',
      idempotencyKey: 'checkout_order-1',
    });

    expect(result.duplicate).toBe(true);
    expect(result.consumptions).toEqual([]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getOrCreateWallet()
// ═══════════════════════════════════════════════════════════════════════════════

describe('getOrCreateWallet()', () => {
  test('returns existing wallet without insert when found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'w-1', user_id: 'user-1', balance_kmf: 500 }] });

    const wallet = await walletService.getOrCreateWallet(mockClient, 'user-1');

    expect(wallet.id).toBe('w-1');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).not.toMatch(/FOR UPDATE/);
  });

  test('applies FOR UPDATE lock when forUpdate=true', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'w-1', balance_kmf: 0 }] });

    await walletService.getOrCreateWallet(mockClient, 'user-1', { forUpdate: true });

    expect(mockQuery.mock.calls[0][0]).toMatch(/FOR UPDATE/);
  });

  test('creates wallet via INSERT when not found', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // SELECT not found
      .mockResolvedValueOnce({ rows: [{ id: 'w-new', user_id: 'user-2', balance_kmf: 0 }] }); // INSERT

    const wallet = await walletService.getOrCreateWallet(mockClient, 'user-2');

    expect(wallet.id).toBe('w-new');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// issueReceiptForCredit()
// ═══════════════════════════════════════════════════════════════════════════════

describe('issueReceiptForCredit()', () => {
  test('delegates to walletReceiptService.issue', async () => {
    walletReceiptService.issue.mockResolvedValueOnce({ id: 'receipt-1' });

    const result = await walletService.issueReceiptForCredit('tx-1', 'admin-1');

    expect(walletReceiptService.issue).toHaveBeenCalledWith('tx-1', { issuedBy: 'admin-1' });
    expect(result).toEqual({ id: 'receipt-1' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// applyToOrder()
// ═══════════════════════════════════════════════════════════════════════════════

describe('applyToOrder()', () => {
  test('applies wallet to order and marks paid when fully covered', async () => {
    mockQuery
      // SELECT order
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', user_id: 'user-1', total_kmf: 3000, reference: 'KMC-001' }] })
      // getOrCreateWallet (no forUpdate)
      .mockResolvedValueOnce({ rows: [{ id: 'w-1', balance_kmf: 5000 }] })
      // debit(): idempotence check
      .mockResolvedValueOnce({ rows: [] })
      // debit(): getOrCreateWallet FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'w-1', balance_kmf: 5000 }] })
      // debit(): UPDATE balance
      .mockResolvedValueOnce({ rows: [{ balance_kmf: 2000 }] })
      // debit(): INSERT transaction
      .mockResolvedValueOnce({ rows: [{ id: 'tx-1', type: 'debit' }] })
      // debit(): SELECT lots FIFO
      .mockResolvedValueOnce({ rows: [{ id: 'lot-1', remaining_kmf: 3000, created_at: '2026-01-01' }] })
      // debit(): UPDATE lot
      .mockResolvedValueOnce({ rows: [{}] })
      // debit(): INSERT consumption
      .mockResolvedValueOnce({ rows: [{ id: 'cons-1', amount_kmf: 3000 }] })
      // applyToOrder(): UPDATE orders (wallet_applied_kmf)
      .mockResolvedValueOnce({ rows: [{}] })
      // markPaid(): UPDATE orders (payment_status via payment-service.js)
      .mockResolvedValueOnce({ rows: [{}], rowCount: 1 });

    const result = await walletService.applyToOrder(mockClient, {
      userId: 'user-1', orderId: 'order-1', amountKmf: 3000,
    });

    expect(result.applied_kmf).toBe(3000);
    expect(result.remaining_to_pay).toBe(0);
  });

  test('P5-N2/N3 : abandonne (throw) si markPaid ne peut pas passer payment_status à paid', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', user_id: 'user-1', total_kmf: 3000, reference: 'KMC-001' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'w-1', balance_kmf: 5000 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'w-1', balance_kmf: 5000 }] })
      .mockResolvedValueOnce({ rows: [{ balance_kmf: 2000 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tx-1', type: 'debit' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'lot-1', remaining_kmf: 3000, created_at: '2026-01-01' }] })
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{ id: 'cons-1', amount_kmf: 3000 }] })
      // applyToOrder(): UPDATE orders (wallet_applied_kmf)
      .mockResolvedValueOnce({ rows: [{}] })
      // markPaid(): no-op — la garde du validateur a bloqué la transition
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      walletService.applyToOrder(mockClient, { userId: 'user-1', orderId: 'order-1', amountKmf: 3000 })
    ).rejects.toThrow(/payment_status/);
  });

  test('throws when order not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      walletService.applyToOrder(mockClient, { userId: 'user-1', orderId: 'missing', amountKmf: 100 })
    ).rejects.toThrow('introuvable');
  });

  test('throws 403 when order does not belong to user', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'order-1', user_id: 'other-user', total_kmf: 1000 }],
    });

    await expect(
      walletService.applyToOrder(mockClient, { userId: 'user-1', orderId: 'order-1', amountKmf: 100 })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('throws when nothing to apply (max <= 0)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', user_id: 'user-1', total_kmf: 1000 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'w-1', balance_kmf: 0 }] });

    await expect(
      walletService.applyToOrder(mockClient, { userId: 'user-1', orderId: 'order-1', amountKmf: 500 })
    ).rejects.toThrow('Rien à appliquer');
  });

  // ── Reproduction exacte du défaut clôturé (RECONCILIATION §4.7) ──────────
  test('P5-wallet — second appel avec la même clé checkout_<orderId> : duplicate:true, aucun nouveau débit, wallet_applied_kmf et payment_status inchangés', async () => {
    const ALREADY_APPLIED = 1200;
    const TOTAL_KMF = 3000;

    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'order-1', user_id: 'user-1', reference: 'KMC-777',
          total_kmf: TOTAL_KMF, wallet_applied_kmf: ALREADY_APPLIED,
          payment_status: 'pending',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'w-1', balance_kmf: 5000 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tx-existing', idempotency_key: 'checkout_order-1', amount_kmf: ALREADY_APPLIED }] });

    const queriesBeforeCall = mockQuery.mock.calls.length;

    const result = await walletService.applyToOrder(mockClient, {
      userId: 'user-1', orderId: 'order-1', amountKmf: 1800,
    });

    expect(result.duplicate).toBe(true);
    expect(result.applied_kmf).toBe(ALREADY_APPLIED);
    expect(result.remaining_to_pay).toBe(TOTAL_KMF - ALREADY_APPLIED);
    expect(mockQuery.mock.calls.length).toBe(queriesBeforeCall + 3);

    const updateOrdersCalls = mockQuery.mock.calls.filter(
      ([sql]) => /UPDATE\s+orders/i.test(sql)
    );
    expect(updateOrdersCalls.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// removeFromOrder()
// ═══════════════════════════════════════════════════════════════════════════════

describe('removeFromOrder()', () => {
  test('no-op idempotent when no active consumptions', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await walletService.removeFromOrder(mockClient, { orderId: 'order-1' });

    expect(result).toEqual({ transaction: null, reversed_kmf: 0, noop: true });
  });

  test('reverses consumptions and re-credits wallet', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { credit_lot_id: 'lot-1', amount_kmf: 1000, wallet_id: 'w-1' },
          { credit_lot_id: 'lot-2', amount_kmf: 500, wallet_id: 'w-1' },
        ],
      })
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{ balance_kmf: 4500 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tx-reversal', amount_kmf: 1500 }] })
      .mockResolvedValueOnce({ rows: [{}] });

    const result = await walletService.removeFromOrder(mockClient, { orderId: 'order-1' });

    expect(result.reversed_kmf).toBe(1500);
    expect(result.transaction.id).toBe('tx-reversal');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// createCreditFromCancel()
// ═══════════════════════════════════════════════════════════════════════════════

describe('createCreditFromCancel()', () => {
  test('throws when order not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      walletService.createCreditFromCancel(mockClient, { orderId: 'missing', adminId: 'admin-1' })
    ).rejects.toThrow('introuvable');
  });

  test('credits wallet with order total when amountKmf omitted', async () => {
    mockQuery
      // SELECT order
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', user_id: 'user-1', total_kmf: 2500, reference: 'KMC-002' }] })
      // credit(): idempotence dup check → not found
      .mockResolvedValueOnce({ rows: [] })
      // credit(): getOrCreateWallet FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'w-1', balance_kmf: 0 }] })
      // credit(): UPDATE balance
      .mockResolvedValueOnce({ rows: [{ balance_kmf: 2500 }] })
      // credit(): INSERT transaction
      .mockResolvedValueOnce({ rows: [{ id: 'tx-cancel-credit', amount_kmf: 2500 }] })
      // credit(): INSERT lot
      .mockResolvedValueOnce({ rows: [{ id: 'lot-cancel', remaining_kmf: 2500 }] });

    const result = await walletService.createCreditFromCancel(mockClient, { orderId: 'order-1', adminId: 'admin-1' });

    expect(result.transaction.amount_kmf).toBe(2500);
    expect(result.lot.remaining_kmf).toBe(2500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ensureWalletTables()
// ═══════════════════════════════════════════════════════════════════════════════

describe('ensureWalletTables() [LOT R2 — verification only, DDL owned by migrations/014c]', () => {
  test('all objects present → resolves, releases client, no throw', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        wallets: true,
        wallet_transactions: true,
        wallet_credit_lots: true,
        wallet_consumptions: true,
        idx_wtx_idempotency: true,
        wallet_applied_kmf: true,
      }],
    });

    await expect(walletService.ensureWalletTables()).resolves.toBeUndefined();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('missing object → throws (fail-closed), but still releases client', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        wallets: true,
        wallet_transactions: false,
        wallet_credit_lots: true,
        wallet_consumptions: true,
        idx_wtx_idempotency: true,
        wallet_applied_kmf: true,
      }],
    });

    await expect(walletService.ensureWalletTables()).rejects.toThrow(/wallet_transactions/);
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('client always released even on unexpected query error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    await expect(walletService.ensureWalletTables()).rejects.toThrow('connection refused');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Read-only queries (db.query directly, not client)
// ═══════════════════════════════════════════════════════════════════════════════

describe('getBalance()', () => {
  test('returns balance when wallet exists', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ balance_kmf: 1234 }] });

    const balance = await walletService.getBalance('user-1');

    expect(balance).toBe(1234);
  });

  test('returns 0 when wallet does not exist', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const balance = await walletService.getBalance('user-2');

    expect(balance).toBe(0);
  });
});

describe('getBalanceInTx()', () => {
  test('delegates to getOrCreateWallet and returns balance', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'w-1', balance_kmf: 777 }] });

    const balance = await walletService.getBalanceInTx(mockClient, 'user-1');

    expect(balance).toBe(777);
  });
});

describe('getTransactions()', () => {
  test('returns empty result when wallet not found', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const result = await walletService.getTransactions('user-1');

    expect(result).toEqual({ transactions: [], total: 0 });
  });

  test('returns paginated transactions with total', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'w-1' }] })
      .mockResolvedValueOnce({ rows: [{ c: 5 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tx-1' }, { id: 'tx-2' }] });

    const result = await walletService.getTransactions('user-1', { limit: 2, offset: 0 });

    expect(result.total).toBe(5);
    expect(result.transactions).toHaveLength(2);
  });
});

describe('listWallets()', () => {
  test('lists wallets without search filter', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ c: 10 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'w-1', full_name: 'Ali' }] });

    const result = await walletService.listWallets({});

    expect(result.total).toBe(10);
    expect(result.wallets).toHaveLength(1);
  });

  test('applies search filter across name/email/phone', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ c: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'w-2', full_name: 'Fatima' }] });

    const result = await walletService.listWallets({ search: 'fatima' });

    expect(result.total).toBe(1);
    expect(db.query.mock.calls[0][0]).toMatch(/ILIKE/);
    expect(db.query.mock.calls[0][1][0]).toBe('%fatima%');
  });
});

describe('getWalletDetail()', () => {
  test('returns null when wallet not found', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const result = await walletService.getWalletDetail('user-missing');

    expect(result).toBeNull();
  });

  test('returns wallet with transactions and lots', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'w-1', user_id: 'user-1', balance_kmf: 900 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tx-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'lot-1' }] });

    const result = await walletService.getWalletDetail('user-1');

    expect(result.wallet.id).toBe('w-1');
    expect(result.transactions).toHaveLength(1);
    expect(result.lots).toHaveLength(1);
  });
});
