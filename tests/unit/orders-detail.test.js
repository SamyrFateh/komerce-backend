'use strict';

const request = require('supertest');
const express = require('express');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockDbQuery(...args),
}));

const mockState = { user: null };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockState.user) return res.status(401).json({ error: 'unauthenticated' });
    req.user = mockState.user;
    next();
  },
}));
jest.mock('../../middleware/soft-auth', () => ({
  softAuthenticate: (req, _res, next) => {
    if (mockState.user) req.user = mockState.user;
    next();
  },
}));

const router = require('../../routes/orders/detail');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

const BASE_ORDER = {
  id: 'order-uuid-1',
  reference: 'K12345',
  status: 'shipped',
  total_kmf: 10000,
  total_eur: 20,
  payment_mode: 'cash',
  payment_status: 'paid',
  cash_ref_code: 'SECRET-CASH',
  pickup_secret_last4: 'PICK',
  confection_type: null,
  module_type: null,
  module_size: null,
  module_retouche: null,
  purchasing_at: null,
  shipped_at: null,
  in_transit_at: null,
  destination_island: null,
  routing_mode: null,
  transit_hub: null,
  available_at: null,
  collected_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  supplier_name: 'ACME',
  supplier_invoice_url: 'https://supplier.example/inv.pdf',
  relais_name: null,
  relais_address: null,
  relais_phone: null,
  relais_hours: null,
  relais_zone: null,
};

describe('GET /api/orders/:ref', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.user = null;
  });

  it('retourne 404 si la commande est introuvable', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/orders/K99999');
    expect(res.status).toBe(404);
  });

  it('public (non authentifie) : ne recoit que reference/status/created_at/parcels, jamais cash_ref_code ou pickup_code', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [BASE_ORDER] }) // SELECT order
      .mockResolvedValueOnce({ rows: [] }) // SELECT items (non atteint en fait car retour anticipe pour public)
      .mockResolvedValueOnce({ rows: [] }) // history
      .mockResolvedValueOnce({ rows: [{ reference: 'PCL1', status: 'in_transit' }] }); // parcels

    const res = await request(buildApp()).get('/api/orders/K12345');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      reference: 'K12345',
      status: 'shipped',
      created_at: BASE_ORDER.created_at,
      parcels: [{ reference: 'PCL1', status: 'in_transit' }],
    });
    expect(res.body.cash_ref_code).toBeUndefined();
    expect(res.body.pickup_code).toBeUndefined();
    expect(res.body.supplier_name).toBeUndefined();
  });

  it("client authentifie (role 'client') : pas de cash_ref_code, pas de pickup_code, pas de champs fournisseur", async () => {
    mockState.user = { id: 'u1', role: 'client' };
    mockDbQuery
      .mockResolvedValueOnce({ rows: [BASE_ORDER] })
      .mockResolvedValueOnce({ rows: [] }) // items
      .mockResolvedValueOnce({ rows: [] }); // history

    const res = await request(buildApp()).get('/api/orders/K12345');

    expect(res.status).toBe(200);
    expect(res.body.cash_ref_code).toBeUndefined();
    expect(res.body.pickup_code).toBeUndefined();
    expect(res.body.supplier_name).toBeUndefined();
    expect(res.body.reference).toBe('K12345');
  });

  it("agent_hub : voit cash_ref_code (isAdmin) mais PAS pickup_code (reserve a admin/agent_relais)", async () => {
    mockState.user = { id: 'hub1', role: 'agent_hub' };
    mockDbQuery
      .mockResolvedValueOnce({ rows: [BASE_ORDER] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/orders/K12345');

    expect(res.body.cash_ref_code).toBe('SECRET-CASH');
    expect(res.body.pickup_code).toBeUndefined();
  });

  it('agent_relais : voit cash_ref_code et pickup_code mais pas les champs fournisseur (admin seulement)', async () => {
    mockState.user = { id: 'rel1', role: 'agent_relais' };
    mockDbQuery
      .mockResolvedValueOnce({ rows: [BASE_ORDER] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/orders/K12345');

    expect(res.body.cash_ref_code).toBe('SECRET-CASH');
    expect(res.body.pickup_code).toBe('•••-•PI-CK');
    expect(res.body.supplier_name).toBeUndefined();
  });

  it('admin : voit tout, y compris les champs fournisseur', async () => {
    mockState.user = { id: 'adm1', role: 'admin' };
    mockDbQuery
      .mockResolvedValueOnce({ rows: [BASE_ORDER] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/orders/K12345');

    expect(res.body.cash_ref_code).toBe('SECRET-CASH');
    expect(res.body.pickup_code).toBe('•••-•PI-CK');
    expect(res.body.supplier_name).toBe('ACME');
    expect(res.body.supplier_invoice_url).toBe('https://supplier.example/inv.pdf');
  });

  it('utilise la requete par id (UUID) quand le param ressemble a un UUID, par reference sinon', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [BASE_ORDER] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await request(buildApp()).get('/api/orders/3f1a9b2c-1234-4abc-89ab-1234567890ab');

    const firstCallSql = mockDbQuery.mock.calls[0][0];
    expect(firstCallSql).toContain('WHERE o.id = $1');
  });
});

describe('GET /api/orders/:id/history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.user = null;
  });

  it('401 si non authentifie (authenticate bloque)', async () => {
    const res = await request(buildApp()).get('/api/orders/order-1/history');
    expect(res.status).toBe(401);
  });

  it("403 si l'utilisateur non privilegie ne possede pas la commande", async () => {
    mockState.user = { id: 'u1', role: 'client' };
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // pas de commande pour cet user
    const res = await request(buildApp()).get('/api/orders/order-1/history');
    expect(res.status).toBe(403);
  });

  it('200 et historique si l\'utilisateur possede la commande', async () => {
    mockState.user = { id: 'u1', role: 'client' };
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'order-1' }] })
      .mockResolvedValueOnce({ rows: [{ status: 'shipped', note: null, created_at: 't1', changed_by_name: null }] });

    const res = await request(buildApp()).get('/api/orders/order-1/history');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('admin/agent_hub/agent_relais sautent la verification de propriete', async () => {
    mockState.user = { id: 'adm1', role: 'admin' };
    mockDbQuery.mockResolvedValueOnce({ rows: [{ status: 'shipped', note: null, created_at: 't1', changed_by_name: 'Hub' }] });

    const res = await request(buildApp()).get('/api/orders/order-1/history');
    expect(res.status).toBe(200);
    // une seule requete (l'historique), pas de check de propriete prealable
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });
});
