'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const service = require('../../services/market-scope-admin-service');

function executor() {
  return { query: jest.fn() };
}

describe('market-scope-admin-service', () => {
  test('normalise uniquement les codes ISO et viewer/manager', () => {
    expect(service.normalizeMarketCode(' cm ')).toBe('CM');
    expect(service.normalizeMarketCode('Cameroun')).toBeNull();
    expect(service.normalizeScopeRole(' Manager ')).toBe('manager');
    expect(service.normalizeScopeRole('admin')).toBeNull();
  });

  test('liste les marchés actifs', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [{ id: 'm1', code: 'CM', name: 'Cameroun' }] });
    const rows = await service.listActiveMarkets(db);
    expect(rows[0].code).toBe('CM');
    expect(db.query.mock.calls[0][0]).toMatch(/WHERE is_active = true/);
  });

  test('projection adopte une ligne legacy de même rôle sans recréer son historique', async () => {
    const db = executor();
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'legacy', role: 'manager', granted_at: 't1', granted_by: 'admin1', projected_from_membership_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'legacy', user_id: 'u1', market_id: 'm1', scope_role: 'manager', granted_at: 't1', granted_by: 'admin1', projected_from_membership_id: 'mem1' }] });

    const result = await service.upsertProjectedMarketScope(db, {
      userId: 'u1', marketId: 'm1', scopeRole: 'manager', membershipId: 'mem1',
    });

    expect(result.status).toBe('adopted_legacy');
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[1][0]).toMatch(/SET projected_from_membership_id/);
    expect(db.query.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/INSERT INTO operator_market_scopes/);
  });

  test('projection changeant de rôle révoque puis recrée la projection', async () => {
    const db = executor();
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'old', role: 'viewer', granted_at: 't1', granted_by: null, projected_from_membership_id: 'mem1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'old' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'new', user_id: 'u1', market_id: 'm1', scope_role: 'manager', projected_from_membership_id: 'mem1' }] });

    const result = await service.upsertProjectedMarketScope(db, {
      userId: 'u1', marketId: 'm1', scopeRole: 'manager', membershipId: 'mem1',
    });

    expect(result.status).toBe('replaced_projection');
    expect(db.query.mock.calls[1][0]).toMatch(/SET revoked_at = NOW\(\)/);
    expect(db.query.mock.calls[2][0]).toMatch(/INSERT INTO operator_market_scopes/);
  });

  test('révocation de projection ne touche que les memberships explicitement projetées', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [{ id: 's1', projected_from_membership_id: 'mem1' }] });
    const rows = await service.revokeProjectedMarketScopes(db, {
      membershipIds: ['mem1', 'mem2'], exceptMembershipIds: ['mem2'],
    });
    expect(rows).toHaveLength(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/projected_from_membership_id = ANY/);
    expect(params).toEqual([['mem1', 'mem2'], ['mem2']]);
  });

  test('révocation est un UPDATE revoked_at, jamais un DELETE', async () => {
    const db = executor();
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'm1', code: 'CM', name: 'Cameroun', currency: 'XAF', minor_unit: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'g1', user_id: 'u1', market_id: 'm1', scope_role: 'manager', revoked_at: 't2' }] });

    const result = await service.revokeMarketScope(db, {
      userId: 'u1', marketCode: 'CM', revokedBy: 'admin1',
    });

    expect(result.status).toBe('revoked');
    const sql = db.query.mock.calls[1][0];
    expect(sql).toMatch(/UPDATE operator_market_scopes/);
    expect(sql).toMatch(/revoked_at = NOW\(\)/);
    expect(sql).not.toMatch(/DELETE FROM operator_market_scopes/);
  });
});
