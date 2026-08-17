/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const service = require('../../services/catalog-product-mutation-service');

describe('catalog-product-mutation-service', () => {
  test('applyPrice owns the products price UPDATE and returns the updated row', async () => {
    const updated = { id: 'p1', name: 'Produit', price_kmf: 12000 };
    const db = { query: jest.fn().mockResolvedValue({ rows: [updated] }) };

    await expect(service.applyPrice(db, 'p1', 12000)).resolves.toEqual(updated);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toContain('UPDATE products SET price_kmf');
    expect(db.query.mock.calls[0][1]).toEqual([12000, 'p1']);
  });

  test('updateSourcingFields preserves the legacy weight_g -> weight_kg mapping', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'p1', weight_kg: 1.25 }] }) };

    await service.updateSourcingFields(db, 'p1', { weight_g: 1250 });

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toContain('weight_kg = $1');
    expect(db.query.mock.calls[0][1]).toEqual([1.25, 'p1']);
  });

  test('updateSourcingFields rejects an empty mutation exactly like the legacy service', async () => {
    const db = { query: jest.fn() };

    await expect(service.updateSourcingFields(db, 'p1', {})).rejects.toMatchObject({
      message: 'Aucun champ à mettre à jour',
      status: 400,
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('bulkAssignSourcingRail returns the affected products count', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rowCount: 3 }) };

    await expect(service.bulkAssignSourcingRail(db, ['p1', 'p2', 'p3'], 'B')).resolves.toBe(3);
    expect(db.query.mock.calls[0][0]).toContain('UPDATE products SET sourcing_rail');
    expect(db.query.mock.calls[0][1]).toEqual(['B', ['p1', 'p2', 'p3']]);
  });

  test('replaceVariantsForSourcing preserves validation rollback semantics', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}), // ROLLBACK
      release: jest.fn(),
    };
    const dbPool = { getClient: jest.fn().mockResolvedValue(client) };

    await expect(service.replaceVariantsForSourcing(dbPool, 'p1', null)).resolves.toEqual({
      status: 400,
      body: { error: 'variants doit être un tableau' },
    });
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
