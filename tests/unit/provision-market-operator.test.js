'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({
  getClient: jest.fn(),
  query: jest.fn(),
  end: jest.fn(),
}));

jest.mock('../../services/market-delegation-service', () => ({
  resolveActiveAssignmentByMarketCode: jest.fn(),
  createAssignment: jest.fn(),
  activeMembershipForUser: jest.fn(),
  addMembership: jest.fn(),
}));

jest.mock('../../services/market-scope-projector', () => ({
  projectAssignment: jest.fn(),
  desiredScopesForAssignment: jest.fn(),
  LEGACY_VIEWER_CAPABILITIES: [
    'pricing.read',
    'pricing.simulate',
    'dashboard.market.read',
    'operations.read',
    'client.read',
    'network.read',
    'market_config.read',
    'finance.read',
    'catalog.read',
  ],
}));

const db = require('../../db');
const delegation = require('../../services/market-delegation-service');
const projector = require('../../services/market-scope-projector');
const {
  ensureDelegationMembership,
  resolveOrCreateAssignment,
} = require('../../scripts/provision-market-operator');

function fakeClient() {
  return { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
}

describe('provision-market-operator — ne touche jamais operator_market_scopes', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'provision-market-operator.js'), 'utf8');

  test('aucune requête SQL directe sur operator_market_scopes (INSERT/UPDATE/DELETE/SELECT...FROM)', () => {
    // Le nom de la table apparaît légitimement dans le JSDoc @doctrine et
    // dans les messages humains (dry-run, erreurs) qui expliquent la
    // projection à l'opérateur — l'interdiction porte sur l'écriture/lecture
    // SQL directe, pas sur la mention du nom de table en prose.
    const sqlPattern = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|SELECT[\s\S]{0,200}?FROM)\s+operator_market_scopes/i;
    expect(source).not.toMatch(sqlPattern);
  });
});

describe('provision-market-operator — resolveOrCreateAssignment', () => {
  beforeEach(() => jest.clearAllMocks());

  test('assignment déjà ACTIVE : réutilisé, pas de création', async () => {
    const client = fakeClient();
    delegation.resolveActiveAssignmentByMarketCode.mockResolvedValue({ assignment_id: 'a1' });

    const assignmentId = await resolveOrCreateAssignment(client, { marketId: 'm1', marketCode: 'CM' });

    expect(assignmentId).toBe('a1');
    expect(delegation.createAssignment).not.toHaveBeenCalled();
  });

  test('aucun assignment ACTIVE : en crée un nouveau', async () => {
    const client = fakeClient();
    const err = new Error('none active');
    err.code = 'MARKET_ASSIGNMENT_NOT_ACTIVE';
    delegation.resolveActiveAssignmentByMarketCode.mockRejectedValue(err);
    delegation.createAssignment.mockResolvedValue({ id: 'a2' });

    const assignmentId = await resolveOrCreateAssignment(client, { marketId: 'm1', marketCode: 'CM' });

    expect(assignmentId).toBe('a2');
    expect(delegation.createAssignment).toHaveBeenCalledWith(client, { marketId: 'm1', status: 'ACTIVE' });
  });

  test('marché introuvable/inactif : erreur explicite, pas de création', async () => {
    const client = fakeClient();
    const err = new Error('nope');
    err.code = 'MARKET_NOT_FOUND';
    delegation.resolveActiveAssignmentByMarketCode.mockRejectedValue(err);

    await expect(resolveOrCreateAssignment(client, { marketId: 'm1', marketCode: 'CM' })).rejects.toThrow(/inactif ou introuvable/);
    expect(delegation.createAssignment).not.toHaveBeenCalled();
  });
});

