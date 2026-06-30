'use strict';

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
