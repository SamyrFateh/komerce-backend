'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const request = require('supertest');
const express = require('express');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
}));

const mockState = { user: { id: 'adm1', role: 'admin' } };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = mockState.user;
    next();
  },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

const mockConfirmCashAndCreateParcel = jest.fn();
const mockCreateParcelManually = jest.fn();
jest.mock('../../services/parcel-auto-create-service', () => ({
  confirmCashAndCreateParcel: (...args) => mockConfirmCashAndCreateParcel(...args),
  createParcelManually: (...args) => mockCreateParcelManually(...args),
}));

const mockNotifyPaymentConfirmed = jest.fn().mockResolvedValue({});
const mockNotifyParcelCreated = jest.fn().mockResolvedValue({});
jest.mock('../../services/notification-service', () => ({
  notifyPaymentConfirmed: (...args) => mockNotifyPaymentConfirmed(...args),
  notifyParcelCreated: (...args) => mockNotifyParcelCreated(...args),
}));

// O7.2 (Cycle A) : voir docs/O7_2_CYCLE_ANALYSIS.md.
const mockSendInvoiceReadyNotification = jest.fn().mockResolvedValue({ ok: true });
jest.mock('../../services/invoice-service', () => ({
  sendInvoiceReadyNotification: (...args) => mockSendInvoiceReadyNotification(...args),
}));

jest.mock('../../utils/logger', () => ({ child: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })) }));

const router = require('../../routes/order-api-v2');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v2/orders', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('order-api-v2 — guard de role', () => {
  beforeEach(() => jest.clearAllMocks());

  it('403 pour un client sur GET /', async () => {
    mockState.user = { id: 'u1', role: 'client' };
    const res = await request(buildApp()).get('/api/v2/orders');
    expect(res.status).toBe(403);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('200 pour agent_hub sur GET /pending-cash', async () => {
    mockState.user = { id: 'hub1', role: 'agent_hub' };
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/v2/orders/pending-cash');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/v2/orders (KPIs + liste)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.user = { id: 'adm1', role: 'admin' };
  });

  it('construit les filtres SQL parametres a partir de la query string', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ total: 5 }] }) // KPIs
      .mockResolvedValueOnce({ rows: [] }); // liste

    await request(buildApp()).get('/api/v2/orders?status=shipped&payment_mode=cash_relais');

    const [listSql, listParams] = mockDbQuery.mock.calls[1];
    expect(listSql).toContain('o.status = $1');
    expect(listSql).toContain('o.payment_mode = $2');
    expect(listParams).toEqual(expect.arrayContaining(['shipped', 'cash_relais']));
  });

  it('retourne kpis + count + orders', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ total: 3, pending: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'o1' }, { id: 'o2' }] });

    const res = await request(buildApp()).get('/api/v2/orders');
    expect(res.status).toBe(200);
    expect(res.body.kpis).toEqual({ total: 3, pending: 1 });
    expect(res.body.count).toBe(2);
  });
});

describe('GET /api/v2/orders/:ref', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.user = { id: 'adm1', role: 'admin' };
  });

  it('404 si la commande est introuvable', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/v2/orders/K99999');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('K99999');
  });

  it('200 avec items attaches a la commande', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'K12345' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'item1' }] });

    const res = await request(buildApp()).get('/api/v2/orders/K12345');
    expect(res.status).toBe(200);
    expect(res.body.order.items).toEqual([{ id: 'item1' }]);
  });
});

describe('POST /api/v2/orders/:ref/confirm-cash', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.user = { id: 'adm1', role: 'admin', full_name: 'Admin Test' };
  });

  it("confirme le paiement et signale le colis cree quand l'auto-parcel reussit", async () => {
    mockConfirmCashAndCreateParcel.mockResolvedValue({
      order: { id: 'o1', reference: 'K12345', status: 'confirmed', total_kmf: 5000, customer_name: 'X', customer_phone: 'Y' },
      parcelResult: { success: true, parcel: { reference: 'PCL1' } },
    });

    const res = await request(buildApp()).post('/api/v2/orders/K12345/confirm-cash');
    expect(res.status).toBe(200);
    expect(res.body.order.new_status).toBe('preparation');
    expect(res.body.parcel).toEqual({ reference: 'PCL1' });
  });

  it("confirme le paiement sans colis si l'auto-parcel echoue silencieusement", async () => {
    mockConfirmCashAndCreateParcel.mockResolvedValue({
      order: { id: 'o1', reference: 'K12345', status: 'confirmed', total_kmf: 5000, customer_name: 'X', customer_phone: 'Y' },
      parcelResult: { success: false },
    });

    const res = await request(buildApp()).post('/api/v2/orders/K12345/confirm-cash');
    expect(res.status).toBe(200);
    expect(res.body.order.new_status).toBe('confirmed');
    expect(res.body.parcel).toBeNull();
  });

  it('propage un code de statut HTTP personnalise (err.status) du service', async () => {
    const err = new Error('Commande deja confirmee');
    err.status = 409;
    mockConfirmCashAndCreateParcel.mockRejectedValue(err);

    const res = await request(buildApp()).post('/api/v2/orders/K12345/confirm-cash');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Commande deja confirmee');
  });
});

