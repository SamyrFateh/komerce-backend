'use strict';

/**
 * tests/unit/orders-status-route.test.js
 *
 * Tests du router routes/orders/status.js.
 *
 * Couverture :
 *   PATCH /:id/status :
 *     ✓ garde de rôle (admin/agent_hub/agent_relais)
 *     ✓ 404 si commande introuvable
 *     ✓ IDOR cross-relais : agent_relais bloqué hors de son relais (403)
 *     ✓ délégation à transitionOrderStatus, échec → 422 (ou 403 si erreur "Rôle")
 *     ✓ succès → commit + réponse { success, status }
 *     ✓ effets post-commit non bloquants : pickup-proof si collected,
 *       recalculateLoyalty si collected, notifyStatusChange toujours
 *     ✓ erreur DB → rollback + next(err)
 *
 *   PATCH /:id/cost :
 *     ✓ garde de rôle admin uniquement
 *     ✓ 400 si cost_real_kmf manquant
 *     ✓ 404 si commande introuvable
 *     ✓ UPDATE dynamique selon supplier_name/supplier_invoice_url fournis
 *     ✓ INSERT customs_history seulement si customs_real_kmf ET sh_category
 *     ✓ erreur DB → next(err)
 */

const { makeClient, expectTransactionRolledBack, expectTransactionCommitted } = require('../integration/test-harness/mock-db');

jest.mock('../../db', () => ({ getClient: jest.fn(), query: jest.fn() }));

const mockState = { user: { id: 'admin-1', role: 'admin' } };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = mockState.user; next(); },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

jest.mock('../../middleware/validate', () => ({
  validate: () => (req, _res, next) => next(),
}));

jest.mock('../../services/loyalty-service', () => ({
  recalculateLoyalty: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/notification-service', () => ({
  notifyStatusChange: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: jest.fn(),
}));

