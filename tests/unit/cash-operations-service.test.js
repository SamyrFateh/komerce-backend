'use strict';

const { makeClient } = require('../integration/test-harness/mock-db');

jest.mock('../../services/order-payment-confirmation', () => ({
  confirmPaymentCycle: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const { confirmPaymentCycle } = require('../../services/order-payment-confirmation');
const { collectCash } = require('../../services/cash-operations');

function makeOrder(overrides = {}) {
  return {
    id: 'order-001',
    total_kmf: '12000',
    payment_mode: 'cash_relais',
    payment_status: 'pending',
    status: 'confirmed',
    relais_id: 'relais-001',
    ...overrides,
  };
}

function makeAgent(overrides = {}) {
  return { id: 'agent-001', role: 'agent_relais', relais_id: 'relais-001', ...overrides };
}

describe('cash-operations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    confirmPaymentCycle.mockReset();
  });

  describe('collectCash', () => {
    it('collecte le cash nominalement puis appelle le cycle paiement → stock', async () => {
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [{ relais_id: 'relais-001' }] },
        { rows: [] },
        { rows: [{ id: 'collection-001', order_id: 'order-001', amount_kmf: 12000 }] },
      ]);
      confirmPaymentCycle.mockResolvedValue({ success: true, noop: false });

      const result = await collectCash({ orderId: 'order-001', agentUser: makeAgent(), dbClient: client });

      expect(result).toEqual({
        success: true,
        collection: { id: 'collection-001', order_id: 'order-001', amount_kmf: 12000 },
        noop: false,
        amount_kmf: 12000,
      });
      expect(confirmPaymentCycle).toHaveBeenCalledWith({
        orderId: 'order-001',
        actor: { id: 'agent-001', role: 'agent_relais' },
        source: 'cash_confirm',
        dbClient: client,
      });
      expect(client.calls[3].sql).toContain('INSERT INTO cash_collections');
      expect(client.calls[3].params).toEqual(['order-001', 12000, 'agent-001', 'relais-001']);
    });

    it('refuse une commande deja payee', async () => {
      const client = makeClient([{ rows: [makeOrder({ payment_status: 'paid' })] }]);

      const result = await collectCash({ orderId: 'order-001', agentUser: makeAgent(), dbClient: client });

      expect(result).toEqual({ invalid_payment_status: true, payment_status: 'paid' });
      expect(confirmPaymentCycle).not.toHaveBeenCalled();
    });

    it('refuse une commande qui n est pas en cash relais', async () => {
      const client = makeClient([{ rows: [makeOrder({ payment_mode: 'stripe_eur' })] }]);

      const result = await collectCash({ orderId: 'order-001', agentUser: makeAgent(), dbClient: client });

      expect(result).toEqual({ invalid_payment_mode: true });
      expect(confirmPaymentCycle).not.toHaveBeenCalled();
    });

    it('refuse une double collecte deja presente', async () => {
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [{ relais_id: 'relais-001' }] },
        { rows: [{ id: 'collection-existing' }] },
      ]);

      const result = await collectCash({ orderId: 'order-001', agentUser: makeAgent(), dbClient: client });

      expect(result).toEqual({ already_collected: true, collection_id: 'collection-existing' });
      expect(confirmPaymentCycle).not.toHaveBeenCalled();
    });

    it('bloque le cross-relais et journalise une alerte non bloquante', async () => {
      const client = makeClient([
        { rows: [makeOrder({ relais_id: 'relais-order' })] },
        { rows: [{ relais_id: 'relais-agent' }] },
        { rows: [], rowCount: 1 },
      ]);

      const result = await collectCash({ orderId: 'order-001', agentUser: makeAgent(), dbClient: client });

      expect(result).toEqual({ cross_relais_blocked: true });
      expect(client.calls[2].sql).toContain('INSERT INTO alerts');
      expect(confirmPaymentCycle).not.toHaveBeenCalled();
    });

    it('remonte stock_blocked si le cycle paiement refuse le blocage stock', async () => {
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [{ relais_id: 'relais-001' }] },
        { rows: [] },
        { rows: [{ id: 'collection-001', order_id: 'order-001' }] },
      ]);
      confirmPaymentCycle.mockResolvedValue({ stockBlocked: true, insufficientItems: [{ product_id: 'p1', available: 0 }] });

      const result = await collectCash({ orderId: 'order-001', agentUser: makeAgent(), dbClient: client });

      expect(result).toEqual({ stock_blocked: true, insufficient_items: [{ product_id: 'p1', available: 0 }] });
    });
  });
});
