'use strict';

/**
 * tests/unit/cash-route.test.js
 *
 * Tests du router routes/cash.js (monté sur /api/cash).
 *
 * Couverture :
 *   POST /collect/:orderId : garde de rôle (admin/agent_relais), délégation
 *     à collectCash, tous les codes d'erreur métier (404/400/409/403),
 *     succès → commit + hooks post-commit non bloquants (loyalty, purchasing,
 *     notification), erreur → rollback + next(err)
 *   GET  /collections : construction WHERE selon rôle (admin voit tout,
 *     agent voit le sien), filtres agent_id/from/to, pagination
 *   POST /deposit : validations (montant, méthode, période), succès
 *   GET  /deposits : construction WHERE selon rôle + filtre status
 *   POST /deposits/:id/verify : 404 si introuvable, succès
 *   POST /deposits/:id/dispute : 400 si reason manquant, 404, succès
 *   GET  /reconciliation : agrégation expected/declared/deposited + statuts
 *     clean/warning/alert
 *   GET  /reconciliation/agents : succès simple
 *   GET  /uncollected : seuil hours, calcul total_missing_kmf
 */

jest.mock('../../db', () => ({ getClient: jest.fn(), query: jest.fn() }));

const mockState = { user: { id: 'agent-1', role: 'agent_relais' } };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = mockState.user; next(); },
  requireAdmin: (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès réservé admin' });
    next();
  },
}));

jest.mock('../../services/cash-operations', () => ({
  collectCash: jest.fn(),
}));

jest.mock('../../services/notification-service', () => ({
  notifyPaymentConfirmed: jest.fn().mockResolvedValue(undefined),
}));

