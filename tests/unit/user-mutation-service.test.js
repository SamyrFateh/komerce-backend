'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mutations =
  require('../../services/user-mutation-service');

function executor(result = {
  rowCount: 1,
  rows: [],
}) {
  return {
    query: jest.fn(async () => result),
  };
}

describe('user-mutation-service', () => {
  test('requires caller-owned executor', async () => {
    await expect(
      mutations.deleteUser(null, 'u1')
    ).rejects.toThrow('executor.query requis');
  });

  test('admin user creation is narrow', async () => {
    const q = executor({
      rows: [{ id: 'u1' }],
      rowCount: 1,
    });

    await mutations.createAdminUser(q, {
      fullName: 'Test',
      email: 'test@example.com',
      phone: null,
      role: 'client',
      currencyPref: 'KMF',
      passwordHash: 'hash',
    });

    const [sql, params] = q.query.mock.calls[0];

    expect(sql).toContain('INSERT INTO users');
    expect(sql).toContain('password_hash');
    expect(params).toEqual([
      'Test',
      'test@example.com',
      null,
      'client',
      'KMF',
      'hash',
    ]);
  });

  test('role mutation touches role only', async () => {
    const q = executor();

    await mutations.setUserRole(q, {
      userId: 'u1',
      role: 'agent_relais',
    });

    const [sql, params] = q.query.mock.calls[0];

    expect(sql).toContain('SET role = $1');
    expect(sql).not.toContain('password_hash');
    expect(params).toEqual([
      'agent_relais',
      'u1',
    ]);
  });

  test('password mutation is narrow', async () => {
    const q = executor();

    await mutations.setUserPasswordHash(q, {
      userId: 'u1',
      passwordHash: 'hash2',
    });

    const [sql, params] = q.query.mock.calls[0];

    expect(sql).toContain(
      'password_hash = $1'
    );
    expect(params).toEqual([
      'hash2',
      'u1',
    ]);
  });

  test('soft deletion preserves historical row', async () => {
    const q = executor();

    await mutations.anonymizeUser(q, 'u1');

    const [sql, params] = q.query.mock.calls[0];

    expect(sql).toContain(
      "'[Compte supprimé]'"
    );
    expect(sql).toContain(
      "'@komerce.deleted'"
    );
    expect(params).toEqual(['u1']);
  });

  test('hard deletion is caller-executed', async () => {
    const q = executor();

    await mutations.deleteUser(q, 'u1');

    expect(q.query).toHaveBeenCalledWith(
      'DELETE FROM users WHERE id = $1::uuid',
      ['u1'],
    );
  });

  test('system reset deletes only non-admin users', async () => {
    const q = executor();

    await mutations.deleteNonAdminUsers(q);

    expect(q.query.mock.calls[0][0]).toBe(
      "DELETE FROM users WHERE role != 'admin'"
    );
  });

  test('big basket increment is atomic', async () => {
    const q = executor();

    await mutations.incrementBigBasketCount(
      q,
      'u1',
    );

    const [sql, params] = q.query.mock.calls[0];

    expect(sql).toContain(
      'big_basket_count = big_basket_count + 1'
    );
    expect(sql).toContain('RETURNING');
    expect(params).toEqual(['u1']);
  });

  test('notification watermark is narrow', async () => {
    const q = executor();

    await mutations.markBigBasketNotified(q, {
      userId: 'u1',
      count: 6,
    });

    const [sql, params] = q.query.mock.calls[0];

    expect(sql).toContain(
      'big_basket_last_notified_count = $1'
    );
    expect(params).toEqual([6, 'u1']);
  });

  test('loyalty recalculation stays behind users owner', async () => {
    const q = executor();

    await mutations.recalculateUserLoyalty(
      q,
      'u1',
    );

    expect(q.query).toHaveBeenCalledWith(
      'SELECT recalculate_loyalty($1)',
      ['u1'],
    );
  });
});
