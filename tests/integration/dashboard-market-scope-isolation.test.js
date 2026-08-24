'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

const dbUrl = process.env.DATABASE_URL || '';
const hasIntegrationEnv = dbUrl.startsWith('postgresql://') && dbUrl.length > 20;

if (!hasIntegrationEnv) {
  describe.skip('dashboard-market-scope-isolation (needs DATABASE_URL)', () => {
    test('skipped — DATABASE_URL not configured', () => {});
  });
} else {
  let mockUserId = null;
  const mockBuildMarketPilotage = jest.fn(async (filters, market) => ({
    scope: { mode: 'market', market: { code: market.code } },
    server_market_id: filters.market_id,
  }));

  jest.mock('../../middleware/auth', () => ({
    authenticate: (req, res, next) => {
      req.user = { id: mockUserId, role: 'admin' };
      next();
    },
    requireAdmin: (req, res, next) => {
      if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
      next();
    },
  }));

  jest.mock('../../services/dashboard-pilotage-market', () => ({
    buildMarketPilotage: (...args) => mockBuildMarketPilotage(...args),
  }));

  jest.mock('../../utils/logger', () => ({
    child: jest.fn(() => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() })),
  }));

  const express = require('express');
  const request = require('supertest');
  const db = require('../../db');
  const router = require('../../routes/admin-dashboard-market');

  const PFX = 'itest-dashboard-scope+';
  const CI_PLACEHOLDER_HASH = '$2a$04$AYmAyvzy6sAbPHhY01nPau5qvXBxnD/DFrgbpUzd5QXDR3VgjkISm';
  const marketIds = {};

  function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/admin/dashboard', router);
    return app;
  }

  beforeAll(async () => {
    const { rows: markets } = await db.query(
      `SELECT id, code FROM markets
       WHERE code = ANY($1::text[]) AND is_active = TRUE`,
      [['KM', 'CM', 'CG']]
    );
    for (const row of markets) marketIds[row.code] = row.id;
    expect(Object.keys(marketIds).sort()).toEqual(['CG', 'CM', 'KM']);

    const unique = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    const { rows } = await db.query(
      `INSERT INTO users (email, full_name, phone, role, password_hash)
       VALUES ($1, 'ITest Dashboard Market Scope', $2, 'admin', $3)
       RETURNING id`,
      [`${PFX}${unique}@test.local`, `+2694${Math.floor(1000000 + Math.random() * 8999999)}`, CI_PLACEHOLDER_HASH]
    );
    mockUserId = rows[0].id;

    await db.query(
      `INSERT INTO operator_market_scopes (user_id, market_id, role)
       VALUES ($1, $2, 'manager')`,
      [mockUserId, marketIds.CM]
    );
  });

  afterAll(async () => {
    if (mockUserId) {
      await db.query('DELETE FROM operator_market_scopes WHERE user_id = $1', [mockUserId]);
    }
    await db.query('DELETE FROM users WHERE email LIKE $1', [`${PFX}%`]);
  });

  beforeEach(() => {
    mockBuildMarketPilotage.mockClear();
  });

  describe('route Pilotage — isolation réelle CM / CG / KM', () => {
    test('CM autorisé → 200 et UUID CM résolu serveur transmis à l’agrégateur', async () => {
      const res = await request(makeApp()).get('/api/admin/dashboard/unified/market/CM');
      expect(res.status).toBe(200);
      expect(res.body.scope.market.code).toBe('CM');
      expect(res.body.server_market_id).toBe(marketIds.CM);
      expect(mockBuildMarketPilotage).toHaveBeenCalledTimes(1);
    });

    test.each(['CG', 'KM'])('%s sans grant → 403 avant agrégation', async code => {
      const res = await request(makeApp()).get(`/api/admin/dashboard/unified/market/${code}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('market_scope_denied');
      expect(mockBuildMarketPilotage).not.toHaveBeenCalled();
    });

    test('un market_id client CG ne peut pas élever une requête CM', async () => {
      const res = await request(makeApp())
        .get(`/api/admin/dashboard/unified/market/CM?market_id=${marketIds.CG}`);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('client_market_id_forbidden');
      expect(mockBuildMarketPilotage).not.toHaveBeenCalled();
    });
  });
}
