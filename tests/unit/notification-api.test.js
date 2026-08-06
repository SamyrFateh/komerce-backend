'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/notification-api.test.js
 *
 * Tests du router routes/notification-api.js (Lot C, AUDIT_TEST_COVERAGE_GLOBAL_2026-07-03.md).
 *
 * routes/notification-api.js était à 0 % — aucun test.
 *
 * Couverture :
 *   ✓ guards auth/admin sur GET / et GET /stats
 *   ✓ GET /        : WHERE dynamique (parcel_ref/order_ref/channel/event),
 *                    limit par défaut 50, plafonné à 200, fallback si non-numérique
 *   ✓ GET /        : table absente (42P01) → réponse vide + warning au lieu de 500
 *   ✓ GET /        : autre erreur DB → next(err) → 500
 *   ✓ GET /stats   : 3 requêtes agrégées assemblées en {totals, by_channel, by_event}
 *   ✓ GET /stats   : table absente (42P01) → fallback, autre erreur → 500
 */

const mockAuthState = { user: { id: 'u-admin', role: 'admin' } };

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = mockAuthState.user; next(); },
  requireAdmin: (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
    next();
  },
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthState.user = { id: 'u-admin', role: 'admin' };
  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/notification-api');
    app.use('/api/v2/notifications', router);
  });
});

describe('notification-api — accès', () => {
  it('401 si req.user absent', async () => {
    mockAuthState.user = null;
    const res = await request(app).get('/api/v2/notifications');
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('403 si rôle non-admin', async () => {
    mockAuthState.user = { id: 'u1', role: 'agent_hub' };
    const res = await request(app).get('/api/v2/notifications');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/v2/notifications', () => {
  it('sans filtre : pas de WHERE, limit par défaut 50', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/v2/notifications');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0, notifications: [] });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toMatch(/WHERE/);
    expect(sql).toMatch(/LIMIT 50/);
    expect(params).toEqual([]);
  });

  it('construit le WHERE dynamique dans l\'ordre parcel_ref/order_ref/channel/event', async () => {
    const rows = [{ id: 'n1' }];
    mockQuery.mockResolvedValueOnce({ rows });
    const res = await request(app).get('/api/v2/notifications').query({
      parcel_ref: 'P1', order_ref: 'O1', channel: 'whatsapp', event: 'delivered',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 1, notifications: rows });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('parcel_ref = $1');
    expect(sql).toContain('order_ref = $2');
    expect(sql).toContain('channel = $3');
    expect(sql).toContain('event = $4');
    expect(sql).toContain('WHERE');
    expect(params).toEqual(['P1', 'O1', 'whatsapp', 'delivered']);
  });

  it('WHERE partiel : seul channel fourni → un seul paramètre $1', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/v2/notifications').query({ channel: 'sms' });
    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('channel = $1');
    expect(sql).not.toMatch(/parcel_ref = \$|order_ref = \$|event = \$/);
    expect(sql).not.toMatch(/ AND /);
    expect(params).toEqual(['sms']);
  });

  it('limit fourni est respecté', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/api/v2/notifications').query({ limit: 10 });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/LIMIT 10/);
  });

  it('limit plafonné à 200 même si une valeur plus grande est demandée', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/api/v2/notifications').query({ limit: 99999 });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/LIMIT 200/);
  });

  it('limit non-numérique → fallback à 50', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/api/v2/notifications').query({ limit: 'abc' });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/LIMIT 50/);
  });

  it("table absente (42P01) → réponse vide + warning, pas d'erreur 500", async () => {
    const err = new Error('relation "notification_log" does not exist');
    err.code = '42P01';
    mockQuery.mockRejectedValueOnce(err);
    const res = await request(app).get('/api/v2/notifications');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0, notifications: [], warning: 'Table notification_log not yet created' });
  });

  it('autre erreur DB → next(err) → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/v2/notifications');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/v2/notifications/stats', () => {
  it('assemble les 3 requêtes en {totals, by_channel, by_event}', async () => {
    const byChannel = [{ channel: 'whatsapp', status: 'sent', count: 10 }];
    const byEvent = [{ event: 'delivered', count: 8 }];
    const totals = { total: 10, sent: 8, failed: 2, links: 0, whatsapp: 10, email: 0, sms: 0 };

    mockQuery
      .mockResolvedValueOnce({ rows: byChannel })
      .mockResolvedValueOnce({ rows: byEvent })
      .mockResolvedValueOnce({ rows: [totals] });

    const res = await request(app).get('/api/v2/notifications/stats');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ totals, by_channel: byChannel, by_event: byEvent });
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it('table absente (42P01) → fallback vide, pas de 500', async () => {
    const err = new Error('relation does not exist');
    err.code = '42P01';
    mockQuery.mockRejectedValueOnce(err);

    const res = await request(app).get('/api/v2/notifications/stats');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ totals: {}, by_channel: [], by_event: [], warning: 'Table not yet created' });
  });

  it('autre erreur DB (sur la 1ère requête) → next(err) → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/v2/notifications/stats');
    expect(res.status).toBe(500);
  });

  it('autre erreur DB (sur la 3ème requête, totals) → next(err) → 500', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/v2/notifications/stats');
    expect(res.status).toBe(500);
  });

  it('401/403 identiques à la route liste', async () => {
    mockAuthState.user = { id: 'u1', role: 'client' };
    const res = await request(app).get('/api/v2/notifications/stats');
    expect(res.status).toBe(403);
  });
});
