/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : payment-cash-confirm (R5)
 *
 * Couvre confirmCashByReference :
 *   - cash_ref_code introuvable → 404
 *   - cross-relais refusé → 403
 *   - stockBlocked → 409 + rollback
 *   - nominal → commit + confirmPaymentCycle
 *
 * Run : npx jest tests/unit/payment-cash-confirm.test.js
 */

'use strict';

const { makeClient } = require('../integration/test-harness/mock-db');

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  forModule: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockConfirmPaymentCycle = jest.fn();
jest.mock('../../services/order-payment-confirmation', () => ({
  confirmPaymentCycle: (...args) => mockConfirmPaymentCycle(...args),
}));

const mockNotifyPaymentConfirmed = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/notification-service', () => ({
  notifyPaymentConfirmed: (...args) => mockNotifyPaymentConfirmed(...args),
}));

const mockHandleOrderConfirmed = jest.fn().mockResolvedValue({ skipped: true });
jest.mock('../../services/loyalty-service', () => ({
  handleOrderConfirmed: (...args) => mockHandleOrderConfirmed(...args),
}));

const mockIssueInvoice = jest.fn().mockResolvedValue({ pdf_content: Buffer.from('%PDF') });
jest.mock('../../services/invoice-service', () => ({
  issueInvoice: (...args) => mockIssueInvoice(...args),
}));

const { confirmCashByReference } = require('../../services/payment-cash-confirm');

const triggerPurchasing = jest.fn().mockResolvedValue({ ok: true });

const ORDER = {
  id: 'order-1',
  reference: 'KMC-001',
  relais_id: 'relais-1',
  cash_ref_code: 'CASH-001',
};

function makeDb(client, extraQueryImpl) {
  return {
    pool: { connect: jest.fn().mockResolvedValue(client) },
    query: jest.fn(extraQueryImpl || (async () => ({ rows: [] }))),
  };
}

beforeEach(() => {
  mockConfirmPaymentCycle.mockReset();
  mockNotifyPaymentConfirmed.mockClear();
  mockHandleOrderConfirmed.mockClear();
  mockHandleOrderConfirmed.mockResolvedValue({ skipped: true });
  triggerPurchasing.mockClear();
});

describe('confirmCashByReference', () => {
  test('400 si cash_ref_code manquant', async () => {
    const db = makeDb(makeClient());
    const result = await confirmCashByReference({
      cashRefCode: '', actor: { id: 1, role: 'admin' }, triggerPurchasing, db,
    });
    expect(result.status).toBe(400);
  });

  test('404 si code introuvable ou déjà encaissé', async () => {
    const client = makeClient([{ rows: [] }]); // SELECT orders → vide
    const db = makeDb(client);

    const result = await confirmCashByReference({
      cashRefCode: 'CASH-XXX', actor: { id: 1, role: 'admin' }, triggerPurchasing, db,
    });

    expect(result.status).toBe(404);
    const { expectTransactionRolledBack } = require('../integration/test-harness/mock-db');
    expectTransactionRolledBack(client);
  });

  test('403 si cross-relais refusé pour agent_relais', async () => {
    const client = makeClient([
      { rows: [ORDER] },                         // SELECT orders
      { rows: [{ relais_id: 'relais-OTHER' }] },  // SELECT users relais_id
    ]);
    const db = makeDb(client);

    const result = await confirmCashByReference({
      cashRefCode: 'CASH-001', actor: { id: 42, role: 'agent_relais' }, triggerPurchasing, db,
    });

    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/autre relais/);
    const { expectTransactionRolledBack } = require('../integration/test-harness/mock-db');
    expectTransactionRolledBack(client);
  });

  test('403 si agent_relais sans relais_id configuré', async () => {
    const client = makeClient([
      { rows: [ORDER] },           // SELECT orders
      { rows: [{ relais_id: null }] }, // SELECT users relais_id
    ]);
    const db = makeDb(client);

    const result = await confirmCashByReference({
      cashRefCode: 'CASH-001', actor: { id: 42, role: 'agent_relais' }, triggerPurchasing, db,
    });

    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/Configuration agent incomplète/);
  });

  test('409 + rollback si stock insuffisant', async () => {
    const client = makeClient([
      { rows: [ORDER] }, // SELECT orders (actor admin → pas de check cross-relais)
    ]);
    const db = makeDb(client);

    mockConfirmPaymentCycle.mockResolvedValue({
      success: true,
      noop: false,
      stockBlocked: true,
      insufficientItems: [{ product_name: 'T-shirt', available: 0 }],
    });

    const result = await confirmCashByReference({
      cashRefCode: 'CASH-001', actor: { id: 1, role: 'admin' }, triggerPurchasing, db,
    });

    expect(result.status).toBe(409);
    expect(result.body.error).toMatch(/Stock insuffisant/);
    const { expectTransactionRolledBack } = require('../integration/test-harness/mock-db');
    expectTransactionRolledBack(client);
  });

  test('409 si confirmPaymentCycle rejette (non-noop, non-success)', async () => {
    const client = makeClient([
      { rows: [ORDER] },
    ]);
    const db = makeDb(client);

    mockConfirmPaymentCycle.mockResolvedValue({
      success: false, noop: false, stockBlocked: false, error: 'invalid_status',
    });

    const result = await confirmCashByReference({
      cashRefCode: 'CASH-001', actor: { id: 1, role: 'admin' }, triggerPurchasing, db,
    });

    expect(result.status).toBe(409);
    expect(result.body.error).toBe('invalid_status');
  });

  test('nominal : commit + confirmPaymentCycle + notif/purchasing post-commit', async () => {
    const client = makeClient([
      { rows: [ORDER] },        // SELECT orders
      { rows: [] },              // ensureSecretGenerated: SELECT hash/last4 existant
      { rows: [] },              // generateAndStoreSecret: anti-collision SELECT
      { rows: [], rowCount: 1 }, // generateAndStoreSecret: UPDATE orders (secret)
      { rows: [], rowCount: 1 }, // UPDATE orders SET cash_paid_at
    ]);
    const db = makeDb(client);

    mockConfirmPaymentCycle.mockResolvedValue({
      success: true, noop: false, stockBlocked: false,
    });

    const result = await confirmCashByReference({
      cashRefCode: 'CASH-001', actor: { id: 1, role: 'admin' }, triggerPurchasing, db,
    });

    expect(result.status).toBe(200);
    expect(result.body.reference).toBe('KMC-001');
    expect(result.body.message).toMatch(/confirmé/);

    const { expectTransactionCommitted } = require('../integration/test-harness/mock-db');
    expectTransactionCommitted(client);

    expect(mockConfirmPaymentCycle).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'order-1', source: 'cash_confirm',
    }));
    expect(mockNotifyPaymentConfirmed).toHaveBeenCalledWith('order-1', 'KMC-001');
    expect(triggerPurchasing).toHaveBeenCalledWith('order-1');
  });

  test('nominal pour agent_relais avec relais correspondant', async () => {
    const client = makeClient([
      { rows: [ORDER] },                          // SELECT orders
      { rows: [{ relais_id: 'relais-1' }] },      // SELECT users relais_id (match)
      { rows: [] },              // ensureSecretGenerated: SELECT hash/last4 existant
      { rows: [] },              // generateAndStoreSecret: anti-collision SELECT
      { rows: [], rowCount: 1 }, // generateAndStoreSecret: UPDATE orders (secret)
      { rows: [], rowCount: 1 },                  // UPDATE orders cash_paid_at
    ]);
    const db = makeDb(client);

    mockConfirmPaymentCycle.mockResolvedValue({
      success: true, noop: false, stockBlocked: false,
    });

    const result = await confirmCashByReference({
      cashRefCode: 'CASH-001', actor: { id: 42, role: 'agent_relais' }, triggerPurchasing, db,
    });

    expect(result.status).toBe(200);
  });
});

