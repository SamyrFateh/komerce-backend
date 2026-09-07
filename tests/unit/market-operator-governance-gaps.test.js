'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Focused regression suite for CHANTIER_GOUVERNANCE_GAPS (GAP-1..4).
 */

const fs = require('fs');
const path = require('path');

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const marketScope = require('../../middleware/require-market-scope');
const hubQueries = require('../../services/hub-dashboard-queries');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
}

function mockReqRes(user) {
  const req = { user };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return { req, res, next: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDbQuery.mockReset();
});

describe('GAP-4 — market scope role authority', () => {
  test('manager satisfies viewer; viewer never satisfies manager', () => {
    expect(marketScope.hasMarketScopeRole('manager', 'viewer')).toBe(true);
    expect(marketScope.hasMarketScopeRole('manager', 'manager')).toBe(true);
    expect(marketScope.hasMarketScopeRole('viewer', 'manager')).toBe(false);
  });

  test('resolveMarketScopeRole reads only active scope for user + market', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ role: 'manager' }] });
    await expect(marketScope.resolveMarketScopeRole('u1', 'm1')).resolves.toBe('manager');
    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toContain('user_id = $1');
    expect(sql).toContain('market_id = $2');
    expect(sql).toContain('revoked_at IS NULL');
    expect(params).toEqual(['u1', 'm1']);
  });

  test('requireMarketScopeRole(manager) denies a viewer', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ role: 'viewer' }] });
    const { req, res, next } = mockReqRes({ id: 'u1', role: 'market_operator' });
    const mw = marketScope.requireMarketScopeRole('manager')(() => 'm1');
    await mw(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('market_scope_role_insufficient');
    expect(next).not.toHaveBeenCalled();
  });

  test('requireMarketScopeRole(manager) bypasses non market_operator roles', async () => {
    const { req, next } = mockReqRes({ id: 'a1', role: 'admin' });
    const mw = marketScope.requireMarketScopeRole('manager')(() => 'm1');
    await mw(req, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  test('attachAuthorizedMarketsForOperator does not query scopes for admin/agents', async () => {
    const { req, next } = mockReqRes({ id: 'hub1', role: 'agent_hub' });
    await marketScope.attachAuthorizedMarketsForOperator(req, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });
});

describe('GAP-1 — Hub read scoping', () => {
  const KM = new Set(['11111111-1111-4111-8111-111111111111']);
  const KPI_ROW = {
    to_prepare: 1, in_preparation: 0, shipped_today: 0, shipped_total: 0,
    urgent: 0, cash_pending: 0, pending: 0, total_active: 1,
  };

  test('Hub KPI queries are market-scoped and global product stock is not exposed', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [KPI_ROW] })
      .mockResolvedValueOnce({ rows: [{ c: 1 }] })
      .mockResolvedValueOnce({ rows: [{ draft: 0, preparation: 0, shipped: 0, in_transit: 0, at_relay: 0 }] })
      .mockResolvedValueOnce({ rows: [{ open_count: 0, critical_count: 0 }] });

    const result = await hubQueries.getDashboardKPIs({ authorizedMarkets: KM });
    expect(result.stock.low_stock_count).toBe(0);
    expect(mockDbQuery).toHaveBeenCalledTimes(4);
    for (const [sql, params] of mockDbQuery.mock.calls) {
      expect(sql).toContain('market_id');
      expect(params).toEqual([[...KM]]);
    }
    expect(mockDbQuery.mock.calls.some(([sql]) => sql.includes('FROM products'))).toBe(false);
  });

  test('Hub queue applies orders.market_id to count and data queries', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] }).mockResolvedValueOnce({ rows: [] });
    await hubQueries.getQueue({}, { authorizedMarkets: KM });
    const [countSql, countParams] = mockDbQuery.mock.calls[0];
    const [dataSql, dataParams] = mockDbQuery.mock.calls[1];
    expect(countSql).toContain('o.market_id = ANY($1::uuid[])');
    expect(dataSql).toContain('o.market_id = ANY($1::uuid[])');
    expect(countParams).toEqual([[...KM]]);
    expect(dataParams[0]).toEqual([...KM]);
  });

  test('Hub detail rejects an order outside the authorized market before subqueries', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', market_id: '22222222-2222-4222-8222-222222222222' }] });
    const result = await hubQueries.getOrderDetail('o1', { authorizedMarkets: KM });
    expect(result).toEqual({ forbidden: true });
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  test('Hub client_history is also market-scoped', async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{
        id: 'o1', market_id: [...KM][0], user_id: 'u1', created_at: new Date().toISOString(),
        payment_mode: 'cash_relais', payment_status: 'paid', total_kmf: 1000,
      }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total_orders: '1', completed: '0', cancelled: '0', first_order: null }] });

    await hubQueries.getOrderDetail('o1', { authorizedMarkets: KM });
    const [historySql, historyParams] = mockDbQuery.mock.calls[6];
    expect(historySql).toContain('market_id = ANY($2::uuid[])');
    expect(historyParams).toEqual(['u1', [...KM]]);
  });

  test('Hub validation rejects an order outside scope before business checks', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', market_id: '22222222-2222-4222-8222-222222222222' }] });
    const result = await hubQueries.getValidation('o1', { authorizedMarkets: KM });
    expect(result).toEqual({ forbidden: true });
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });
});

describe('route boundary invariants', () => {
  test('Hub terrain exposes GET supervision to market_operator but keeps physical POSTs on hubAuth', () => {
    const source = read('routes/hub.js');
    expect(source).toContain("const hubAuth = [authenticate, requireRole(['admin', 'agent_hub'])]");
    expect(source).toContain("requireRole(['admin', 'agent_hub', 'market_operator'])");
    expect(source).toContain("router.post('/scan', ...hubAuth");
    expect(source).toContain("router.post('/pack', ...hubAuth");
    expect(source).toContain("router.post('/seal', ...hubAuth");
    expect(source).toContain("router.get('/search', ...hubRead");
    expect(source).toContain("router.get('/stats/week', ...hubRead");
    expect(source).toContain("router.get('/pending', ...hubRead");
    expect(source).toContain("router.get('/today', ...hubRead");
  });

  test('Hub dashboard keeps physical mutations out of market_operator', () => {
    const source = read('routes/hub-dashboard.js');
    expect(source).toContain("const hubAuth = [authenticate, requireRole(['admin', 'agent_hub'])]");
    expect(source).toContain("const hubRead      = [authenticate, requireRole(['admin', 'agent_hub', 'market_operator'])");
    expect(source).toContain("const hubSupervise = [authenticate, requireRole(['admin', 'agent_hub', 'market_operator'])");
  });

  test('Relais and Partners consume the central scope-role resolver', () => {
    const relay = read('routes/relay-dashboard.js');
    const partners = read('routes/admin/partners.js');
    expect(relay).toContain('resolveMarketScopeRole');
    expect(relay).toContain("hasMarketScopeRole(actualRole, 'manager')");
    expect(partners).toContain('resolveMarketScopeRole');
    expect(partners).toContain("hasMarketScopeRole(actualRole, 'manager')");
  });
});
