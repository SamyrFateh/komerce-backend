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



  test('executor requis et normalisations null échouent fermées', async () => {
    await expect(service.listActiveMarkets(null)).rejects.toThrow(/executor\.query requis/);
    expect(service.normalizeMarketCode(null)).toBeNull();
    expect(service.normalizeScopeRole(null)).toBeNull();
  });

  test('liste des scopes actifs : vide sans requête, sinon filtre les user ids', async () => {
    const db = executor();
    await expect(service.listActiveScopesForUsers(db, null)).resolves.toEqual([]);
    await expect(service.listActiveScopesForUsers(db, [])).resolves.toEqual([]);
    expect(db.query).not.toHaveBeenCalled();

    db.query.mockResolvedValueOnce({ rows: [{ user_id: 'u1', market_code: 'CM' }] });
    await expect(service.listActiveScopesForUsers(db, ['u1'])).resolves.toEqual([
      { user_id: 'u1', market_code: 'CM' },
    ]);
    expect(db.query.mock.calls[0][1]).toEqual([['u1']]);
  });

  test('historique utilisateur et détection d historique couvrent vrai/faux', async () => {
    const db = executor();
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 's1', revoked_at: null }] })
      .mockResolvedValueOnce({ rows: [{ has_history: true }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(service.listUserMarketScopeHistory(db, 'u1')).resolves.toEqual([{ id: 's1', revoked_at: null }]);
    await expect(service.hasUserMarketScopeHistory(db, 'u1')).resolves.toBe(true);
    await expect(service.hasUserMarketScopeHistory(db, 'u2')).resolves.toBe(false);
  });

  test('projection refuse rôle invalide ou membership absente', async () => {
    const db = executor();
    await expect(service.upsertProjectedMarketScope(db, {
      userId: 'u1', marketId: 'm1', scopeRole: 'admin', membershipId: 'mem1',
    })).resolves.toEqual({ status: 'invalid_scope_role', scope: null });
    await expect(service.upsertProjectedMarketScope(db, {
      userId: 'u1', marketId: 'm1', scopeRole: 'viewer', membershipId: null,
    })).rejects.toThrow(/membershipId requis/);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('projection identique est idempotente sans écriture', async () => {
    const db = executor();
    db.query.mockResolvedValueOnce({ rows: [{
      id: 's1', role: 'viewer', granted_at: 't1', granted_by: null, projected_from_membership_id: 'mem1',
    }] });
    const out = await service.upsertProjectedMarketScope(db, {
      userId: 'u1', marketId: 'm1', scopeRole: 'viewer', membershipId: 'mem1',
    });
    expect(out.status).toBe('unchanged');
    expect(out.scope).toMatchObject({ id: 's1', user_id: 'u1', market_id: 'm1', projected_from_membership_id: 'mem1' });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('sans projection active, crée directement la projection membership', async () => {
    const db = executor();
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 's1', projected_from_membership_id: 'mem1' }] });
    const out = await service.upsertProjectedMarketScope(db, {
      userId: 'u1', marketId: 'm1', scopeRole: 'viewer', membershipId: 'mem1',
    });
    expect(out.status).toBe('projected');
    expect(db.query.mock.calls[1][0]).toMatch(/INSERT INTO operator_market_scopes/);
  });

  test('révocation vide ne requête pas ; ids dupliqués/null sont normalisés', async () => {
    const db = executor();
    await expect(service.revokeProjectedMarketScopes(db, { membershipIds: null })).resolves.toEqual([]);
    expect(db.query).not.toHaveBeenCalled();

    db.query.mockResolvedValueOnce({ rows: [] });
    await service.revokeProjectedMarketScopes(db, { membershipIds: ['mem1', null, 'mem1'] });
    expect(db.query.mock.calls[0][1]).toEqual([['mem1'], []]);
  });

  test('liste de projections : vide sans ids, sinon lecture normalisée', async () => {
    const db = executor();
    await expect(service.listProjectedMarketScopes(db, { membershipIds: [] })).resolves.toEqual([]);
    expect(db.query).not.toHaveBeenCalled();

    db.query.mockResolvedValueOnce({ rows: [{ membership_id: 'mem1' }] });
    await expect(service.listProjectedMarketScopes(db, { membershipIds: ['mem1', 'mem1'] }))
      .resolves.toEqual([{ membership_id: 'mem1' }]);
    expect(db.query.mock.calls[0][1]).toEqual([['mem1']]);
  });

});
