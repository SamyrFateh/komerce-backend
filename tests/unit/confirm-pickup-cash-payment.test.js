'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
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
      confirmPaymentCycle.mockResolvedValue({ success: true, stockBlocked: true, insufficientItems: [{ product_name: 'Riz', available: 0 }] });

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

describe('confirm-pickup-cash-payment — Lot A, branches manquantes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    confirmPaymentCycle.mockReset();
    db.query.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  describe('validations en entrée (avant toute connexion db)', () => {
    it('orderId manquant → throw synchrone', async () => {
      await expect(confirmPickupCashPayment({
        orderId: null,
        user: makeUser(),
        payload: makePayload(),
        generateAndStoreSecret: jest.fn(),
      })).rejects.toThrow('[confirmPickupCashPayment] orderId requis');
      expect(db.connect).not.toHaveBeenCalled();
    });

    it('user sans id/role → throw synchrone', async () => {
      await expect(confirmPickupCashPayment({
        orderId: 'order-001',
        user: {},
        payload: makePayload(),
        generateAndStoreSecret: jest.fn(),
      })).rejects.toThrow('[confirmPickupCashPayment] user requis');
      expect(db.connect).not.toHaveBeenCalled();
    });

    it('generateAndStoreSecret non-fonction → throw synchrone', async () => {
      await expect(confirmPickupCashPayment({
        orderId: 'order-001',
        user: makeUser(),
        payload: makePayload(),
        generateAndStoreSecret: null,
      })).rejects.toThrow('[confirmPickupCashPayment] generateAndStoreSecret requis');
      expect(db.connect).not.toHaveBeenCalled();
    });

    it('téléphone principal au format invalide → 400 avant transaction', async () => {
      const result = await confirmPickupCashPayment({
        orderId: 'order-001',
        user: makeUser(),
        payload: makePayload({ tracking_phone_primary: 'abc-invalid' }),
        generateAndStoreSecret: jest.fn(),
      });

      expect(result).toEqual({ status: 400, body: { error: 'Numéro principal invalide' } });
      expect(db.connect).not.toHaveBeenCalled();
    });

    it('téléphone secondaire au format invalide → 400 avant transaction', async () => {
      const result = await confirmPickupCashPayment({
        orderId: 'order-001',
        user: makeUser(),
        payload: makePayload({ tracking_phone_secondary: 'abc-invalid' }),
        generateAndStoreSecret: jest.fn(),
      });

      expect(result).toEqual({ status: 400, body: { error: 'Numéro secondaire invalide' } });
      expect(db.connect).not.toHaveBeenCalled();
    });
  });

  describe('garde payment_status déjà payé', () => {
    it('payment_status=paid sans secret → 409 escalade admin', async () => {
      const client = makeClient([{ rows: [makeOrder({ payment_status: 'paid' })] }]);
      db.connect.mockResolvedValue(client);

      const result = await confirmPickupCashPayment({
        orderId: 'order-001',
        user: makeUser(),
        payload: makePayload(),
        generateAndStoreSecret: jest.fn(),
      });

      expect(result.status).toBe(409);
      expect(result.body.error).toContain('déjà marquée payée');
      expectTransactionRolledBack(client);
      expect(confirmPaymentCycle).not.toHaveBeenCalled();
    });
  });

  describe('cross-relais agent_relais — cas d\'erreur', () => {
    it('requête users.relais_id échoue → checkPossible=false → 403 + alerte', async () => {
      const client = makeClient([
        { rows: [makeOrder()] },
        { error: new Error('colonne relais_id inconnue') },
      ]);
      db.connect.mockResolvedValue(client);

      const result = await confirmPickupCashPayment({
        orderId: 'order-001',
        user: makeUser(),
        payload: makePayload(),
        generateAndStoreSecret: jest.fn(),
      });

      expect(result.status).toBe(403);
      expect(result.body.error).toContain('Configuration agent incomplète');
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO alerts'), expect.any(Array));
      expectTransactionRolledBack(client);
      expect(confirmPaymentCycle).not.toHaveBeenCalled();
    });

    it('agent sans relais_id assigné → 403 + alerte', async () => {
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [{ relais_id: null }] },
      ]);
      db.connect.mockResolvedValue(client);

      const result = await confirmPickupCashPayment({
        orderId: 'order-001',
        user: makeUser(),
        payload: makePayload(),
        generateAndStoreSecret: jest.fn(),
      });

      expect(result.status).toBe(403);
      expect(result.body.error).toContain('Configuration agent incomplète');
      expectTransactionRolledBack(client);
    });

    it('insertion alerte hors-transaction échoue silencieusement (non-bloquant)', async () => {
      const client = makeClient([
        { rows: [makeOrder({ relais_id: 'relais-order' })] },
        { rows: [{ relais_id: 'relais-agent' }] },
      ]);
      db.connect.mockResolvedValue(client);
      db.query.mockRejectedValueOnce(new Error('alerts table down'));

      const result = await confirmPickupCashPayment({
        orderId: 'order-001',
        user: makeUser(),
        payload: makePayload(),
        generateAndStoreSecret: jest.fn(),
      });

      expect(result.status).toBe(403);
      expectTransactionRolledBack(client);
    });
  });

  describe('rôle non agent_relais — bypass du contrôle cross-relais', () => {
    it('un admin peut confirmer sans vérification relais_id', async () => {
      const client = makeClient([
        { rows: [makeOrder({ relais_id: 'relais-999' })] },
        { rows: [], rowCount: 1 }, // INSERT cash_collections
      ]);
      db.connect.mockResolvedValue(client);
      confirmPaymentCycle.mockResolvedValue({ success: true });
      const generateAndStoreSecret = jest.fn().mockResolvedValue({ code: '999999' });

      const result = await confirmPickupCashPayment({
        orderId: 'order-001',
        user: makeUser({ id: 'admin-001', role: 'admin' }),
        payload: makePayload(),
        generateAndStoreSecret,
      });

      expect(result.status).toBe(200);
      expectTransactionCommitted(client);
    });
  });

  describe('confirmPaymentCycle — cas d\'échec et noop', () => {
    it('cycle échoue sans noop → 409 avec le message du cycle', async () => {
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [{ relais_id: 'relais-001' }] },
      ]);
      db.connect.mockResolvedValue(client);
      confirmPaymentCycle.mockResolvedValue({ success: false, noop: false, error: 'transition_refusee' });

      const result = await confirmPickupCashPayment({
        orderId: 'order-001',
        user: makeUser(),
        payload: makePayload(),
        generateAndStoreSecret: jest.fn(),
      });

      expect(result).toEqual({ status: 409, body: { error: 'transition_refusee' } });
      expectTransactionRolledBack(client);
    });

    it('cycle en noop (déjà traité ailleurs) → poursuit malgré success=false', async () => {
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [{ relais_id: 'relais-001' }] },
        { rows: [], rowCount: 1 },
      ]);
      db.connect.mockResolvedValue(client);
      confirmPaymentCycle.mockResolvedValue({ success: false, noop: true });
      const generateAndStoreSecret = jest.fn().mockResolvedValue({ code: '111111' });

      const result = await confirmPickupCashPayment({
        orderId: 'order-001',
        user: makeUser(),
        payload: makePayload(),
        generateAndStoreSecret,
      });

      expect(result.status).toBe(200);
      expectTransactionCommitted(client);
    });
  });

  describe('numéros de téléphone — fallback et normalisation', () => {
    it('sans tracking_phone_primary fourni → fallback sur order.tracking_phone existant', async () => {
      const client = makeClient([
        { rows: [makeOrder({ relais_id: 'relais-001', tracking_phone: '+269 333 4455' })] },
        { rows: [{ relais_id: 'relais-001' }] },
        { rows: [], rowCount: 1 },
      ]);
      db.connect.mockResolvedValue(client);
      confirmPaymentCycle.mockResolvedValue({ success: true });
      const generateAndStoreSecret = jest.fn().mockResolvedValue({ code: '222222' });

      const result = await confirmPickupCashPayment({
        orderId: 'order-001',
        user: makeUser(),
        payload: makePayload({ tracking_phone_primary: '' }),
        generateAndStoreSecret,
      });

      expect(result.status).toBe(200);
      expect(generateAndStoreSecret).toHaveBeenCalledWith(expect.objectContaining({
        extraUpdates: expect.objectContaining({ tracking_phone: '+269 333 4455' }),
      }));
    });

    it('tracking_phone_secondary fourni et trimé → utilisé tel quel', async () => {
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [{ relais_id: 'relais-001' }] },
        { rows: [], rowCount: 1 },
      ]);
      db.connect.mockResolvedValue(client);
      confirmPaymentCycle.mockResolvedValue({ success: true });
      const generateAndStoreSecret = jest.fn().mockResolvedValue({ code: '333333' });

      const result = await confirmPickupCashPayment({
        orderId: 'order-001',
        user: makeUser(),
        payload: makePayload({ tracking_phone_secondary: '+269 111 2233 ' }),
        generateAndStoreSecret,
      });

      expect(result.status).toBe(200);
      expect(generateAndStoreSecret).toHaveBeenCalledWith(expect.objectContaining({
        extraUpdates: expect.objectContaining({ tracking_phone_secondary: '+269 111 2233' }),
      }));
    });
  });

  describe('erreur inattendue dans la transaction', () => {
    it('erreur imprévue → catch générique, rollback tenté (même si celui-ci échoue), puis re-throw', async () => {
      const client = makeClient([
        { rows: [makeOrder()] },
        { rows: [{ relais_id: 'relais-001' }] },
      ]);
      db.connect.mockResolvedValue(client);
      confirmPaymentCycle.mockRejectedValue(new Error('panne inattendue moteur paiement'));

      const originalQuery = client.query.getMockImplementation();
      client.query.mockImplementation(async (sql, params) => {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        if (normalized === 'ROLLBACK') {
          throw new Error('rollback failed too');
        }
        return originalQuery(sql, params);
      });

      await expect(confirmPickupCashPayment({
        orderId: 'order-001',
        user: makeUser(),
        payload: makePayload(),
        generateAndStoreSecret: jest.fn(),
      })).rejects.toThrow('panne inattendue moteur paiement');
      expect(client.release).toHaveBeenCalled();
    });
  });
});
