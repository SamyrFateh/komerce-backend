'use strict';

jest.mock('../../services/market-delegation-service', () => ({
  resolveActiveAssignmentByMarketCode: jest.fn(),
  createAssignment: jest.fn(),
  activeMembershipForUser: jest.fn(),
  addMembership: jest.fn(),
  replaceMembershipCapabilities: jest.fn(),
}));
jest.mock('../../services/market-scope-projector', () => ({
  projectAssignment: jest.fn(),
  desiredScopesForAssignment: jest.fn(),
  LEGACY_VIEWER_CAPABILITIES: ['dashboard.read', 'orders.read'],
}));
jest.mock('../../services/market-scope-admin-service', () => ({
  listActiveScopesForUsers: jest.fn(),
}));

const delegation = require('../../services/market-delegation-service');
const projector = require('../../services/market-scope-projector');
const adminService = require('../../services/market-scope-admin-service');
const svc = require('../../services/market-operator-provisioning');

const client = { query: jest.fn() };
const base = { userId: 'u1', marketId: 'm1', marketCode: 'CM', actorUserId: 'admin1' };

beforeEach(() => {
  jest.resetAllMocks();
  delegation.resolveActiveAssignmentByMarketCode.mockResolvedValue({ assignment_id: 'a1' });
  delegation.activeMembershipForUser.mockResolvedValue(null);
  delegation.addMembership.mockResolvedValue({ id: 'mem1' });
  projector.desiredScopesForAssignment.mockResolvedValue([]);
  client.query.mockResolvedValue({ rows: [{ capability: 'pricing.decide' }] });
});

