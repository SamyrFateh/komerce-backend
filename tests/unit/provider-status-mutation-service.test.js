'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const { setOwnedProviderStatus } = require('../../services/provider-status-mutation-service');

describe('provider-status-mutation-service', () => {
  test('UPDATE est borné par provider_id + market_id', async () => {
    const db = { query: jest.fn(async (sql, params) => {
      expect(sql).toMatch(/WHERE id = \$1/);
      expect(sql).toMatch(/market_id = \$2/);
      expect(params).toEqual(['p1', 'mkt-cm', 'suspended']);
      return { rows: [{ id: 'p1', market_id: 'mkt-cm', status: 'suspended' }] };
    }) };
    await expect(setOwnedProviderStatus(db, { providerId: 'p1', marketId: 'mkt-cm', status: 'suspended' }))
      .resolves.toMatchObject({ market_id: 'mkt-cm', status: 'suspended' });
  });

  test('statut invalide échoue avant SQL', async () => {
    const db = { query: jest.fn() };
    await expect(setOwnedProviderStatus(db, { providerId: 'p1', marketId: 'mkt-cm', status: 'deleted' }))
      .rejects.toMatchObject({ code: 'PROVIDER_STATUS_INVALID', status: 400 });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('aucune ligne mise à jour renvoie null sans fuite cross-market', async () => {
    const db = { query: jest.fn(async () => ({ rows: [] })) };
    await expect(setOwnedProviderStatus(db, { providerId: 'p1', marketId: 'mkt-cm', status: 'active' }))
      .resolves.toBeNull();
  });
});