jest.mock('../../services/documents/pickup-proof', () => ({
  issue: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const db = require('../../db');
const { recalculateLoyalty } = require('../../services/loyalty-service');
const { notifyStatusChange } = require('../../services/notification-service');
const { transitionOrderStatus } = require('../../services/order-status-machine');
const pickupProofService = require('../../services/documents/pickup-proof');

const express = require('express');
const request = require('supertest');

let app;

function orderRow(overrides = {}) {
  return {
    id: 'order-1', reference: 'CMD-001', status: 'preparation', user_id: 'user-1',
    relais_id: 'relais-1', cost_estimated_kmf: 5000,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState.user = { id: 'admin-1', role: 'admin' };
  transitionOrderStatus.mockResolvedValue({ success: true });
  db.query.mockResolvedValue({ rows: [] });

  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/orders/status');
    app.use('/api/orders', router);
  });
  app.use((err, req, res, _next) => {
    res.status(500).json({ error: err.message });
  });
});

describe('orders/status — PATCH /:id/status — garde de rôle', () => {
  it('403 si rôle non autorisé', async () => {
    mockState.user = { id: 'u2', role: 'client' };
    const res = await request(app).patch('/api/orders/o1/status').send({ status: 'shipped' });
    expect(res.status).toBe(403);
    expect(db.getClient).not.toHaveBeenCalled();
  });
});

describe('orders/status — PATCH /:id/status', () => {
  it('404 si commande introuvable', async () => {
    const client = makeClient([{ rows: [] }]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).patch('/api/orders/o1/status').send({ status: 'shipped' });

    expect(res.status).toBe(404);
  });

  it('403 IDOR : agent_relais hors de son relais', async () => {
    mockState.user = { id: 'agent-1', role: 'agent_relais', relais_id: 'relais-X' };
    const client = makeClient([{ rows: [orderRow({ relais_id: 'relais-Y' })] }]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).patch('/api/orders/o1/status').send({ status: 'shipped' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/n'appartient pas à votre relais/);
    expectTransactionRolledBack(client);
    expect(transitionOrderStatus).not.toHaveBeenCalled();
  });

  it('autorise agent_relais sur son propre relais', async () => {
    mockState.user = { id: 'agent-1', role: 'agent_relais', relais_id: 'relais-X' };
    const client = makeClient([{ rows: [orderRow({ relais_id: 'relais-X' })] }]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).patch('/api/orders/o1/status').send({ status: 'shipped' });

    expect(res.status).toBe(200);
  });

  it('échec de la machine avec erreur "Rôle" → 403', async () => {
    const client = makeClient([{ rows: [orderRow()] }]);
    db.getClient.mockResolvedValue(client);
    transitionOrderStatus.mockResolvedValue({ success: false, error: 'Rôle non autorisé pour cette transition' });

    const res = await request(app).patch('/api/orders/o1/status').send({ status: 'shipped' });

    expect(res.status).toBe(403);
    expect(res.body.current_status).toBe('preparation');
    expectTransactionRolledBack(client);
  });

  it('échec de la machine (autre erreur) → 422', async () => {
    const client = makeClient([{ rows: [orderRow()] }]);
    db.getClient.mockResolvedValue(client);
    transitionOrderStatus.mockResolvedValue({ success: false, error: 'transition invalide' });

    const res = await request(app).patch('/api/orders/o1/status').send({ status: 'shipped' });

    expect(res.status).toBe(422);
    expectTransactionRolledBack(client);
  });

  it('succès → commit + réponse { success, status }', async () => {
    const client = makeClient([{ rows: [orderRow()] }]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).patch('/api/orders/o1/status').send({ status: 'shipped', note: 'parti' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, status: 'shipped' });
    expect(transitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'order-1', newStatus: 'shipped', source: 'patch', note: 'parti',
    }));
    expectTransactionCommitted(client);
  });

  it('cancelReason fixé seulement si status === cancelled ET note présente', async () => {
    const client = makeClient([{ rows: [orderRow()] }]);
    db.getClient.mockResolvedValue(client);

    await request(app).patch('/api/orders/o1/status').send({ status: 'cancelled', note: 'rupture stock' });

    expect(transitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({ cancelReason: 'rupture stock' }));
  });

  it('status collected → émet la preuve de retrait et recalcule la fidélité', async () => {
    const client = makeClient([{ rows: [orderRow({ status: 'available' })] }]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).patch('/api/orders/o1/status').send({ status: 'collected' });

    expect(res.status).toBe(200);
    await new Promise(process.nextTick);
    expect(pickupProofService.issue).toHaveBeenCalledWith('order-1', { issuedBy: 'admin-1' });
    expect(recalculateLoyalty).toHaveBeenCalledWith(db, 'user-1');
  });

  it('status non-collected → pas de preuve de retrait ni de recalcul fidélité', async () => {
    const client = makeClient([{ rows: [orderRow()] }]);
    db.getClient.mockResolvedValue(client);

    await request(app).patch('/api/orders/o1/status').send({ status: 'shipped' });

    expect(pickupProofService.issue).not.toHaveBeenCalled();
    expect(recalculateLoyalty).not.toHaveBeenCalled();
  });

  it('notifyStatusChange est toujours appelé (non bloquant)', async () => {
    const client = makeClient([{ rows: [orderRow()] }]);
    db.getClient.mockResolvedValue(client);

    const order = orderRow();
    await request(app).patch('/api/orders/o1/status').send({ status: 'shipped' });

    await new Promise(process.nextTick);
    expect(notifyStatusChange).toHaveBeenCalledWith(expect.objectContaining({ id: order.id }), 'shipped');
  });

  it('erreur DB inattendue → rollback + next(err) → 500', async () => {
    const client = makeClient([{ error: new Error('db down') }]);
    db.getClient.mockResolvedValue(client);

    const res = await request(app).patch('/api/orders/o1/status').send({ status: 'shipped' });

    expect(res.status).toBe(500);
    expectTransactionRolledBack(client);
  });
});

describe('orders/status — PATCH /:id/cost — garde de rôle', () => {
  it('403 si non-admin', async () => {
    mockState.user = { id: 'u2', role: 'agent_hub' };
    const res = await request(app).patch('/api/orders/o1/cost').send({ cost_real_kmf: 1000 });
    expect(res.status).toBe(403);
  });
});

describe('orders/status — PATCH /:id/cost', () => {
  it('400 si cost_real_kmf manquant', async () => {
    const res = await request(app).patch('/api/orders/o1/cost').send({});
    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('404 si commande introuvable', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/api/orders/o1/cost').send({ cost_real_kmf: 1000 });
    expect(res.status).toBe(404);
  });

  it('UPDATE minimal (sans supplier_name/url) puis SELECT final', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [orderRow()] }) // SELECT order
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', cost_real_kmf: 1000 }] }); // SELECT final

    const res = await request(app).patch('/api/orders/o1/cost').send({ cost_real_kmf: 1000 });

    expect(res.status).toBe(200);
    const [updateSql, updateParams] = db.query.mock.calls[1];
    expect(updateSql).toContain('cost_real_kmf = $1');
    expect(updateSql).not.toContain('supplier_name');
    expect(updateParams).toEqual([1000, 'order-1']);
  });

  it('UPDATE inclut supplier_name et supplier_invoice_url si fournis', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [orderRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'order-1' }] });

    await request(app).patch('/api/orders/o1/cost').send({
      cost_real_kmf: 1000, supplier_name: 'Fournisseur X', supplier_invoice_url: 'http://x.com/f.pdf',
    });

    const [updateSql, updateParams] = db.query.mock.calls[1];
    expect(updateSql).toContain('supplier_name = $2');
    expect(updateSql).toContain('supplier_invoice_url = $3');
    expect(updateParams).toEqual([1000, 'Fournisseur X', 'http://x.com/f.pdf', 'order-1']);
  });

  it('INSERT customs_history si customs_real_kmf ET sh_category fournis', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [orderRow({ cost_estimated_kmf: 4000 })] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }) // INSERT customs_history
      .mockResolvedValueOnce({ rows: [{ id: 'order-1' }] }); // SELECT final

    const res = await request(app).patch('/api/orders/o1/cost').send({
      cost_real_kmf: 1000, customs_real_kmf: 800, sh_category: '6101', customs_agent_id: 'agent-1', customs_notes: 'ok',
    });

    expect(res.status).toBe(200);
    const [insertSql, insertParams] = db.query.mock.calls[2];
    expect(insertSql).toContain('INSERT INTO customs_history');
    expect(insertParams).toEqual(['order-1', '6101', 4000, 800, 'agent-1', 'ok']);
  });

  it('pas d\'INSERT customs_history si sh_category absent', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [orderRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'order-1' }] });

    await request(app).patch('/api/orders/o1/cost').send({ cost_real_kmf: 1000, customs_real_kmf: 800 });

    expect(db.query).toHaveBeenCalledTimes(3); // pas de 4e appel INSERT
  });

  it('erreur DB → next(err) → 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).patch('/api/orders/o1/cost').send({ cost_real_kmf: 1000 });
    expect(res.status).toBe(500);
  });
});