describe('POST /api/v2/orders/:ref/create-parcel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.user = { id: 'adm1', role: 'admin', full_name: 'Admin Test' };
  });

  it('cree le colis manuellement et renvoie sa reference', async () => {
    mockCreateParcelManually.mockResolvedValue({
      order: { id: 'o1', reference: 'K12345' },
      parcel: { reference: 'PCL2' },
    });

    const res = await request(buildApp()).post('/api/v2/orders/K12345/create-parcel');
    expect(res.status).toBe(200);
    expect(res.body.parcel).toEqual({ reference: 'PCL2' });
  });

  it('propage err.status et err.rule en cas de violation de regle metier', async () => {
    const err = new Error('Regle violee');
    err.status = 422;
    err.rule = 'no_duplicate_parcel';
    mockCreateParcelManually.mockRejectedValue(err);

    const res = await request(buildApp()).post('/api/v2/orders/K12345/create-parcel');
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: 'Regle violee', rule: 'no_duplicate_parcel' });
  });
});

describe('order-api-v2 — Lot A, branches manquantes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.user = { id: 'adm1', role: 'admin', full_name: 'Admin Test' };
  });

  describe('GET / — filtres supplémentaires et erreur', () => {
    it('applique le filtre payment_status et le filtre search (ILIKE)', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ total: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      await request(buildApp()).get('/api/v2/orders?payment_status=paid&search=K123');

      const [listSql, listParams] = mockDbQuery.mock.calls[1];
      expect(listSql).toContain('o.payment_status = $1');
      expect(listSql).toContain('ILIKE');
      expect(listParams).toEqual(expect.arrayContaining(['paid', '%K123%']));
    });

    it('erreur db → next(err) → 500', async () => {
      mockDbQuery.mockRejectedValueOnce(new Error('db down'));
      const res = await request(buildApp()).get('/api/v2/orders');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('db down');
    });
  });

  describe('GET /pending-cash — erreur', () => {
    it('erreur db → next(err) → 500', async () => {
      mockDbQuery.mockRejectedValueOnce(new Error('pending-cash down'));
      const res = await request(buildApp()).get('/api/v2/orders/pending-cash');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /ready-for-parcel', () => {
    it('200 avec la liste des commandes confirmées sans colis', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'K1' }] });
      const res = await request(buildApp()).get('/api/v2/orders/ready-for-parcel');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.orders).toEqual([{ id: 'o1', reference: 'K1' }]);
    });

    it('erreur db → next(err) → 500', async () => {
      mockDbQuery.mockRejectedValueOnce(new Error('ready-for-parcel down'));
      const res = await request(buildApp()).get('/api/v2/orders/ready-for-parcel');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /:ref — erreur', () => {
    it('erreur db sur la requête order → next(err) → 500', async () => {
      mockDbQuery.mockRejectedValueOnce(new Error('detail down'));
      const res = await request(buildApp()).get('/api/v2/orders/K12345');
      expect(res.status).toBe(500);
    });

    it('erreur db sur la requête items → next(err) → 500', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'K12345' }] })
        .mockRejectedValueOnce(new Error('items down'));
      const res = await request(buildApp()).get('/api/v2/orders/K12345');
      expect(res.status).toBe(500);
    });
  });

  describe('POST /:ref/confirm-cash — cas additionnels', () => {
    it('erreur sans err.status → next(err) → 500', async () => {
      mockConfirmCashAndCreateParcel.mockRejectedValue(new Error('panne interne'));
      const res = await request(buildApp()).post('/api/v2/orders/K12345/confirm-cash');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('panne interne');
    });

    it('req.user sans full_name/email → valeurs par défaut appliquées à actor', async () => {
      mockState.user = { id: 'adm1', role: 'admin' }; // pas de full_name ni email
      mockConfirmCashAndCreateParcel.mockResolvedValue({
        order: { id: 'o1', reference: 'K1', status: 'confirmed', total_kmf: 1000, customer_name: 'X', customer_phone: 'Y' },
        parcelResult: { success: false },
      });

      const res = await request(buildApp()).post('/api/v2/orders/K1/confirm-cash');
      expect(res.status).toBe(200);
      expect(mockConfirmCashAndCreateParcel).toHaveBeenCalledWith('K1', expect.objectContaining({
        id: 'adm1', role: 'admin', full_name: 'Admin CT', email: undefined,
      }));
    });

    it("notifyPaymentConfirmed avec facture → log info sans faire echouer la reponse", async () => {
      mockConfirmCashAndCreateParcel.mockResolvedValue({
        order: { id: 'o1', reference: 'K1', status: 'confirmed', total_kmf: 1000, customer_name: 'X', customer_phone: 'Y' },
        parcelResult: { success: false },
      });
      mockNotifyPaymentConfirmed.mockResolvedValueOnce({ invoice: 'INV-1' });

      const res = await request(buildApp()).post('/api/v2/orders/K1/confirm-cash');
      expect(res.status).toBe(200);
      await new Promise((r) => setImmediate(r));
      expect(mockNotifyPaymentConfirmed).toHaveBeenCalledWith('o1', 'K1');
    });

    it('notifyPaymentConfirmed rejette → catch silencieux, reponse deja envoyee reste 200', async () => {
      mockConfirmCashAndCreateParcel.mockResolvedValue({
        order: { id: 'o1', reference: 'K1', status: 'confirmed', total_kmf: 1000, customer_name: 'X', customer_phone: 'Y' },
        parcelResult: { success: false },
      });
      mockNotifyPaymentConfirmed.mockRejectedValueOnce(new Error('whatsapp down'));

      const res = await request(buildApp()).post('/api/v2/orders/K1/confirm-cash');
      expect(res.status).toBe(200);
      await new Promise((r) => setImmediate(r));
    });

    it('notifyParcelCreated rejette quand auto-parcel reussit → catch silencieux', async () => {
      mockConfirmCashAndCreateParcel.mockResolvedValue({
        order: { id: 'o1', reference: 'K1', status: 'confirmed', total_kmf: 1000, customer_name: 'X', customer_phone: 'Y' },
        parcelResult: { success: true, parcel: { reference: 'PCL9' } },
      });
      mockNotifyParcelCreated.mockRejectedValueOnce(new Error('parcel notif down'));

      const res = await request(buildApp()).post('/api/v2/orders/K1/confirm-cash');
      expect(res.status).toBe(200);
      expect(res.body.parcel).toEqual({ reference: 'PCL9' });
      await new Promise((r) => setImmediate(r));
    });
  });

  describe('POST /:ref/create-parcel — cas additionnels', () => {
    it('erreur sans err.status → next(err) → 500', async () => {
      mockCreateParcelManually.mockRejectedValue(new Error('panne creation'));
      const res = await request(buildApp()).post('/api/v2/orders/K12345/create-parcel');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('panne creation');
    });

    it('req.user sans full_name → valeur par défaut "Admin CT"', async () => {
      mockState.user = { id: 'adm1', role: 'admin' };
      mockCreateParcelManually.mockResolvedValue({
        order: { id: 'o1', reference: 'K1' },
        parcel: { reference: 'PCL3' },
      });

      const res = await request(buildApp()).post('/api/v2/orders/K1/create-parcel');
      expect(res.status).toBe(200);
      expect(mockCreateParcelManually).toHaveBeenCalledWith('K1', expect.objectContaining({
        id: 'adm1', role: 'admin', name: 'Admin CT',
      }));
    });

    it('notifyParcelCreated rejette → catch silencieux, reponse 200 conservee', async () => {
      mockCreateParcelManually.mockResolvedValue({
        order: { id: 'o1', reference: 'K1' },
        parcel: { reference: 'PCL4' },
      });
      mockNotifyParcelCreated.mockRejectedValueOnce(new Error('down'));

      const res = await request(buildApp()).post('/api/v2/orders/K1/create-parcel');
      expect(res.status).toBe(200);
      await new Promise((r) => setImmediate(r));
    });
  });
});