describe('market-operator-provisioning', () => {
  test('scope invalide → erreur sans écriture', async () => {
    await expect(svc.ensureOperatorMembership(client, { ...base, scope: 'admin' }))
      .rejects.toMatchObject({ code: 'INVALID_SCOPE_ROLE' });
    expect(delegation.addMembership).not.toHaveBeenCalled();
  });

  test('pas de membership : crée avec les capabilities du scope puis projette', async () => {
    const out = await svc.ensureOperatorMembership(client, { ...base, scope: 'manager' });
    expect(out).toEqual({ status: 'created', assignmentId: 'a1', membershipId: 'mem1' });
    expect(delegation.addMembership).toHaveBeenCalledWith(client, {
      assignmentId: 'a1', userId: 'u1', capabilities: ['pricing.decide'], actorUserId: 'admin1', actorIsCentral: true,
    });
    expect(projector.projectAssignment).toHaveBeenCalledWith(client, 'a1');
  });

  test('viewer : capabilities = baseline lecture du projecteur', async () => {
    await svc.ensureOperatorMembership(client, { ...base, scope: 'viewer' });
    expect(delegation.addMembership.mock.calls[0][1].capabilities).toEqual(['dashboard.read', 'orders.read']);
  });

  test('assignment absent : le crée ACTIVE', async () => {
    delegation.resolveActiveAssignmentByMarketCode.mockRejectedValue(Object.assign(new Error('x'), { code: 'MARKET_ASSIGNMENT_NOT_ACTIVE' }));
    delegation.createAssignment.mockResolvedValue({ id: 'a9' });
    const out = await svc.ensureOperatorMembership(client, { ...base, scope: 'viewer' });
    expect(delegation.createAssignment).toHaveBeenCalledWith(client, { marketId: 'm1', status: 'ACTIVE' });
    expect(out.assignmentId).toBe('a9');
  });

  test('marché introuvable côté délégation : erreur explicite', async () => {
    delegation.resolveActiveAssignmentByMarketCode.mockRejectedValue(Object.assign(new Error('x'), { code: 'MARKET_NOT_FOUND' }));
    await expect(svc.ensureOperatorMembership(client, { ...base, scope: 'viewer' })).rejects.toThrow(/inactif ou introuvable/);
  });

  test('erreur inattendue de résolution : propagée', async () => {
    delegation.resolveActiveAssignmentByMarketCode.mockRejectedValue(new Error('boom'));
    await expect(svc.ensureOperatorMembership(client, { ...base, scope: 'viewer' })).rejects.toThrow('boom');
  });

  test('membership conforme : unchanged, projection réparée, aucune mutation', async () => {
    delegation.activeMembershipForUser.mockResolvedValue({ id: 'mem1' });
    projector.desiredScopesForAssignment.mockResolvedValue([{ user_id: 'u1', scope_role: 'viewer' }]);
    const out = await svc.ensureOperatorMembership(client, { ...base, scope: 'viewer' });
    expect(out.status).toBe('unchanged');
    expect(delegation.replaceMembershipCapabilities).not.toHaveBeenCalled();
    expect(projector.projectAssignment).toHaveBeenCalled();
  });

  test('rôle différent sans allowRoleChange : échec fermé, aucune écriture', async () => {
    delegation.activeMembershipForUser.mockResolvedValue({ id: 'mem1' });
    projector.desiredScopesForAssignment.mockResolvedValue([{ user_id: 'u1', scope_role: 'viewer' }]);
    await expect(svc.ensureOperatorMembership(client, { ...base, scope: 'manager' }))
      .rejects.toMatchObject({ code: 'MARKET_DELEGATION_SCOPE_MISMATCH' });
    expect(delegation.replaceMembershipCapabilities).not.toHaveBeenCalled();
    expect(projector.projectAssignment).not.toHaveBeenCalled();
  });

  test('rôle personnalisé sans allowRoleChange : échec fermé', async () => {
    delegation.activeMembershipForUser.mockResolvedValue({ id: 'mem1' });
    await expect(svc.ensureOperatorMembership(client, { ...base, scope: 'viewer' }))
      .rejects.toThrow(/personnalisé/);
  });

  test('rôle différent avec allowRoleChange : remplace les capabilities puis projette', async () => {
    delegation.activeMembershipForUser.mockResolvedValue({ id: 'mem1' });
    projector.desiredScopesForAssignment.mockResolvedValue([{ user_id: 'u1', scope_role: 'viewer' }]);
    const out = await svc.ensureOperatorMembership(client, { ...base, scope: 'manager', allowRoleChange: true });
    expect(out.status).toBe('replaced');
    expect(delegation.replaceMembershipCapabilities).toHaveBeenCalledWith(client, {
      membershipId: 'mem1', capabilities: ['pricing.decide'], actorUserId: 'admin1', actorIsCentral: true,
    });
    expect(projector.projectAssignment).toHaveBeenCalledWith(client, 'a1');
  });

  describe('grantOperatorScope (contrat de la route admin)', () => {
    const market = { id: 'm1', code: 'CM' };

    test('scope invalide → invalid_scope_role sans requête', async () => {
      const res = await svc.grantOperatorScope(client, { userId: 'u1', marketCode: 'CM', scopeRole: 'root' });
      expect(res).toEqual({ status: 'invalid_scope_role', scope: null });
      expect(client.query).not.toHaveBeenCalled();
    });

    test('marché inconnu ou inactif → market_not_found', async () => {
      client.query.mockResolvedValueOnce({ rows: [] });
      const res = await svc.grantOperatorScope(client, { userId: 'u1', marketCode: 'zz', scopeRole: 'viewer' });
      expect(res).toEqual({ status: 'market_not_found', scope: null });
      expect(client.query.mock.calls[0][1]).toEqual(['ZZ']);
    });

    test.each([['created', 'granted'], ['replaced', 'replaced'], ['unchanged', 'unchanged']])(
      'issue %s → statut %s et scope projeté renvoyé', async (outcome, status) => {
        client.query.mockResolvedValueOnce({ rows: [market] }).mockResolvedValue({ rows: [{ capability: 'c' }] });
        delegation.activeMembershipForUser.mockResolvedValue(outcome === 'created' ? null : { id: 'mem1' });
        projector.desiredScopesForAssignment.mockResolvedValue([{ user_id: 'u1', scope_role: outcome === 'replaced' ? 'viewer' : 'manager' }]);
        const projected = { id: 's1', market_code: 'CM', scope_role: 'manager' };
        adminService.listActiveScopesForUsers.mockResolvedValue([{ market_code: 'US' }, projected]);
        const res = await svc.grantOperatorScope(client, { userId: 'u1', marketCode: 'cm', scopeRole: 'MANAGER', grantedBy: 'admin1' });
        expect(res).toEqual({ status, scope: projected });
      });

    test('valeurs absentes : normalisées sans exception ni acteur', async () => {
      const res = await svc.grantOperatorScope(client, { userId: 'u1', marketCode: null, scopeRole: null });
      expect(res.status).toBe('invalid_scope_role');
    });

    test('grantedBy absent : acteur null transmis à la délégation', async () => {
      client.query.mockResolvedValueOnce({ rows: [market] }).mockResolvedValue({ rows: [] });
      adminService.listActiveScopesForUsers.mockResolvedValue([]);
      await svc.grantOperatorScope(client, { userId: 'u1', marketCode: 'CM', scopeRole: 'viewer' });
      expect(delegation.addMembership.mock.calls[0][1].actorUserId).toBeNull();
    });

    test('aucune ligne projetée trouvée → scope null', async () => {
      client.query.mockResolvedValueOnce({ rows: [market] }).mockResolvedValue({ rows: [] });
      adminService.listActiveScopesForUsers.mockResolvedValue([]);
      const res = await svc.grantOperatorScope(client, { userId: 'u1', marketCode: 'CM', scopeRole: 'viewer' });
      expect(res).toEqual({ status: 'granted', scope: null });
    });
  });
});