// O7.2 (Cycle A) : voir docs/O7_2_CYCLE_ANALYSIS.md.
jest.mock('../../services/invoice-service', () => ({
  sendInvoiceReadyNotification: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock('../../services/loyalty-service', () => ({
  handleOrderConfirmed: jest.fn().mockResolvedValue({ skipped: true }),
}));

jest.mock('../../services/purchasing-trigger-service', () => ({
  triggerPurchasing: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const { makeClient, expectTransactionRolledBack, expectTransactionCommitted } = require('../integration/test-harness/mock-db');

const db = require('../../db');
const { collectCash } = require('../../services/cash-operations');
const notifSvc = require('../../services/notification-service');
const { triggerPurchasing } = require('../../services/purchasing-trigger-service');

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  mockState.user = { id: 'agent-1', role: 'agent_relais' };
  db.query.mockResolvedValue({ rows: [] });

  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/cash');
    app.use('/api/cash', router);
  });
  app.use((err, req, res, _next) => {
    res.status(500).json({ error: err.message });
  });
});

describe('cash — garde de rôle (requireRelaisOrAdmin)', () => {
  it('403 si client tente /collect', async () => {
    mockState.user = { id: 'u2', role: 'client' };
    const res = await request(app).post('/api/cash/collect/o1').send({});
    expect(res.status).toBe(403);
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it('403 si client tente /collections', async () => {
    mockState.user = { id: 'u2', role: 'client' };
    const res = await request(app).get('/api/cash/collections');
    expect(res.status).toBe(403);
  });
});

describe('cash — POST /collect/:orderId', () => {
  it('404 si commande introuvable', async () => {
    const client = makeClient([]);
    db.getClient.mockResolvedValue(client);
    collectCash.mockResolvedValue({ order_not_found: true });

    const res = await request(app).post('/api/cash/collect/o1').send({});

    expect(res.status).toBe(404);
    expectTransactionRolledBack(client);
  });

  it('400 si payment_mode invalide', async () => {
    const client = makeClient([]);
    db.getClient.mockResolvedValue(client);
    collectCash.mockResolvedValue({ invalid_payment_mode: true });

    const res = await request(app).post('/api/cash/collect/o1').send({});

    expect(res.status).toBe(400);
    expectTransactionRolledBack(client);
  });

  it('409 si payment_status déjà avancé', async () => {
    const client = makeClient([]);
    db.getClient.mockResolvedValue(client);
    collectCash.mockResolvedValue({ invalid_payment_status: true, payment_status: 'paid' });

    const res = await request(app).post('/api/cash/collect/o1').send({});

    expect(res.status).toBe(409);
    expect(res.body.current_payment_status).toBe('paid');
    expectTransactionRolledBack(client);
  });

  it('409 si statut commande invalide', async () => {
    const client = makeClient([]);
    db.getClient.mockResolvedValue(client);
    collectCash.mockResolvedValue({ invalid_status: true, status: 'cancelled' });

    const res = await request(app).post('/api/cash/collect/o1').send({});

    expect(res.status).toBe(409);
    expect(res.body.current_status).toBe('cancelled');
  });

  it('403 si config agent incomplète', async () => {
    const client = makeClient([]);
    db.getClient.mockResolvedValue(client);
    collectCash.mockResolvedValue({ agent_config_error: true });

    const res = await request(app).post('/api/cash/collect/o1').send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Configuration agent/);
  });

  it('403 si commande d\'un autre relais', async () => {
    const client = makeClient([]);
    db.getClient.mockResolvedValue(client);
    collectCash.mockResolvedValue({ cross_relais_blocked: true });

    const res = await request(app).post('/api/cash/collect/o1').send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/autre relais/);
  });

  it('409 si déjà collecté', async () => {
    const client = makeClient([]);
    db.getClient.mockResolvedValue(client);
    collectCash.mockResolvedValue({ already_collected: true, collection_id: 'coll-1' });

    const res = await request(app).post('/api/cash/collect/o1').send({});

    expect(res.status).toBe(409);
    expect(res.body.collection_id).toBe('coll-1');
  });

  it('409 si stock insuffisant', async () => {
    const client = makeClient([]);
    db.getClient.mockResolvedValue(client);
    collectCash.mockResolvedValue({ stock_blocked: true, insufficient_items: [{ product_id: 'p1' }] });

    const res = await request(app).post('/api/cash/collect/o1').send({});

    expect(res.status).toBe(409);
    expect(res.body.insufficient_items).toEqual([{ product_id: 'p1' }]);
  });

  it('succès → commit + réponse 201 + hooks post-commit', async () => {
    const client = makeClient([]);
    db.getClient.mockResolvedValue(client);
    collectCash.mockResolvedValue({
      amount_kmf: 15000,
      collection: { id: 'coll-1', order_id: 'order-1' },
      noop: false,
    });
    db.query.mockResolvedValue({ rows: [{ reference: 'CMD-001' }] });

    const res = await request(app).post('/api/cash/collect/order-1').send({});

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/15.000 KMF/);
    expect(res.body.collection).toEqual({ id: 'coll-1', order_id: 'order-1' });
    expectTransactionCommitted(client);

    await new Promise(process.nextTick);
    await new Promise(process.nextTick);
    expect(notifSvc.notifyPaymentConfirmed).toHaveBeenCalledWith('order-1', 'CMD-001');
    expect(triggerPurchasing).toHaveBeenCalledWith('order-1');
  });

  it('erreur dans collectCash → rollback + next(err) → 500', async () => {
    const client = makeClient([]);
    db.getClient.mockResolvedValue(client);
    collectCash.mockRejectedValue(new Error('db down'));

    const res = await request(app).post('/api/cash/collect/o1').send({});

    expect(res.status).toBe(500);
    expectTransactionRolledBack(client);
  });
});

describe('cash — GET /collections', () => {
  it('agent non-admin : filtre automatiquement sur son propre id', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'cc1' }] })
      .mockResolvedValueOnce({ rows: [{ cnt: '1' }] });

    const res = await request(app).get('/api/cash/collections');

    expect(res.status).toBe(200);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('cc.collected_by = $1');
    expect(params).toEqual(['agent-1', 50, 0]);
  });

  it('admin sans agent_id : pas de filtre collected_by', async () => {
    mockState.user = { id: 'admin-1', role: 'admin' };
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] });

    const res = await request(app).get('/api/cash/collections');

    expect(res.status).toBe(200);
    const [sql] = db.query.mock.calls[0];
    expect(sql).not.toContain('cc.collected_by = $');
  });

  it('admin avec agent_id + from/to : construit le WHERE complet', async () => {
    mockState.user = { id: 'admin-1', role: 'admin' };
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] });

    await request(app).get('/api/cash/collections').query({
      agent_id: 'agent-x', from: '2026-01-01', to: '2026-06-01', page: 2, limit: 10,
    });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('cc.collected_by = $1');
    expect(sql).toContain('cc.confirmed_at >= $2');
    expect(sql).toContain('cc.confirmed_at <= $3');
    expect(params).toEqual(['agent-x', '2026-01-01', '2026-06-01', 10, 10]); // offset = (2-1)*10
  });

  it('erreur DB → next(err) → 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/cash/collections');
    expect(res.status).toBe(500);
  });
});