describe('provision-market-operator — ensureDelegationMembership', () => {
  beforeEach(() => jest.clearAllMocks());

  test('pas de membership existante (viewer) : crée avec le baseline canonique, puis projette', async () => {
    const client = fakeClient();
    db.getClient.mockResolvedValue(client);
    delegation.resolveActiveAssignmentByMarketCode.mockResolvedValue({ assignment_id: 'a1' });
    delegation.activeMembershipForUser.mockResolvedValue(null);
    delegation.addMembership.mockResolvedValue({ id: 'mem1' });
    projector.projectAssignment.mockResolvedValue([]);

    const result = await ensureDelegationMembership({ userId: 'u1', marketId: 'm1', marketCode: 'CM', scope: 'viewer', dryRun: false });

    expect(delegation.addMembership).toHaveBeenCalledWith(client, {
      assignmentId: 'a1',
      userId: 'u1',
      capabilities: projector.LEGACY_VIEWER_CAPABILITIES,
      actorIsCentral: true,
    });
    expect(projector.projectAssignment).toHaveBeenCalledWith(client, 'a1');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(result).toEqual({ status: 'created' });
  });

  test('pas de membership existante (manager) : capabilities = ceiling LIVE de l\'assignment', async () => {
    const client = fakeClient();
    client.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('assignment_capability_ceiling')) {
        return { rows: [{ capability: 'pricing.decide' }, { capability: 'catalog.read' }] };
      }
      return { rows: [] };
    });
    db.getClient.mockResolvedValue(client);
    delegation.resolveActiveAssignmentByMarketCode.mockResolvedValue({ assignment_id: 'a1' });
    delegation.activeMembershipForUser.mockResolvedValue(null);
    delegation.addMembership.mockResolvedValue({ id: 'mem1' });
    projector.projectAssignment.mockResolvedValue([]);

    await ensureDelegationMembership({ userId: 'u1', marketId: 'm1', marketCode: 'CM', scope: 'manager', dryRun: false });

    expect(delegation.addMembership).toHaveBeenCalledWith(client, {
      assignmentId: 'a1',
      userId: 'u1',
      capabilities: ['pricing.decide', 'catalog.read'],
      actorIsCentral: true,
    });
  });

  test('membership existante, rôle dérivé == scope demandé : idempotent — aucun grant, projection reconstruite', async () => {
    const client = fakeClient();
    db.getClient.mockResolvedValue(client);
    delegation.resolveActiveAssignmentByMarketCode.mockResolvedValue({ assignment_id: 'a1' });
    delegation.activeMembershipForUser.mockResolvedValue({ id: 'mem1' });
    projector.desiredScopesForAssignment.mockResolvedValue([{ user_id: 'u1', scope_role: 'viewer' }]);
    projector.projectAssignment.mockResolvedValue([]);

    const result = await ensureDelegationMembership({ userId: 'u1', marketId: 'm1', marketCode: 'CM', scope: 'viewer', dryRun: false });

    expect(delegation.addMembership).not.toHaveBeenCalled();
    expect(projector.projectAssignment).toHaveBeenCalledWith(client, 'a1');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(result).toEqual({ status: 'unchanged' });
  });

  test('relance identique (idempotence) : deux appels de suite, jamais de second grant', async () => {
    const client = fakeClient();
    db.getClient.mockResolvedValue(client);
    delegation.resolveActiveAssignmentByMarketCode.mockResolvedValue({ assignment_id: 'a1' });
    delegation.activeMembershipForUser.mockResolvedValue({ id: 'mem1' });
    projector.desiredScopesForAssignment.mockResolvedValue([{ user_id: 'u1', scope_role: 'manager' }]);
    projector.projectAssignment.mockResolvedValue([]);

    await ensureDelegationMembership({ userId: 'u1', marketId: 'm1', marketCode: 'CM', scope: 'manager', dryRun: false });
    await ensureDelegationMembership({ userId: 'u1', marketId: 'm1', marketCode: 'CM', scope: 'manager', dryRun: false });

    expect(delegation.addMembership).not.toHaveBeenCalled();
    expect(projector.projectAssignment).toHaveBeenCalledTimes(2);
  });

  test('membership existante, rôle dérivé != scope demandé : fail closed — rollback, aucune écriture, pas de grant additif', async () => {
    const client = fakeClient();
    db.getClient.mockResolvedValue(client);
    delegation.resolveActiveAssignmentByMarketCode.mockResolvedValue({ assignment_id: 'a1' });
    delegation.activeMembershipForUser.mockResolvedValue({ id: 'mem1' });
    projector.desiredScopesForAssignment.mockResolvedValue([{ user_id: 'u1', scope_role: 'viewer' }]);

    await expect(
      ensureDelegationMembership({ userId: 'u1', marketId: 'm1', marketCode: 'CM', scope: 'manager', dryRun: false })
    ).rejects.toMatchObject({ code: 'MARKET_DELEGATION_SCOPE_MISMATCH' });

    expect(delegation.addMembership).not.toHaveBeenCalled();
    expect(projector.projectAssignment).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
  });

  test('membership existante avec capabilities personnalisées (rôle indéterminé) : fail closed aussi', async () => {
    const client = fakeClient();
    db.getClient.mockResolvedValue(client);
    delegation.resolveActiveAssignmentByMarketCode.mockResolvedValue({ assignment_id: 'a1' });
    delegation.activeMembershipForUser.mockResolvedValue({ id: 'mem1' });
    projector.desiredScopesForAssignment.mockResolvedValue([]); // aucune ligne = rôle indéterminé

    await expect(
      ensureDelegationMembership({ userId: 'u1', marketId: 'm1', marketCode: 'CM', scope: 'viewer', dryRun: false })
    ).rejects.toMatchObject({ code: 'MARKET_DELEGATION_SCOPE_MISMATCH' });

    expect(delegation.addMembership).not.toHaveBeenCalled();
  });

  test('dry-run : aucune écriture, db.getClient jamais appelé', async () => {
    delegation.resolveActiveAssignmentByMarketCode.mockResolvedValue({ assignment_id: 'a1' });
    delegation.activeMembershipForUser.mockResolvedValue(null);

    await ensureDelegationMembership({ userId: 'u1', marketId: 'm1', marketCode: 'CM', scope: 'viewer', dryRun: true });

    expect(db.getClient).not.toHaveBeenCalled();
    expect(delegation.addMembership).not.toHaveBeenCalled();
  });
});
