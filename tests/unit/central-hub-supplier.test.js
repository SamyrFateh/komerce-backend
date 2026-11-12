'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { ensureCentralHubSupplier, resolveCatalogSupplier, CENTRAL_HUB } = require('../../services/suppliers/central-hub-supplier');

const hub = {
  id: 'hub-id', name: 'Fournisseur central Hub', platform: 'local',
  owner_scope: 'hub', system_key: 'central_hub', auto_order: false,
  is_active: true, deleted_at: null,
};

describe('central Hub procurement identity', () => {
  test('provisioning is idempotent and reads the existing protected record', async () => {
    const q = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [hub] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [hub] }) };
    await expect(ensureCentralHubSupplier(q)).resolves.toEqual(hub);
    await expect(ensureCentralHubSupplier(q)).resolves.toEqual(hub);
    expect(q.query).toHaveBeenCalledTimes(3);
    expect(q.query.mock.calls[0][0]).toContain('ON CONFLICT (system_key)');
    expect(q.query.mock.calls[1][1]).toEqual([
      CENTRAL_HUB.name,
      'Entité système de coordination des achats manuels. Pas un vendeur tiers, un provider ni une capacité API.',
      CENTRAL_HUB.systemKey,
    ]);
  });

  test('empty selection uses the central Hub record', async () => {
    const q = { query: jest.fn().mockResolvedValueOnce({ rows: [hub] }) };
    await expect(resolveCatalogSupplier(q, {})).resolves.toEqual(hub);
  });

  test('selected real supplier is resolved by id and inactive/unknown records are refused', async () => {
    const realId = '22222222-2222-4222-8222-222222222222';
    const real = { ...hub, id: realId, name: 'Fournisseur réel', system_key: null, platform: 'local', owner_scope: null };
    const q = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [real] })
      .mockResolvedValueOnce({ rows: [] }) };
    await expect(resolveCatalogSupplier(q, { supplierId: realId })).resolves.toEqual(real);
    await expect(resolveCatalogSupplier(q, { supplierId: '33333333-3333-4333-8333-333333333333' }))
      .rejects.toMatchObject({ status: 422, code: 'CATALOG_SUPPLIER_INVALID' });
  });

  test('unknown typed seller is not silently converted into a fictitious supplier', async () => {
    const q = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
    await expect(resolveCatalogSupplier(q, { supplierName: 'Vendeur jamais enregistré' }))
      .rejects.toMatchObject({ status: 422, code: 'CATALOG_SUPPLIER_NOT_REGISTERED' });
  });
});