describe('cash — POST /deposit', () => {
  it('400 si amount_kmf manquant ou <= 0', async () => {
    const res = await request(app).post('/api/cash/deposit').send({ amount_kmf: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Montant/);
  });

  it('400 si deposit_method invalide', async () => {
    const res = await request(app).post('/api/cash/deposit').send({ amount_kmf: 1000, deposit_method: 'crypto' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Méthode invalide/);
  });

  it('400 si période manquante', async () => {
    const res = await request(app).post('/api/cash/deposit').send({ amount_kmf: 1000, deposit_method: 'bank' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Période/);
  });

  it('succès → 201 + INSERT cash_deposits', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'dep-1', amount_kmf: 5000 }] });

    const res = await request(app).post('/api/cash/deposit').send({
      amount_kmf: 5000, deposit_method: 'mobile_money', period_start: '2026-06-01', period_end: '2026-06-07',
    });

    expect(res.status).toBe(201);
    expect(res.body.deposit).toEqual({ id: 'dep-1', amount_kmf: 5000 });
    expect(res.body.message).toMatch(/5.000 KMF/);
  });

  it('erreur DB → next(err) → 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/cash/deposit').send({
      amount_kmf: 5000, deposit_method: 'bank', period_start: '2026-06-01', period_end: '2026-06-07',
    });
    expect(res.status).toBe(500);
  });
});

describe('cash — GET /deposits', () => {
  it('agent non-admin filtre sur son id, status filtré si fourni', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] });

    await request(app).get('/api/cash/deposits').query({ status: 'pending' });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('cd.agent_id = $1');
    expect(sql).toContain('cd.status = $2');
    expect(params).toEqual(['agent-1', 'pending', 50, 0]);
  });

  it('erreur DB → next(err) → 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/cash/deposits');
    expect(res.status).toBe(500);
  });
});

describe('cash — POST /deposits/:id/verify', () => {
  it('403 si non-admin', async () => {
    const res = await request(app).post('/api/cash/deposits/d1/verify').send({});
    expect(res.status).toBe(403);
  });

  it('404 si dépôt introuvable', async () => {
    mockState.user = { id: 'admin-1', role: 'admin' };
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/cash/deposits/d1/verify').send({});

    expect(res.status).toBe(404);
  });

  it('succès → dépôt vérifié', async () => {
    mockState.user = { id: 'admin-1', role: 'admin' };
    db.query.mockResolvedValueOnce({ rows: [{ id: 'd1', status: 'verified' }] });

    const res = await request(app).post('/api/cash/deposits/d1/verify').send({ notes: 'ok' });

    expect(res.status).toBe(200);
    expect(res.body.deposit.status).toBe('verified');
  });
});

describe('cash — POST /deposits/:id/dispute', () => {
  it('403 si non-admin', async () => {
    const res = await request(app).post('/api/cash/deposits/d1/dispute').send({ reason: 'x' });
    expect(res.status).toBe(403);
  });

  it('400 si reason manquant', async () => {
    mockState.user = { id: 'admin-1', role: 'admin' };
    const res = await request(app).post('/api/cash/deposits/d1/dispute').send({});
    expect(res.status).toBe(400);
  });

  it('404 si dépôt introuvable', async () => {
    mockState.user = { id: 'admin-1', role: 'admin' };
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/cash/deposits/d1/dispute').send({ reason: 'écart' });

    expect(res.status).toBe(404);
  });

  it('succès → dépôt contesté', async () => {
    mockState.user = { id: 'admin-1', role: 'admin' };
    db.query.mockResolvedValueOnce({ rows: [{ id: 'd1', status: 'disputed' }] });

    const res = await request(app).post('/api/cash/deposits/d1/dispute').send({ reason: 'écart' });

    expect(res.status).toBe(200);
    expect(res.body.deposit.status).toBe('disputed');
  });
});