describe('confirmCashByReference — Lot A, branches manquantes', () => {
  test('403 si la requête users.relais_id échoue (checkPossible=false)', async () => {
    const client = makeClient([
      { rows: [ORDER] },
      { error: new Error('colonne relais_id inconnue') },
    ]);
    const db = makeDb(client);

    const result = await confirmCashByReference({
      cashRefCode: 'CASH-001', actor: { id: 42, role: 'agent_relais' }, triggerPurchasing, db,
    });

    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/Configuration agent incomplète/);
    const { expectTransactionRolledBack } = require('../integration/test-harness/mock-db');
    expectTransactionRolledBack(client);
  });

  test('cycle en noop (déjà traité ailleurs) → poursuit malgré success=false', async () => {
    const client = makeClient([
      { rows: [ORDER] },
      { rows: [] },              // ensureSecretGenerated: SELECT hash/last4 existant
      { rows: [] },              // generateAndStoreSecret: anti-collision SELECT
      { rows: [], rowCount: 1 }, // generateAndStoreSecret: UPDATE orders (secret)
      { rows: [], rowCount: 1 }, // UPDATE cash_paid_at
    ]);
    const db = makeDb(client);

    mockConfirmPaymentCycle.mockResolvedValue({ success: false, noop: true });

    const result = await confirmCashByReference({
      cashRefCode: 'CASH-001', actor: { id: 1, role: 'admin' }, triggerPurchasing, db,
    });

    expect(result.status).toBe(200);
  });

  test('erreur inattendue dans la transaction → ROLLBACK puis re-throw', async () => {
    const client = makeClient([{ rows: [ORDER] }]);
    const db = makeDb(client);

    mockConfirmPaymentCycle.mockRejectedValue(new Error('panne moteur paiement'));

    await expect(confirmCashByReference({
      cashRefCode: 'CASH-001', actor: { id: 1, role: 'admin' }, triggerPurchasing, db,
    })).rejects.toThrow('panne moteur paiement');

    const { expectTransactionRolledBack } = require('../integration/test-harness/mock-db');
    expectTransactionRolledBack(client);
  });

  describe('post-commit fire-and-forget — non bloquant', () => {
    test('loyaltyService.handleOrderConfirmed résout avec skipped=false → branche log info exécutée', async () => {
      const client = makeClient([
        { rows: [ORDER] },
        { rows: [] },              // ensureSecretGenerated: SELECT hash/last4 existant
        { rows: [] },              // generateAndStoreSecret: anti-collision SELECT
        { rows: [], rowCount: 1 }, // generateAndStoreSecret: UPDATE orders (secret)
        { rows: [], rowCount: 1 },
      ]);
      const db = makeDb(client);
      mockConfirmPaymentCycle.mockResolvedValue({ success: true, noop: false, stockBlocked: false });
      mockHandleOrderConfirmed.mockResolvedValueOnce({ skipped: false, bonus_kmf: 500 });

      const result = await confirmCashByReference({
        cashRefCode: 'CASH-001', actor: { id: 1, role: 'admin' }, triggerPurchasing, db,
      });

      expect(result.status).toBe(200);
      await new Promise((r) => setImmediate(r));
      expect(mockHandleOrderConfirmed).toHaveBeenCalledWith({ orderId: 'order-1' });
    });

    test('loyaltyService.handleOrderConfirmed rejette → catch silencieux, réponse 200 conservée', async () => {
      const client = makeClient([
        { rows: [ORDER] },
        { rows: [] },              // ensureSecretGenerated: SELECT hash/last4 existant
        { rows: [] },              // generateAndStoreSecret: anti-collision SELECT
        { rows: [], rowCount: 1 }, // generateAndStoreSecret: UPDATE orders (secret)
        { rows: [], rowCount: 1 },
      ]);
      const db = makeDb(client);
      mockConfirmPaymentCycle.mockResolvedValue({ success: true, noop: false, stockBlocked: false });
      mockHandleOrderConfirmed.mockRejectedValueOnce(new Error('loyalty down'));

      const result = await confirmCashByReference({
        cashRefCode: 'CASH-001', actor: { id: 1, role: 'admin' }, triggerPurchasing, db,
      });

      expect(result.status).toBe(200);
      await new Promise((r) => setImmediate(r));
    });

    test('notifyPaymentConfirmed et triggerPurchasing rejettent → catch silencieux, réponse 200 conservée', async () => {
      const client = makeClient([
        { rows: [ORDER] },
        { rows: [] },              // ensureSecretGenerated: SELECT hash/last4 existant
        { rows: [] },              // generateAndStoreSecret: anti-collision SELECT
        { rows: [], rowCount: 1 }, // generateAndStoreSecret: UPDATE orders (secret)
        { rows: [], rowCount: 1 },
      ]);
      const db = makeDb(client);
      mockConfirmPaymentCycle.mockResolvedValue({ success: true, noop: false, stockBlocked: false });
      mockNotifyPaymentConfirmed.mockRejectedValueOnce(new Error('whatsapp down'));
      triggerPurchasing.mockRejectedValueOnce(new Error('sourcing down'));

      const result = await confirmCashByReference({
        cashRefCode: 'CASH-001', actor: { id: 1, role: 'admin' }, triggerPurchasing, db,
      });

      expect(result.status).toBe(200);
      await new Promise((r) => setImmediate(r));
    });

    test('triggerPurchasing résout → branche log info OK exécutée', async () => {
      const client = makeClient([
        { rows: [ORDER] },
        { rows: [] },              // ensureSecretGenerated: SELECT hash/last4 existant
        { rows: [] },              // generateAndStoreSecret: anti-collision SELECT
        { rows: [], rowCount: 1 }, // generateAndStoreSecret: UPDATE orders (secret)
        { rows: [], rowCount: 1 },
      ]);
      const db = makeDb(client);
      mockConfirmPaymentCycle.mockResolvedValue({ success: true, noop: false, stockBlocked: false });

      const result = await confirmCashByReference({
        cashRefCode: 'CASH-001', actor: { id: 1, role: 'admin' }, triggerPurchasing, db,
      });

      expect(result.status).toBe(200);
      await new Promise((r) => setImmediate(r));
      expect(triggerPurchasing).toHaveBeenCalledWith('order-1');
    });

    test('triggerPurchasing throw de façon synchrone → catch [CASH-POSTCOMMIT] non-fatal', async () => {
      const client = makeClient([
        { rows: [ORDER] },
        { rows: [] },              // ensureSecretGenerated: SELECT hash/last4 existant
        { rows: [] },              // generateAndStoreSecret: anti-collision SELECT
        { rows: [], rowCount: 1 }, // generateAndStoreSecret: UPDATE orders (secret)
        { rows: [], rowCount: 1 },
      ]);
      const db = makeDb(client);
      mockConfirmPaymentCycle.mockResolvedValue({ success: true, noop: false, stockBlocked: false });
      const throwingTrigger = jest.fn(() => { throw new Error('sync failure'); });

      const result = await confirmCashByReference({
        cashRefCode: 'CASH-001', actor: { id: 1, role: 'admin' }, triggerPurchasing: throwingTrigger, db,
      });

      expect(result.status).toBe(200);
      await new Promise((r) => setImmediate(r));
    });
  });
});
