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

  test('grant initial crée une nouvelle ligne active', async () => {
    const db = executor();
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'm1', code: 'CM', name: 'Cameroun', currency: 'XAF', minor_unit: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'g1', user_id: 'u1', market_id: 'm1', scope_role: 'manager', granted_at: 't1', granted_by: 'admin1' }] });

    const result = await service.grantOrReplaceMarketScope(db, {
      userId: 'u1', marketCode: 'cm', scopeRole: 'manager', grantedBy: 'admin1',
    });

    expect(result.status).toBe('granted');
    expect(result.scope.market_code).toBe('CM');
    expect(db.query.mock.calls[2][0]).toMatch(/INSERT INTO operator_market_scopes/);
  });

  test('grant identique est idempotent et ne réécrit pas l’historique', async () => {
    const db = executor();
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'm1', code: 'CM', name: 'Cameroun', currency: 'XAF', minor_unit: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'g1', role: 'viewer', granted_at: 't1', granted_by: 'admin1' }] });

    const result = await service.grantOrReplaceMarketScope(db, {
      userId: 'u1', marketCode: 'CM', scopeRole: 'viewer', grantedBy: 'admin2',
    });

    expect(result.status).toBe('unchanged');
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  test('changement viewer → manager révoque puis recrée au lieu de modifier la ligne', async () => {
    const db = executor();
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'm1', code: 'CM', name: 'Cameroun', currency: 'XAF', minor_unit: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'old', role: 'viewer', granted_at: 't1', granted_by: 'admin1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'old' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'new', user_id: 'u1', market_id: 'm1', scope_role: 'manager', granted_at: 't2', granted_by: 'admin2' }] });

    const result = await service.grantOrReplaceMarketScope(db, {
      userId: 'u1', marketCode: 'CM', scopeRole: 'manager', grantedBy: 'admin2',
    });

    expect(result.status).toBe('replaced');
    expect(db.query.mock.calls[2][0]).toMatch(/SET revoked_at = NOW\(\)/);
    expect(db.query.mock.calls[3][0]).toMatch(/INSERT INTO operator_market_scopes/);
    expect(db.query.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/SET role =/);
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

  test('scope invalide ou marché inconnu n’insère rien', async () => {
    const invalidDb = executor();
    invalidDb.query.mockResolvedValueOnce({ rows: [{ id: 'm1', code: 'CM', name: 'Cameroun' }] });
    const invalid = await service.grantOrReplaceMarketScope(invalidDb, {
      userId: 'u1', marketCode: 'CM', scopeRole: 'admin', grantedBy: 'admin1',
    });
    expect(invalid.status).toBe('invalid_scope_role');
    expect(invalidDb.query).toHaveBeenCalledTimes(1);

    const missingDb = executor();
    missingDb.query.mockResolvedValueOnce({ rows: [] });
    const missing = await service.grantOrReplaceMarketScope(missingDb, {
      userId: 'u1', marketCode: 'ZZ', scopeRole: 'viewer', grantedBy: 'admin1',
    });
    expect(missing.status).toBe('market_not_found');
    expect(missingDb.query).toHaveBeenCalledTimes(1);
  });
});