describe('cash — GET /reconciliation', () => {
  beforeEach(() => {
    mockState.user = { id: 'admin-1', role: 'admin' };
  });

  it('403 si non-admin', async () => {
    mockState.user = { id: 'u2', role: 'agent_relais' };
    const res = await request(app).get('/api/cash/reconciliation');
    expect(res.status).toBe(403);
  });

  it('status clean si gap_collection=0 et gap_deposit=0', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ agent_id: 'a1', agent_name: 'Agent 1', agent_phone: '+269', expected_kmf: '10000', expected_count: '2' }] })
      .mockResolvedValueOnce({ rows: [{ agent_id: 'a1', declared_kmf: '10000', declared_count: '2' }] })
      .mockResolvedValueOnce({ rows: [{ agent_id: 'a1', deposited_kmf: '10000', deposit_count: '1', verified_kmf: '10000', pending_kmf: '0', disputed_kmf: '0' }] });

    const res = await request(app).get('/api/cash/reconciliation');

    expect(res.status).toBe(200);
    expect(res.body.agents[0].status).toBe('clean');
  });

  it('status warning si petit écart de collecte', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ agent_id: 'a1', agent_name: 'A', agent_phone: null, expected_kmf: '10000', expected_count: '2' }] })
      .mockResolvedValueOnce({ rows: [{ agent_id: 'a1', declared_kmf: '9500', declared_count: '2' }] }) // gap = 500 < 10% de 10000
      .mockResolvedValueOnce({ rows: [{ agent_id: 'a1', deposited_kmf: '9500', deposit_count: '1', verified_kmf: '9500', pending_kmf: '0', disputed_kmf: '0' }] });

    const res = await request(app).get('/api/cash/reconciliation');

    expect(res.body.agents[0].status).toBe('warning');
  });

  it('status alert si gros écart de collecte', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ agent_id: 'a1', agent_name: 'A', agent_phone: null, expected_kmf: '10000', expected_count: '2' }] })
      .mockResolvedValueOnce({ rows: [{ agent_id: 'a1', declared_kmf: '5000', declared_count: '1' }] }) // gap = 5000 >= 10%
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/cash/reconciliation');

    expect(res.body.agents[0].status).toBe('alert');
  });

  it('filtre par agent_id si fourni', async () => {
    db.query.mockResolvedValue({ rows: [] });

    await request(app).get('/api/cash/reconciliation').query({ agent_id: 'agent-x', from: '2026-01-01', to: '2026-01-31' });

    const [declaredSql, declaredParams] = db.query.mock.calls[1];
    expect(declaredSql).toContain('cc.collected_by = $3');
    expect(declaredParams).toEqual(['2026-01-01', '2026-01-31', 'agent-x']);
  });

  it('erreur DB → next(err) → 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/cash/reconciliation');
    expect(res.status).toBe(500);
  });
});

describe('cash — GET /reconciliation/agents', () => {
  it('403 si non-admin', async () => {
    const res = await request(app).get('/api/cash/reconciliation/agents');
    expect(res.status).toBe(403);
  });

  it('succès → liste des agents', async () => {
    mockState.user = { id: 'admin-1', role: 'admin' };
    db.query.mockResolvedValueOnce({ rows: [{ agent_id: 'a1', balance_kmf: 500 }] });

    const res = await request(app).get('/api/cash/reconciliation/agents');

    expect(res.status).toBe(200);
    expect(res.body.agents).toEqual([{ agent_id: 'a1', balance_kmf: 500 }]);
  });

  it('erreur DB → next(err) → 500', async () => {
    mockState.user = { id: 'admin-1', role: 'admin' };
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/cash/reconciliation/agents');
    expect(res.status).toBe(500);
  });
});

describe('cash — GET /uncollected', () => {
  it('403 si non-admin', async () => {
    const res = await request(app).get('/api/cash/uncollected');
    expect(res.status).toBe(403);
  });

  it('utilise le seuil par défaut (48h) et calcule total_missing_kmf', async () => {
    mockState.user = { id: 'admin-1', role: 'admin' };
    db.query.mockResolvedValueOnce({ rows: [{ id: 'o1', total_kmf: 5000 }, { id: 'o2', total_kmf: 3000 }] });

    const res = await request(app).get('/api/cash/uncollected');

    expect(res.status).toBe(200);
    expect(res.body.hours_threshold).toBe(48);
    expect(res.body.count).toBe(2);
    expect(res.body.total_missing_kmf).toBe(8000);
    const [, params] = db.query.mock.calls[0];
    expect(params).toEqual([48]);
  });

  it('respecte le seuil personnalisé via query', async () => {
    mockState.user = { id: 'admin-1', role: 'admin' };
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/cash/uncollected').query({ hours: 24 });

    expect(res.body.hours_threshold).toBe(24);
    const [, params] = db.query.mock.calls[0];
    expect(params).toEqual([24]);
  });

  it('erreur DB → next(err) → 500', async () => {
    mockState.user = { id: 'admin-1', role: 'admin' };
    db.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/cash/uncollected');
    expect(res.status).toBe(500);
  });
});
