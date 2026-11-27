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
const mockPreparation = jest.fn();
jest.mock('../../services/market-control-plane', () => ({ getPreparationChecklist: (...args) => mockPreparation(...args) }));
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
  jest.resetAllMocks();
  mockQuery.mockImplementation(async (sql) => {
    if (String(sql).includes('SELECT code, currency FROM markets')) return { rows: [] };
    throw new Error('unexpected query: ' + sql);
  });
  mockResolveAuthorization.mockResolvedValue({ capabilities: [] });
  mockListAuthorizedMarkets.mockResolvedValue([]);
});

describe('dashboard-admin-context', () => {
  test('A1 : admin global sans grant explicite + tous les marchés actifs', async () => {
    mockHasGlobal.mockResolvedValue(false);
    mockQuery.mockResolvedValueOnce({ rows: [{ code: 'CG' }, { code: 'CM' }, { code: 'KM' }] });

    const context = await resolveDashboardAdminContext({ id: 'hq-1', role: 'admin' });

    expect(mockHasGlobal).not.toHaveBeenCalled();
    expect(context).toEqual({
      actor: { id: 'hq-1', role: 'admin' },
      access: {
        mode: 'global',
        allowedMarkets: ['CG', 'CM', 'KM'],
        marketCurrencies: { CG: null, CM: null, KM: null },
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

    const context = await resolveDashboardAdminContext({ id: 'operator-1', role: 'market_operator' });

    expect(context.access).toEqual({
      mode: 'market',
      allowedMarkets: ['CM', 'CG'],
      marketCurrencies: { CM: null, CG: null },
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

  test('opérateur sans grant ni délégation est refusé — zéro scope ne signifie jamais central', async () => {
    mockHasGlobal.mockResolvedValue(false);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(resolveDashboardAdminContext({ id: 'operator-empty', role: 'market_operator' }))
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

  test('Transitaire central: tous les marchés ACTIFS, sans membership ni delegation', async () => {
    mockHasGlobal.mockResolvedValue(false);
    mockQuery.mockResolvedValueOnce({ rows: [{ code: 'CG' }, { code: 'KM' }] });

    const ctx = await resolveDashboardAdminContext({ id: 'transit-1', role: 'agent_transitaire' });
    expect(ctx.actor.role).toBe('agent_transitaire');
    expect(ctx.access.mode).toBe('market');
    expect(ctx.access.allowedMarkets).toEqual(['CG', 'KM']);
    expect(ctx.access.capabilities).not.toContain('dashboard.global.read');
    expect(ctx.access.delegatedCapabilities).toEqual({});
    expect(mockListAuthorizedMarkets).not.toHaveBeenCalled();
    expect(mockResolveAuthorization).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls[0][0]).toContain('is_active = TRUE');
  });

  test('Transitaire: aucun marche actif -> refuse', async () => {
    mockHasGlobal.mockResolvedValue(false);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(resolveDashboardAdminContext({ id: 'transit-2', role: 'agent_transitaire' }))
      .rejects.toMatchObject({ code: 'dashboard_access_denied' });
  });

  test('Role non central sans membership (finance) reste refuse', async () => {
    mockHasGlobal.mockResolvedValue(false);
    mockListAuthorizedMarkets.mockResolvedValueOnce([]);
    await expect(resolveDashboardAdminContext({ id: 'finance-no-grant', role: 'finance' }))
      .rejects.toMatchObject({ code: 'dashboard_access_denied' });
  });

  test('Hub central: tous les marchés actifs sans appartenance à une équipe marché', async () => {
    mockHasGlobal.mockResolvedValue(false);
    mockQuery.mockResolvedValueOnce({ rows: [{ code: 'CG' }, { code: 'CM' }, { code: 'KM' }] });

    const ctx = await resolveDashboardAdminContext({ id: 'hub-1', role: 'agent_hub' });
    expect(ctx.actor.role).toBe('agent_hub');
    expect(ctx.access).toEqual({
      mode: 'hub',
      allowedMarkets: ['CG', 'CM', 'KM'],
      marketCurrencies: { CG: null, CM: null, KM: null },
      defaultMarket: 'CG',
      capabilities: [],
      delegatedCapabilities: {},
    });
    expect(mockListAuthorizedMarkets).not.toHaveBeenCalled();
    expect(mockResolveAuthorization).not.toHaveBeenCalled();
    expect(mockHasGlobal).not.toHaveBeenCalled();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('WHERE is_active = TRUE');
    expect(sql).not.toContain('operator_market_scopes');
    expect(params).toBeUndefined();
  });

  test('Hub central: le rôle ne fabrique aucun droit Admin, même avec un ancien grant global', async () => {
    mockHasGlobal.mockResolvedValue(true);
    mockQuery.mockResolvedValueOnce({ rows: [{ code: 'KM' }] });
    const ctx = await resolveDashboardAdminContext({ id: 'hub-1', role: 'agent_hub' });
    expect(ctx.access.mode).toBe('hub');
    expect(ctx.access.capabilities).not.toContain('dashboard.global.read');
    expect(ctx.access.delegatedCapabilities).toEqual({});
    expect(mockHasGlobal).not.toHaveBeenCalled();
  });

  test('Hub sans marché opérationnel actif : pas de périmètre inventé', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(resolveDashboardAdminContext({ id: 'hub-1', role: 'agent_hub' }))
      .rejects.toMatchObject({ code: 'dashboard_access_denied' });
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

    const context = await resolveDashboardAdminContext({ id: 'operator-1', role: 'market_operator' });
    const serialized = JSON.stringify(context);

    expect(serialized).not.toContain('market_id');
    expect(serialized).not.toContain('operator_market_scopes');
    expect(context.access.allowedMarkets).toEqual(['CM']);
    expect(context.access.delegatedCapabilities).toEqual({ CM: [] });
  });
});

test('granular network delegate without legacy scope receives only its existing market',async()=>{
  mockHasGlobal.mockResolvedValue(false);
  mockQuery.mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{code:'ZZ'}]});
  mockListAuthorizedMarkets.mockImplementation(async(_db,{requiredCapability})=>requiredCapability==='network.read'?[{market_code:'ZZ'}]:[]);
  mockResolveAuthorization.mockResolvedValue({capabilities:['network.read']});
  const ctx=await resolveDashboardAdminContext({id:'network-only',role:'market_operator'});
  expect(ctx.access).toMatchObject({mode:'market',allowedMarkets:['ZZ'],defaultMarket:'ZZ',delegatedCapabilities:{ZZ:['network.read']}});
  expect(ctx.access.capabilities).not.toContain('dashboard.global.read');
  expect(mockQuery.mock.calls[1][1]).toEqual([['ZZ']]);
});

test('devises de présentation limitées au scope réel et sans fallback KMF', async () => {
  mockHasGlobal.mockResolvedValue(false);
  mockQuery.mockResolvedValueOnce({rows:[{code:'CM'},{code:'ZZ'},{code:'CG'}]})
    .mockResolvedValueOnce({rows:[{code:'CM',currency:'XAF'},{code:'ZZ',currency:'JPY'},{code:'KM',currency:'KMF'}]});
  const ctx=await resolveDashboardAdminContext({id:'operator',role:'market_operator'});
  expect(ctx.access.marketCurrencies).toEqual({CM:'XAF',ZZ:'JPY',CG:null});
  expect(Object.isFrozen(ctx.access.marketCurrencies)).toBe(true);
  expect(mockQuery.mock.calls[1][0]).toContain('is_active = TRUE AND code = ANY($1::text[])');
  expect(mockQuery.mock.calls[1][1]).toEqual([['CM','ZZ','CG']]);
  expect(ctx.access.marketCurrencies.KM).toBeUndefined();
});

test('un responsable PROVISIONING reçoit uniquement la projection de préparation de son marché',async()=>{
  mockHasGlobal.mockResolvedValue(false);
  mockQuery.mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{code:'GA'}]}).mockResolvedValueOnce({rows:[{code:'GA',currency:'XAF'}]});
  mockListAuthorizedMarkets.mockImplementation(async(_db,{requiredCapability})=>requiredCapability==='team.read'?[{market_code:'GA'}]:[]);
  const authz = {market_code:'GA',lifecycle_status:'PROVISIONING',capabilities:['team.read','network.read']};
  mockResolveAuthorization.mockResolvedValue(authz);
  const checklist = {items:[{id:'network',label:'Réseau',owner:'market',status:'blocked',blockers:['Aucun relais']}]};
  mockPreparation.mockResolvedValue(checklist);
  const result = await resolveDashboardAdminContext({id:'lead',role:'market_operator'});
  expect(result.access.preparation).toEqual({GA:checklist});
  expect(result.access.marketCurrencies).toEqual({GA:'XAF'});
  expect(mockQuery.mock.calls[2][1]).toEqual([['GA'],['GA']]);
  expect(mockPreparation).toHaveBeenCalledWith(expect.anything(),authz);
  expect(result.access.delegatedCapabilities).toEqual({GA:['team.read','network.read']});
});
