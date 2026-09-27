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
  let assignmentId = null;
  let membershipId = null;
  let otherAssignmentIds = [];
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
    requireRole: (roles) => (req, res, next) => {
      if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
      if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
      next();
    },
  }));

  jest.mock('../../services/dashboard-pilotage-market', () => ({
    buildMarketPilotage: (...args) => mockBuildMarketPilotage(...args),
  }));

  jest.mock('../../utils/logger', () => {
    const makeLogger = () => ({
      warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn(),
    });
    return {
      child: jest.fn(() => makeLogger()),
      forModule: jest.fn(() => makeLogger()),
    };
  });

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

    // LOT B (audit dashboard.market.read) : /unified/market/:marketCode est
    // désormais gouverné exclusivement par la capability DELEGATION
    // dashboard.market.read (cf. requireUnifiedMarketRead) — un
    // operator_market_scopes legacy seul ne suffit plus. La fixture doit
    // donc poser un vrai Market Operating Assignment ACTIVE + ceiling +
    // membership ACTIVE + membership_capabilities pour CM (cf.
    // tests/helpers/marketDelegationE2EKit.js pour le pattern de référence).
    const assignment = await db.query(
      `INSERT INTO market_operating_assignments (market_id, status)
       VALUES ($1, 'ACTIVE')
       RETURNING id`,
      [marketIds.CM]
    );
    assignmentId = assignment.rows[0].id;

    await db.query(
      `INSERT INTO assignment_capability_ceiling (assignment_id, capability)
       VALUES ($1, 'dashboard.market.read')`,
      [assignmentId]
    );

    const membership = await db.query(
      `INSERT INTO assignment_memberships (assignment_id, user_id, status)
       VALUES ($1, $2, 'ACTIVE')
       RETURNING id`,
      [assignmentId, mockUserId]
    );
    membershipId = membership.rows[0].id;

    await db.query(
      `INSERT INTO membership_capabilities (membership_id, capability)
       VALUES ($1, 'dashboard.market.read')`,
      [membershipId]
    );

    // CG et KM doivent aussi être onboardés en DELEGATION (assignment
    // ACTIVE) — mockUserId n'y a simplement aucune membership. Sans ça,
    // resolveActiveAssignmentByMarketCode échoue avant même la vérification
    // de membership (409 MARKET_ASSIGNMENT_NOT_ACTIVE) et le test ne prouve
    // plus « pas de grant » (403) mais « marché non onboardé ».
    const otherAssignments = await db.query(
      `INSERT INTO market_operating_assignments (market_id, status)
       SELECT id, 'ACTIVE' FROM markets WHERE id = ANY($1)
       RETURNING id`,
      [[marketIds.CG, marketIds.KM]]
    );
    otherAssignmentIds = otherAssignments.rows.map(r => r.id);
  });

  afterAll(async () => {
    if (otherAssignmentIds.length) {
      await db.query('DELETE FROM market_operating_assignments WHERE id = ANY($1)', [otherAssignmentIds]);
    }
    if (membershipId) {
      await db.query('DELETE FROM membership_capabilities WHERE membership_id = $1', [membershipId]);
      await db.query('DELETE FROM assignment_memberships WHERE id = $1', [membershipId]);
    }
    if (assignmentId) {
      await db.query('DELETE FROM assignment_capability_ceiling WHERE assignment_id = $1', [assignmentId]);
      await db.query('DELETE FROM market_operating_assignments WHERE id = $1', [assignmentId]);
    }
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
      // LOT B (audit dashboard.market.read) : la route n'est plus gardée par
      // le scope legacy (code 'market_scope_denied') mais par la capability
      // DELEGATION dashboard.market.read — absence de membership renvoie
      // désormais MARKET_MEMBERSHIP_REQUIRED (cf.
      // require-market-delegated-capability.js / resolveAuthorization).
      expect(res.body.code).toBe('MARKET_MEMBERSHIP_REQUIRED');
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
