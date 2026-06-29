'use strict';

const { makeClient, expectTransactionCommitted, expectTransactionRolledBack } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({ connect: jest.fn(), query: jest.fn() }));

jest.mock('../../services/order-payment-confirmation', () => ({
  confirmPaymentCycle: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const db = require('../../db');
const { confirmPaymentCycle } = require('../../services/order-payment-confirmation');
const { confirmPickupCashPayment } = require('../../services/confirm-pickup-cash-payment');

function makeOrder(overrides = {}) {
  return {
    id: 'order-001',
    reference: 'CMD-001',
    total_kmf: '18000',
    payment_mode: 'cash_relais',
    payment_status: 'pending',
    status: 'confirmed',
    pickup_secret_hash: null,
    tracking_phone: null,
    tracking_phone_secondary: null,
    relais_id: 'relais-001',
    ...overrides,
  };
}

function makePayload(overrides = {}) {
  return {
    payer_name: 'Client Test',
    payer_id_type: 'cni',
    payer_id_number: 'ID-001',
    payer_note: 'RAS',
    tracking_phone_primary: '000000',
    tracking_phone_secondary: '',
    ...overrides,
  };
}

function makeUser(overrides = {}) {
  return { id: 'agent-001', role: 'agent_relais', ...overrides };
}

describe('confirm-pickup-cash-payment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    confirmPaymentCycle.mockReset();
    db.query.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  describe('confirmPickupCashPayment', () => {
    it('refuse un payload sans nom payeur avant toute transaction', async () => {
      const result = await confirmPickupCashPayment({
        orderId: 'order-001',
        user: makeUser(),
        payload: makePayload({ payer_name: '   ' }),
        generateAndStoreSecret: jest.fn(),
      });

      expect(result).toEqual({ status: 400, body: { error: 'Le nom du payeur est obligatoire' } });
      expect(db.connect).not.toHaveBeenCalled();
    });

    it('confirme le cash nominalement, genere le secret et commit la transaction', async () => {
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [{ relais_id: 'relais-001' }] },
        { rows: [], rowCount: 1 },
      ]);
      db.connect.mockResolvedValue(client);
      confirmPaymentCycle.mockResolvedValue({ success: true });
      const generateAndStoreSecret = jest.fn().mockResolvedValue({ code: '123456' });

      const result = await confirmPickupCashPayment({
        orderId: 'order-001',
        user: makeUser(),
        payload: makePayload(),
        generateAndStoreSecret,
      });

      expect(result.status).toBe(200);
      expect(result.body).toEqual(expect.objectContaining({
        success: true,
        code: '123456',
        order_ref: 'CMD-001',
        amount_kmf: 18000,
        payer_name: 'Client Test',
      }));
      expect(confirmPaymentCycle).toHaveBeenCalledWith({
        orderId: 'order-001',
        actor: { id: 'agent-001', role: 'agent_relais' },
        source: 'cash_confirm',
        dbClient: client,
        note: 'Paiement espèces confirmé via pickup secret',
      });
      expect(generateAndStoreSecret).toHaveBeenCalledWith(expect.objectContaining({
        orderId: 'order-001',
        relaisId: 'relais-001',
        channel: 'cash_relais',
        dbClient: client,
      }));
      const cashInsert = client.calls.find(c => String(c.sql).includes('INSERT INTO cash_collections'));
      expect(cashInsert).toBeTruthy();
      expect(cashInsert.params).toEqual(['order-001', 18000, 'agent-001', 'relais-001']);
      expectTransactionCommitted(client);
    });

    it('refuse une commande introuvable et rollback', async () => {
      const client = makeClient([{ rows: [] }]);
      db.connect.mockResolvedValue(client);

      const result = await confirmPickupCashPayment({
        orderId: 'missing-order',
        user: makeUser(),
        payload: makePayload(),
        generateAndStoreSecret: jest.fn(),
      });

      expect(result).toEqual({ status: 404, body: { error: 'Commande introuvable' } });
      expectTransactionRolledBack(client);
    });

    it('refuse une commande qui n est pas en paiement cash relais', async () => {
      const client = makeClient([{ rows: [makeOrder({ payment_mode: 'stripe_eur' })] }]);
      db.connect.mockResolvedValue(client);

      const result = await confirmPickupCashPayment({
        orderId: 'order-001',
        user: makeUser(),
        payload: makePayload(),
        generateAndStoreSecret: jest.fn(),
      });

      expect(result).toEqual({ status: 400, body: { error: "Cette commande n'est pas en paiement cash relais" } });
      expectTransactionRolledBack(client);
      expect(confirmPaymentCycle).not.toHaveBeenCalled();
    });

    it('refuse une double confirmation si un secret existe deja', async () => {
      const client = makeClient([{ rows: [makeOrder({ pickup_secret_hash: 'hash-existing' })] }]);
      db.connect.mockResolvedValue(client);

      const result = await confirmPickupCashPayment({
        orderId: 'order-001',
        user: makeUser(),
        payload: makePayload(),
        generateAndStoreSecret: jest.fn(),
      });

      expect(result.status).toBe(409);
      expect(result.body.error).toContain('Un code secret existe déjà');
      expectTransactionRolledBack(client);
      expect(confirmPaymentCycle).not.toHaveBeenCalled();
    });

    it('refuse le cross-relais et insere une alerte hors transaction', async () => {
      const client = makeClient([
        { rows: [makeOrder({ relais_id: 'relais-order' })] },
        { rows: [{ relais_id: 'relais-agent' }] },
      ]);
      db.connect.mockResolvedValue(client);

      const result = await confirmPickupCashPayment({
        orderId: 'order-001',
        user: makeUser(),
        payload: makePayload(),
        generateAndStoreSecret: jest.fn(),
      });

      expect(result).toEqual({
        status: 403,
        body: { error: 'Cette commande appartient à un autre relais — vous ne pouvez pas la valider' },
      });
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO alerts'), expect.any(Array));
      expectTransactionRolledBack(client);
    });

    it('rollback si le cycle paiement detecte un stock insuffisant', async () => {
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [{ relais_id: 'relais-001' }] },
      ]);
      db.connect.mockResolvedValue(client);
      confirmPaymentCycle.mockResolvedValue({ stockBlocked: true, insufficientItems: [{ product_name: 'Riz', available: 0 }] });

      const result = await confirmPickupCashPayment({
        orderId: 'order-001',
        user: makeUser(),
        payload: makePayload(),
        generateAndStoreSecret: jest.fn(),
      });

      expect(result.status).toBe(409);
      expect(result.body.error).toContain('Stock insuffisant pour "Riz"');
      expectTransactionRolledBack(client);
    });
  });
});
