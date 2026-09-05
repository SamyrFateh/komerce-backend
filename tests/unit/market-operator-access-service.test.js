'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const {
  MarketOperatorAccessError,
  listOperators,
  grantScope,
  revokeScope,
} = require('../../services/market-operator-access-service');

function makeDb(sequence = []) {
  const client = { query: jest.fn() };
  for (const result of sequence) client.query.mockResolvedValueOnce(result);
  return {
    query: jest.fn(),
    withTransaction: jest.fn(async callback => callback(client)),
    client,
  };
}

test('listOperators regroupe les scopes actifs par market_operator', async () => {
  const db = makeDb();
  db.query.mockResolvedValue({ rows: [
    { user_id: 'u1', full_name: 'CM Partner', email: 'cm@example.test', phone: null, user_role: 'market_operator', grant_id: 'g1', market_role: 'manager', granted_at: '2026-09-01', market_code: 'CM', market_name: 'Cameroun', currency: 'XAF' },
    { user_id: 'u1', full_name: 'CM Partner', email: 'cm@example.test', phone: null, user_role: 'market_operator', grant_id: 'g2', market_role: 'viewer', granted_at: '2026-09-02', market_code: 'CG', market_name: 'Congo', currency: 'XAF' },
  ] });

  const result = await listOperators(db);
  expect(result).toHaveLength(1);
  expect(result[0].scopes).toEqual([
    expect.objectContaining({ market_code: 'CM', role: 'manager' }),
    expect.objectContaining({ market_code: 'CG', role: 'viewer' }),
  ]);
});

test('grantScope refuse un compte qui nest pas market_operator', async () => {
  const db = makeDb([
    { rows: [{ id: 'u1', full_name: 'Client', email: 'x@test', role: 'client' }] },
  ]);

  await expect(grantScope(db, { userId: 'u1', marketCode: 'CM', role: 'manager', actorId: 'admin-1' }))
    .rejects.toMatchObject({ status: 409, code: 'market_operator_role_required' });
});

test('grantScope manager remplace un viewer actif en révoquant puis recréant le grant', async () => {
  const db = makeDb([
    { rows: [{ id: 'u1', full_name: 'Partner', email: 'p@test', role: 'market_operator' }] },
    { rows: [{ id: 'm1', code: 'CM', name: 'Cameroun', currency: 'XAF' }] },
    { rows: [{ id: 'g-old', role: 'viewer', granted_at: 'old' }] },
    { rows: [{ id: 'g-old', role: 'viewer' }] },
    { rows: [{ id: 'g-new', role: 'manager', granted_at: 'new' }] },
  ]);

  const result = await grantScope(db, { userId: 'u1', marketCode: 'cm', role: 'manager', actorId: 'admin-1' });
  expect(result.changed).toBe(true);
  expect(result.market.code).toBe('CM');
  expect(result.role).toBe('manager');
  expect(db.client.query.mock.calls[3][0]).toContain('revoked_at = NOW()');
  expect(db.client.query.mock.calls[4][0]).toContain('INSERT INTO operator_market_scopes');
});

test('grantScope identique est idempotent et ne recrée pas un grant', async () => {
  const db = makeDb([
    { rows: [{ id: 'u1', full_name: 'Partner', email: 'p@test', role: 'market_operator' }] },
    { rows: [{ id: 'm1', code: 'CM', name: 'Cameroun', currency: 'XAF' }] },
    { rows: [{ id: 'g1', role: 'manager', granted_at: 'now' }] },
  ]);

  const result = await grantScope(db, { userId: 'u1', marketCode: 'CM', role: 'manager', actorId: 'admin-1' });
  expect(result.changed).toBe(false);
  expect(db.client.query).toHaveBeenCalledTimes(3);
});

test('revokeScope journalise la révocation sans DELETE', async () => {
  const db = makeDb([
    { rows: [{ id: 'u1', email: 'p@test' }] },
    { rows: [{ id: 'm1', code: 'CM', name: 'Cameroun', currency: 'XAF' }] },
    { rows: [{ id: 'g1', role: 'manager', granted_at: 'old', revoked_at: 'now' }] },
  ]);

  const result = await revokeScope(db, { userId: 'u1', marketCode: 'CM', actorId: 'admin-1' });
  expect(result.revoked).toBe(true);
  expect(result.previous_role).toBe('manager');
  const sql = db.client.query.mock.calls[2][0];
  expect(sql).toContain('UPDATE operator_market_scopes');
  expect(sql).not.toContain('DELETE FROM operator_market_scopes');
});

test('rôle de grant invalide est rejeté avant transaction', async () => {
  const db = makeDb();
  await expect(grantScope(db, { userId: 'u1', marketCode: 'CM', role: 'admin', actorId: 'admin-1' }))
    .rejects.toBeInstanceOf(MarketOperatorAccessError);
  expect(db.withTransaction).not.toHaveBeenCalled();
});
