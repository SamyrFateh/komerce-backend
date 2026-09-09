'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');

jest.mock('../../db', () => ({ query: jest.fn() }));

const db = require('../../db');
const auth = require('../../middleware/auth');
const projector = require('../../services/market-scope-projector');

const ROOT = path.join(__dirname, '..', '..');

function responseDouble() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('market-delegation runtime compatibility bridge', () => {
  beforeEach(() => {
    db.query.mockReset();
  });

  test('un rôle persisté déjà autorisé passe sans requête de délégation', async () => {
    const req = { user: { id: 'u1', role: 'market_operator' } };
    const res = responseDouble();
    const next = jest.fn();

    await auth.requireRole(['admin', 'market_operator'])(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
    expect(req.user.role).toBe('market_operator');
    expect(req.user.persisted_role).toBeUndefined();
  });

  test('une membership projetée active fournit market_operator uniquement au runtime', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const req = { user: { id: 'u2', role: 'client', email: 'member@example.com' } };
    const res = responseDouble();
    const next = jest.fn();

    await auth.requireRole(['admin', 'market_operator'])(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
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

  test('une identité sans projection active reste refusée', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const req = { user: { id: 'u3', role: 'client' } };
    const res = responseDouble();
    const next = jest.fn();

    await auth.requireRole(['admin', 'market_operator'])(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(req.user.role).toBe('client');
  });

  test('une route sans market_operator ne consulte jamais la délégation', async () => {
    const req = { user: { id: 'u4', role: 'client' } };
    const res = responseDouble();
    const next = jest.fn();

    await auth.requireRole(['admin'])(req, res, next);

    expect(db.query).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
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
    ]);
  });

  test('chaque mutation de membership reprojette operator_market_scopes dans la même transaction', () => {
    const source = fs.readFileSync(path.join(ROOT, 'routes', 'market-delegation-team.js'), 'utf8');
    expect(source).toContain("const { projectAssignment } = require('../services/market-scope-projector')");
    expect(source).toContain('await projectAssignment(client, accepted.membership.assignment_id)');
    const assignmentProjectionCalls = source.match(/await projectAssignment\(client, authz\.assignment_id\)/g) || [];
    expect(assignmentProjectionCalls.length).toBeGreaterThanOrEqual(3);
  });
});
