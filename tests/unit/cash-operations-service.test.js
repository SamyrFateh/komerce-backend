'use strict';

const { makeClient } = require('../integration/test-harness/mock-db');

jest.mock('../../services/order-payment-confirmation', () => ({
  confirmPaymentCycle: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  forModule: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../../db', () => ({ query: jest.fn().mockResolvedValue({ rows: [{ id: 'alert-1' }], rowCount: 1 }) }));

const db = require('../../db');
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
    db.query.mockClear();
    db.query.mockResolvedValue({ rows: [{ id: 'alert-1' }], rowCount: 1 });
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
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO alerts'),
        expect.arrayContaining(['cash_collect_cross_relais_blocked'])
      );
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

describe('cash-operations — Lot A, branches manquantes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    confirmPaymentCycle.mockReset();
    db.query.mockClear();
    db.query.mockResolvedValue({ rows: [{ id: 'alert-1' }], rowCount: 1 });
  });

  describe('collectCash — préconditions', () => {
    it('order_not_found si la commande n\'existe pas', async () => {
      const client = makeClient([{ rows: [] }]);
      const result = await collectCash({ orderId: 'ghost', agentUser: makeAgent(), dbClient: client });
      expect(result).toEqual({ order_not_found: true });
      expect(confirmPaymentCycle).not.toHaveBeenCalled();
    });

    it('invalid_status si le statut commande est dans la liste bloquante (ex: cancelled)', async () => {
      const client = makeClient([{ rows: [makeOrder({ status: 'cancelled' })] }]);
      const result = await collectCash({ orderId: 'order-001', agentUser: makeAgent(), dbClient: client });
      expect(result).toEqual({ invalid_status: true, status: 'cancelled' });
      expect(confirmPaymentCycle).not.toHaveBeenCalled();
    });

    it('invalid_status si le statut commande est "collected"', async () => {
      const client = makeClient([{ rows: [makeOrder({ status: 'collected' })] }]);
      const result = await collectCash({ orderId: 'order-001', agentUser: makeAgent(), dbClient: client });
      expect(result).toEqual({ invalid_status: true, status: 'collected' });
    });
  });

  describe('collectCash — cross-relais, cas d\'erreur', () => {
    it('agent_config_error si la requête users.relais_id échoue (checkPossible=false)', async () => {
      const client = makeClient([
        { rows: [makeOrder()] },
        { error: new Error('colonne relais_id inconnue') },
        { rows: [], rowCount: 1 }, // INSERT alerts (fire-and-forget)
      ]);
      const result = await collectCash({ orderId: 'order-001', agentUser: makeAgent(), dbClient: client });
      expect(result).toEqual({ agent_config_error: true });
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO alerts'),
        expect.arrayContaining(['cash_collect_agent_config_error'])
      );
      expect(confirmPaymentCycle).not.toHaveBeenCalled();
    });

    it('agent_config_error si l\'agent n\'a aucun relais_id assigné', async () => {
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [{ relais_id: null }] },
        { rows: [], rowCount: 1 },
      ]);
      const result = await collectCash({ orderId: 'order-001', agentUser: makeAgent(), dbClient: client });
      expect(result).toEqual({ agent_config_error: true });
    });

    it('insertion alerte hors-transaction échoue silencieusement (non-bloquant)', async () => {
      const client = makeClient([
        { rows: [makeOrder({ relais_id: 'relais-order' })] },
        { rows: [{ relais_id: 'relais-agent' }] },
        { error: new Error('alerts table down') },
      ]);
      const result = await collectCash({ orderId: 'order-001', agentUser: makeAgent(), dbClient: client });
      expect(result).toEqual({ cross_relais_blocked: true });
    });
  });

  describe('collectCash — rôle non agent_relais', () => {
    it('un admin peut collecter sans vérification cross-relais', async () => {
      const client = makeClient([
        { rows: [makeOrder({ relais_id: 'relais-999' })] },
        { rows: [] }, // SELECT cash_collections (doublon check)
        { rows: [{ id: 'collection-002', order_id: 'order-001', amount_kmf: 12000 }] },
      ]);
      confirmPaymentCycle.mockResolvedValue({ success: true, noop: false });

      const result = await collectCash({
        orderId: 'order-001',
        agentUser: makeAgent({ id: 'admin-001', role: 'admin' }),
        dbClient: client,
      });

      expect(result.success).toBe(true);
      expect(confirmPaymentCycle).toHaveBeenCalledWith(expect.objectContaining({
        actor: { id: 'admin-001', role: 'admin' },
      }));
    });
  });

  describe('collectCash — cycle noop', () => {
    it('noop:true est propagé dans la réponse de succès', async () => {
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [{ relais_id: 'relais-001' }] },
        { rows: [] },
        { rows: [{ id: 'collection-003', order_id: 'order-001', amount_kmf: 12000 }] },
      ]);
      confirmPaymentCycle.mockResolvedValue({ success: false, noop: true, stockBlocked: false });

      const result = await collectCash({ orderId: 'order-001', agentUser: makeAgent(), dbClient: client });

      expect(result.success).toBe(true);
      expect(result.noop).toBe(true);
    });
  });
});
