'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockHasGlobal = jest.fn();
jest.mock('../../middleware/require-dashboard-global-authority', () => ({
  hasDashboardGlobalAuthority: (...args) => mockHasGlobal(...args),
}));

const {
  resolveDashboardAdminContext,
  DashboardAccessDeniedError,
} = require('../../services/dashboard-admin-context');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('dashboard-admin-context', () => {
  test('global = grant explicite + tous les marchés actifs, jamais le rôle seul', async () => {
    mockHasGlobal.mockResolvedValue(true);
    mockQuery.mockResolvedValueOnce({ rows: [{ code: 'CG' }, { code: 'CM' }, { code: 'KM' }] });

    const context = await resolveDashboardAdminContext({ id: 'hq-1', role: 'admin' });

    expect(mockHasGlobal).toHaveBeenCalledWith('hq-1');
    expect(context).toEqual({
      actor: { id: 'hq-1', role: 'admin' },
      access: {
        mode: 'global',
        allowedMarkets: ['CG', 'CM', 'KM'],
        defaultMarket: null,
        capabilities: ['pilotage.read', 'dashboard.market.read', 'dashboard.global.read'],
      },
    });
    expect(String(mockQuery.mock.calls[0][0])).toContain('WHERE is_active = TRUE');
    expect(String(mockQuery.mock.calls[0][0])).not.toContain('operator_market_scopes');
  });

  test('market = uniquement les grants actifs du user, dans un ordre serveur stable', async () => {
    mockHasGlobal.mockResolvedValue(false);
    mockQuery.mockResolvedValueOnce({ rows: [{ code: 'CM' }, { code: 'CG' }] });

    const context = await resolveDashboardAdminContext({ id: 'operator-1', role: 'admin' });

    expect(context.access).toEqual({
      mode: 'market',
      allowedMarkets: ['CM', 'CG'],
      defaultMarket: 'CM',
      capabilities: ['pilotage.read', 'dashboard.market.read'],
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('operator_market_scopes');
    expect(sql).toContain('oms.revoked_at IS NULL');
    expect(sql).toContain('m.is_active = TRUE');
    expect(params).toEqual(['operator-1']);
  });

  test('admin sans global et sans market grant est refusé — zéro scope ne signifie jamais central', async () => {
    mockHasGlobal.mockResolvedValue(false);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(resolveDashboardAdminContext({ id: 'admin-empty', role: 'admin' }))
      .rejects.toBeInstanceOf(DashboardAccessDeniedError);
  });

  test('ne renvoie aucun UUID de scope au client', async () => {
    mockHasGlobal.mockResolvedValue(false);
    mockQuery.mockResolvedValueOnce({ rows: [{ code: 'CM' }] });

    const context = await resolveDashboardAdminContext({ id: 'operator-1', role: 'admin' });
    const serialized = JSON.stringify(context);

    expect(serialized).not.toContain('market_id');
    expect(serialized).not.toContain('operator_market_scopes');
    expect(context.access.allowedMarkets).toEqual(['CM']);
  });
});
