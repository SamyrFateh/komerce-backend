'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

jest.mock('../../db', () => ({ query: jest.fn() }));

const db = require('../../db');
const roleBridge = require('../../middleware/require-market-delegated-role');
const projector = require('../../services/market-scope-projector');

const ROOT = path.join(__dirname, '..', '..');

describe('market-delegation runtime compatibility bridge', () => {
  beforeEach(() => {
    db.query.mockReset();
  });

  test('un rôle persisté déjà admis passe sans requête de délégation', async () => {
    const req = { user: { id: 'u1', role: 'market_operator' } };
    const next = jest.fn();

    await roleBridge.attachMarketDelegatedRoleFor(['admin', 'market_operator'])(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
    expect(req.user.role).toBe('market_operator');
    expect(req.user.persisted_role).toBeUndefined();
  });

  test('une membership projetée active fournit market_operator uniquement au runtime', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const req = { user: { id: 'u2', role: 'client', email: 'member@example.com' } };
    const next = jest.fn();

    await roleBridge.attachMarketDelegatedRoleFor(['admin', 'market_operator'])(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({
      id: 'u2',
      role: 'market_operator',
      persisted_role: 'client',
      role_source: 'market_delegation_projection',
    });
    expect(req.marketDelegationRole).toMatchObject({
      persisted_role: 'client',
      effective_role: 'market_operator',
    });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('operator_market_scopes');
    expect(sql).toContain('projected_from_membership_id');
    expect(sql).toContain("am.status = 'ACTIVE'");
    expect(sql).toContain("assignment.status = 'ACTIVE'");
    expect(params).toEqual(['u2']);
  });

  test('sans projection active le pré-guard laisse le rôle intact au requireRole aval', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const req = { user: { id: 'u3', role: 'client' } };
    const next = jest.fn();

    await roleBridge.attachMarketDelegatedRoleFor(['admin', 'market_operator'])(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.role).toBe('client');
    expect(req.marketDelegationRole).toBeUndefined();
  });

  test('une surface qui n’admet pas market_operator ne consulte jamais la délégation', async () => {
    const req = { user: { id: 'u4', role: 'client' } };
    const next = jest.fn();

    await roleBridge.attachMarketDelegatedRoleFor(['admin'])(req, {}, next);

    expect(db.query).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.role).toBe('client');
  });

  test('la projection legacy exige tout le socle viewer et manager ne regarde que DELEGATION LIVE', async () => {
    const fakeDb = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await projector.desiredScopesForAssignment(fakeDb, 'assignment-1');

    const [sql, params] = fakeDb.query.mock.calls[0];
    expect(sql).toContain('unnest($2::text[])');
    expect(sql).toContain("registry.status = 'LIVE'");
    expect(sql).toContain("registry.class = 'DELEGATION'");
    expect(sql).toContain("registry.authority_scope = 'MARKET'");
    expect(sql).toContain("registry.delegation_mode = 'DELEGABLE'");
    expect(params[1]).toEqual(projector.LEGACY_VIEWER_CAPABILITIES);
    expect(projector.LEGACY_VIEWER_CAPABILITIES).toEqual([
      'pricing.read',
      'pricing.simulate',
      'dashboard.market.read',
      'operations.read',
      'client.read',
      'network.read',
      'market_config.read',
      'finance.read',
      'catalog.read',
      'partners.read',
    ]);
  });

  test('chaque mutation de membership reprojette operator_market_scopes dans la même transaction', () => {
    const source = fs.readFileSync(path.join(ROOT, 'routes', 'market-delegation-team.js'), 'utf8');
    expect(source).toContain("const { projectAssignment } = require('../services/market-scope-projector')");
    expect(source).toContain('await projectAssignment(client, accepted.membership.assignment_id)');
    const assignmentProjectionCalls = source.match(/await projectAssignment\(client, authz\.assignment_id\)/g) || [];
    expect(assignmentProjectionCalls.length).toBeGreaterThanOrEqual(3);
  });

  test('D3 à D9 sont sorties de require-market-scope ; Pricing ne dépend plus du bridge de rôle pour autoriser', () => {
    const pricing = fs.readFileSync(path.join(ROOT, 'routes', 'admin-pricing-workspace.js'), 'utf8');
    expect(pricing).not.toContain('require-market-scope');
    expect(pricing).not.toContain('requireMarketScope');
    expect(pricing).not.toContain('resolveMarketScopeRole');
    expect(pricing).not.toContain('attachMarketDelegatedRoleFor');
    expect(pricing).toContain("requirePricingReadCapability('pricing.read'");
    expect(pricing).toContain("requirePricingCapability('pricing.policy.set'");
    expect(pricing).toContain("requireLocalStrategyCapability('pricing.decide'");

    const partners = fs.readFileSync(path.join(ROOT, 'routes', 'admin', 'partners.js'), 'utf8');
    expect(partners).not.toContain('require-market-scope');
    expect(partners).toContain("attachAuthorizedMarketsForCapability('partners.read'");
    expect(partners).toContain("attachAuthorizedMarketsForCapability('partners.manage'");

    const operations = fs.readFileSync(path.join(ROOT, 'routes', 'admin-operations-workspace.js'), 'utf8');
    expect(operations).not.toContain('attachMarketDelegatedRoleFor');
    expect(operations).not.toContain('require-market-scope');
    expect(operations).toContain("requireMarketDelegatedCapability('operations.read'");
    expect(operations).toContain('attachMarketExecutionRoleFor');
    expect(operations).toContain('forceCapability: true');

    for (const file of ['routes/hub.js', 'routes/hub-dashboard.js']) {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
      expect(source).not.toContain('require-market-scope');
      expect(source).toContain('operations.read');
    }

    const relay = fs.readFileSync(path.join(ROOT, 'routes', 'relay-dashboard.js'), 'utf8');
    expect(relay).not.toContain('require-market-scope');
    expect(relay).toContain("attachAuthorizedMarketsForCapability('operations.read'");
    expect(relay).toContain("requireMarketDelegatedCapability('hub.supervise'");

    const dashboardMarket = fs.readFileSync(path.join(ROOT, 'routes', 'admin-dashboard-market.js'), 'utf8');
    expect(dashboardMarket).not.toContain('require-market-scope');
    expect(dashboardMarket).toContain("requireDashboardMarketCapability('dashboard.market.read'");
    expect(dashboardMarket).toContain("requireDashboardMarketCapability('operations.read'");
    expect(dashboardMarket).toContain("requireDashboardMarketCapability('finance.read'");

    const entity360 = {
      'routes/admin-client-index.js': 'client.read',
      'routes/admin-client-360.js': 'client.read',
      'routes/admin-product-360.js': 'catalog.read',
      'routes/admin-order-360.js': 'operations.read',
    };
    for (const [file, capability] of Object.entries(entity360)) {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
      expect(source).not.toContain('require-market-scope');
      expect(source).toContain(capability);
    }
  });
});
