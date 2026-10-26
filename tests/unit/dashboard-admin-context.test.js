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

// LOT A (A1) : resolveDashboardAdminContext appelle désormais
// resolveAuthorization pour projeter delegatedCapabilities en mode market.
// On le mocke ici — la couverture de resolveAuthorization lui-même vit dans
// tests/unit/market-delegation-service*.test.js, pas ici.
const mockResolveAuthorization = jest.fn();
const mockListAuthorizedMarkets = jest.fn();
jest.mock('../../services/market-delegation-service', () => ({
  resolveAuthorization: (...args) => mockResolveAuthorization(...args),
  listAuthorizedMarketsForCapability: (...args) => mockListAuthorizedMarkets(...args),
}));

const {
  resolveDashboardAdminContext,
  DashboardAccessDeniedError,
} = require('../../services/dashboard-admin-context');

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveAuthorization.mockResolvedValue({ capabilities: [] });
  mockListAuthorizedMarkets.mockResolvedValue([]);
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
        capabilities: ['pilotage.read', 'dashboard.global.read'],
        delegatedCapabilities: {},
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
      capabilities: ['pilotage.read'],
      delegatedCapabilities: { CM: [], CG: [] },
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

  test('Finance: contexte KM depuis finance.read actif, jamais depuis operator_market_scopes', async () => {
    mockHasGlobal.mockResolvedValue(false);
    mockListAuthorizedMarkets.mockResolvedValue([{ market_code: 'KM' }]);
    mockQuery.mockResolvedValueOnce({ rows: [{ code: 'KM' }] });

    const context = await resolveDashboardAdminContext({ id: 'finance-1', role: 'finance' });
    expect(context.actor.role).toBe('finance');
    expect(context.access.mode).toBe('market');
    expect(context.access.allowedMarkets).toEqual(['KM']);
    expect(context.access.capabilities).not.toContain('dashboard.global.read');
    expect(mockListAuthorizedMarkets).toHaveBeenCalledWith(
      expect.anything(), { userId: 'finance-1', requiredCapability: 'finance.read' }
    );
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('operator_market_scopes');
    expect(sql).toContain('is_active = TRUE');
    expect(params).toEqual([['KM']]);
  });

  test('Transitaire: logistics.read actif est requis, un rôle seul ne suffit pas', async () => {
    mockHasGlobal.mockResolvedValue(false);
    mockListAuthorizedMarkets.mockResolvedValueOnce([{ market_code: 'KM' }]);
    mockQuery.mockResolvedValueOnce({ rows: [{ code: 'KM' }] });

    const ctx = await resolveDashboardAdminContext({ id: 'transit-1', role: 'agent_transitaire' });
    expect(ctx.access.allowedMarkets).toEqual(['KM']);
    expect(mockListAuthorizedMarkets).toHaveBeenCalledWith(
      expect.anything(), { userId: 'transit-1', requiredCapability: 'logistics.read' }
    );
    expect(ctx.access.delegatedCapabilities.KM).toEqual([]);

    mockListAuthorizedMarkets.mockResolvedValueOnce([]);
    await expect(resolveDashboardAdminContext({ id: 'transit-no-grant', role: 'agent_transitaire' }))
      .rejects.toMatchObject({ code: 'dashboard_access_denied' });
  });

  test('Hub: union des marchés où une lecture operations/logistics est réellement accordée', async () => {
    mockHasGlobal.mockResolvedValue(false);
    mockListAuthorizedMarkets
      .mockResolvedValueOnce([{ market_code: 'CM' }])
      .mockResolvedValueOnce([{ market_code: 'KM' }, { market_code: 'CM' }]);
    mockQuery.mockResolvedValueOnce({ rows: [{ code: 'CM' }, { code: 'KM' }] });

    const ctx = await resolveDashboardAdminContext({ id: 'hub-1', role: 'agent_hub' });
    expect(ctx.access.allowedMarkets).toEqual(['CM', 'KM']);
    expect(mockListAuthorizedMarkets).toHaveBeenCalledTimes(2);
    expect(mockListAuthorizedMarkets.mock.calls.map(([, args]) => args.requiredCapability))
      .toEqual(['operations.read', 'logistics.read']);
    expect(mockQuery.mock.calls[0][1]).toEqual([['CM', 'KM']]);
  });

  test('Relais: seul le rattachement physique actif détermine son marché', async () => {
    mockHasGlobal.mockResolvedValue(false);
    mockQuery.mockResolvedValueOnce({ rows: [{ code: 'KM' }] });

    const ctx = await resolveDashboardAdminContext({ id: 'relay-1', role: 'agent_relais' });
    expect(ctx.access.allowedMarkets).toEqual(['KM']);
    expect(mockQuery.mock.calls[0][0]).toContain('u.relais_id');
    expect(mockQuery.mock.calls[0][0]).toContain('r.is_active = TRUE');
    expect(mockQuery.mock.calls[0][1]).toEqual(['relay-1']);
    expect(mockListAuthorizedMarkets).not.toHaveBeenCalled();
  });

  test('aucune capability effective ne crée artificiellement de marché', async () => {
    mockHasGlobal.mockResolvedValue(false);
    mockListAuthorizedMarkets.mockResolvedValue([]);

    await expect(resolveDashboardAdminContext({ id: 'finance-empty', role: 'finance' }))
      .rejects.toBeInstanceOf(DashboardAccessDeniedError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('ne renvoie aucun UUID de scope au client', async () => {
    mockHasGlobal.mockResolvedValue(false);
    mockQuery.mockResolvedValueOnce({ rows: [{ code: 'CM' }] });

    const context = await resolveDashboardAdminContext({ id: 'operator-1', role: 'admin' });
    const serialized = JSON.stringify(context);

    expect(serialized).not.toContain('market_id');
    expect(serialized).not.toContain('operator_market_scopes');
    expect(context.access.allowedMarkets).toEqual(['CM']);
    expect(context.access.delegatedCapabilities).toEqual({ CM: [] });
  });
});
