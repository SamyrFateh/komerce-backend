'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/admin-orders-route.test.js
 *
 * Tests du router routes/admin/orders.js.
 *
 * Couverture :
 *   ✓ Garde d'accès : authenticate + requireRole(['admin'])
 *   ✓ GET /orders    : construction dynamique du WHERE (status, payment_mode,
 *                       confection_type, from_date, to_date, margin_alert, search),
 *                       pagination limit/offset, réponse { orders, total },
 *                       erreur DB → next(err)
 *   ✓ DELETE /orders/:id : 404 si introuvable, succès → deleteOrderCascade,
 *                       erreur DB → next(err)
 *   ✓ POST /orders/:id/refund : délègue à refundCancelledOrder avec les bons
 *                       défauts (dryRun=true sauf si dry_run===false explicite,
 *                       reason=null, cashMode='manual'), erreur → next(err)
 */

const mockState = { user: { id: 'admin-1', role: 'admin', email: 'admin@komerce.test' } };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = mockState.user; next(); },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockDeleteOrderCascade = jest.fn();
jest.mock('../../routes/admin/delete-order-cascade', () => ({
  deleteOrderCascade: (...args) => mockDeleteOrderCascade(...args),
}));

const mockRefundCancelledOrder = jest.fn();
jest.mock('../../services/admin-order-refund', () => ({
  refundCancelledOrder: (...args) => mockRefundCancelledOrder(...args),
}));

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  mockState.user = { id: 'admin-1', role: 'admin', email: 'admin@komerce.test' };

  app = express();
  app.use(express.json());

  jest.isolateModules(() => {
    const router = require('../../routes/admin/orders');
    app.use('/api/admin', router);
  });

  app.use((err, req, res, _next) => {
    res.status(500).json({ error: err.message });
  });
});

describe('admin/orders — garde d\'accès', () => {
  it('403 si non-admin', async () => {
    mockState.user = { id: 'u2', role: 'agent_hub' };
    const res = await request(app).get('/api/admin/orders');
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('admin/orders — GET /orders', () => {
  it('sans filtre : WHERE 1=1, pagination par défaut (limit 50, offset 0)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'o1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(app).get('/api/admin/orders');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orders: [{ id: 'o1' }], total: 1 });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('WHERE 1=1');
    expect(params).toEqual([50, 0]);
  });

  it('applique tous les filtres et construit le WHERE/params attendus', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const res = await request(app).get('/api/admin/orders').query({
      status: 'shipped',
      payment_mode: 'wallet',
      confection_type: 'custom',
      from_date: '2026-01-01',
      to_date: '2026-06-01',
      margin_alert: 'true',
      search: 'Ali',
      limit: 10,
      offset: 20,
    });

    expect(res.status).toBe(200);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('o.status = $1');
    expect(sql).toContain('o.payment_mode = $2');
    expect(sql).toContain('o.confection_type = $3');
    expect(sql).toContain('o.created_at >= $4');
    expect(sql).toContain('o.created_at <= $5');
    expect(sql).toContain('o.margin_alert = TRUE');
    expect(sql).toContain('o.reference ILIKE $6');
    expect(params).toEqual(['shipped', 'wallet', 'custom', '2026-01-01', '2026-06-01', '%Ali%', 10, 20]);

    // Le 2e appel (COUNT) réutilise les mêmes params (sans limit/offset)
    const [countSql, countParams] = mockQuery.mock.calls[1];
    expect(countSql).toContain('COUNT(*)');
    expect(countParams).toEqual(['shipped', 'wallet', 'custom', '2026-01-01', '2026-06-01', '%Ali%']);
  });

  it('margin_alert différent de "true" est ignoré', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await request(app).get('/api/admin/orders').query({ margin_alert: 'false' });

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('margin_alert = TRUE');
  });

  it('erreur DB → next(err) → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connexion DB perdue'));
    const res = await request(app).get('/api/admin/orders');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'connexion DB perdue' });
  });
});

describe('admin/orders — DELETE /orders/:id', () => {
  it('404 si la commande est introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete('/api/admin/orders/missing-id');
    expect(res.status).toBe(404);
    expect(mockDeleteOrderCascade).not.toHaveBeenCalled();
  });

  it('succès : delete cascade + réponse formatée', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-001', status: 'pending' }] });
    mockDeleteOrderCascade.mockResolvedValueOnce(undefined);

    const res = await request(app).delete('/api/admin/orders/o1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Commande CMD-001 supprimée',
      deleted: { id: 'o1', reference: 'CMD-001', status: 'pending' },
    });
    expect(mockDeleteOrderCascade).toHaveBeenCalledWith(expect.anything(), 'o1');
  });

  it('erreur DB (lookup) → next(err) → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('uuid invalide'));
    const res = await request(app).delete('/api/admin/orders/bad-id');
    expect(res.status).toBe(500);
  });

  it('erreur pendant la cascade → next(err) → 500', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-001', status: 'pending' }] });
    mockDeleteOrderCascade.mockRejectedValueOnce(new Error('cascade échouée'));
    const res = await request(app).delete('/api/admin/orders/o1');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'cascade échouée' });
  });
});

describe('admin/orders — POST /orders/:id/refund', () => {
  it('défauts : dryRun=true, reason=null, cashMode=manual', async () => {
    mockRefundCancelledOrder.mockResolvedValueOnce({ status: 200, body: { ok: true } });

    const res = await request(app).post('/api/admin/orders/o1/refund').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockRefundCancelledOrder).toHaveBeenCalledWith({
      orderId: 'o1',
      user: mockState.user,
      dryRun: true,
      reason: null,
      cashMode: 'manual',
    });
  });

  it('dry_run: false → dryRun=false explicite', async () => {
    mockRefundCancelledOrder.mockResolvedValueOnce({ status: 200, body: { ok: true } });

    await request(app).post('/api/admin/orders/o1/refund').send({
      dry_run: false, reason: 'erreur client', cash_mode: 'relais',
    });

    expect(mockRefundCancelledOrder).toHaveBeenCalledWith({
      orderId: 'o1',
      user: mockState.user,
      dryRun: false,
      reason: 'erreur client',
      cashMode: 'relais',
    });
  });

  it('dry_run: true explicite reste dryRun=true', async () => {
    mockRefundCancelledOrder.mockResolvedValueOnce({ status: 200, body: { ok: true } });
    await request(app).post('/api/admin/orders/o1/refund').send({ dry_run: true });
    expect(mockRefundCancelledOrder).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it('propage le status/body renvoyés par le service (ex: 409 conflit)', async () => {
    mockRefundCancelledOrder.mockResolvedValueOnce({ status: 409, body: { error: 'déjà remboursée' } });
    const res = await request(app).post('/api/admin/orders/o1/refund').send({});
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'déjà remboursée' });
  });

  it('erreur → next(err) → 500', async () => {
    mockRefundCancelledOrder.mockRejectedValueOnce(new Error('service refund indisponible'));
    const res = await request(app).post('/api/admin/orders/o1/refund').send({});
    expect(res.status).toBe(500);
  });
});
