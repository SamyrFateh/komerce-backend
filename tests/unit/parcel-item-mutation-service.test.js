'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  assignWholeOrderItemToParcel,
  assignParcelItem,
  addParcelItem,
  removeParcelItem,
  assignSingleOrderItemToParcel,
  assertSameMarket,
  findParcelMarketViolations,
  addParcelItemTraced,
} = require('../../services/parcel-item-mutation-service');

describe('parcel-item-mutation-service', () => {
  test('assignWholeOrderItemToParcel utilise le même executor et garde la garde order_id', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

    await assignWholeOrderItemToParcel(executor, {
      parcelId: 'parcel-1',
      orderItemId: 'item-1',
      orderId: 'order-1',
    });

    expect(executor.query).toHaveBeenCalledTimes(1);
    expect(executor.query.mock.calls[0][0]).toContain('INSERT INTO parcel_items');
    expect(executor.query.mock.calls[0][0]).toContain('oi.order_id = $3');
    expect(executor.query.mock.calls[0][0]).toContain('ON CONFLICT DO NOTHING');
    expect(executor.query.mock.calls[0][1]).toEqual(['parcel-1', 'item-1', 'order-1']);
  });

  test('assignParcelItem conserve les valeurs résolues par l’appelant', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

    await assignParcelItem(executor, {
      parcelId: 'parcel-1',
      orderItemId: 'item-1',
      productId: 'product-1',
      quantity: 3,
    });

    expect(executor.query.mock.calls[0][0]).toContain('SELECT $1, oi.id, oi.product_id, $4::integer');
    expect(executor.query.mock.calls[0][0]).toContain('oi.product_id = $3');
    expect(executor.query.mock.calls[0][0]).toContain('$4::integer <= oi.quantity');
    expect(executor.query.mock.calls[0][0]).not.toContain('RETURNING');
    expect(executor.query.mock.calls[0][1]).toEqual(['parcel-1', 'item-1', 'product-1', 3]);
  });

  test('addParcelItem retourne la ligne créée', async () => {
    const executor = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 'pi-1' }], rowCount: 1 }),
    };

    const row = await addParcelItem(executor, {
      parcelId: 'parcel-1',
      orderItemId: 'item-1',
      productId: 'product-1',
      quantity: 2,
    });

    expect(row).toEqual({ id: 'pi-1' });
    expect(executor.query.mock.calls[0][0]).toContain('RETURNING *');
  });

  test('removeParcelItem retourne la ligne supprimée', async () => {
    const executor = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 'pi-1' }], rowCount: 1 }),
    };

    const row = await removeParcelItem(executor, {
      parcelId: 'parcel-1',
      orderItemId: 'item-1',
    });

    expect(row).toEqual({ id: 'pi-1' });
    expect(executor.query).toHaveBeenCalledWith(
      'DELETE FROM parcel_items WHERE parcel_id = $1 AND order_item_id = $2 RETURNING *',
      ['parcel-1', 'item-1']
    );
  });

  test('assignSingleOrderItemToParcel conserve quantity=1', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };

    await assignSingleOrderItemToParcel(executor, {
      parcelId: 'parcel-1',
      orderItemId: 'item-1',
    });

    expect(executor.query.mock.calls[0][0]).toContain('oi.product_id, 1');
    expect(executor.query.mock.calls[0][1]).toEqual(['parcel-1', 'item-1', 'item-1']);
  });

  test('refuse un executor sans query', async () => {
    await expect(
      assignParcelItem({}, {
        parcelId: 'parcel-1',
        orderItemId: 'item-1',
        productId: 'product-1',
        quantity: 1,
      })
    ).rejects.toThrow(/requires an executor/);
  });

  describe('garde même marché par colis', () => {
    const mk = (rows) => ({ query: jest.fn().mockResolvedValue({ rows }) });
    const parcel = { order_id: 'o1', relais_id: null };

    test('même commande : autorisé sans requête', async () => {
      const ex = mk([]);
      await assertSameMarket(ex, parcel, 'o1');
      expect(ex.query).not.toHaveBeenCalled();
    });
    test('même marché : autorisé', async () => {
      await expect(assertSameMarket(mk([{ id: 'o1', market_id: 'm1' }, { id: 'o2', market_id: 'm1' }]), parcel, 'o2')).resolves.toBeUndefined();
    });
    test('marchés différents : refusé, y compris relais NULL', async () => {
      await expect(assertSameMarket(mk([{ id: 'o1', market_id: 'm1' }, { id: 'o2', market_id: 'm2' }]), parcel, 'o2'))
        .rejects.toMatchObject({ code: 'MARKET_MISMATCH', status: 409 });
    });
    test('marché inconnu : refusé (jamais assimilé à « même marché »)', async () => {
      await expect(assertSameMarket(mk([{ id: 'o1', market_id: 'm1' }, { id: 'o2', market_id: null }]), parcel, 'o2'))
        .rejects.toMatchObject({ code: 'MARKET_UNKNOWN' });
    });
    test('addParcelItemTraced applique la garde avant toute écriture', async () => {
      const calls = [];
      const ex = { query: jest.fn(async (sql) => {
        calls.push(sql);
        if (/FROM parcels WHERE id/.test(sql)) return { rows: [{ id: 'p1', order_id: 'o1', reference: 'P', status: 'draft', relais_id: null }] };
        if (/FROM order_items oi JOIN orders/.test(sql)) return { rows: [{ id: 'i2', quantity: 1, product_id: 'x', order_id: 'o2', relais_id: 'r' }] };
        if (/FROM orders WHERE id = ANY/.test(sql)) return { rows: [{ id: 'o1', market_id: 'm1' }, { id: 'o2', market_id: 'm2' }] };
        return { rows: [] };
      }) };
      await expect(addParcelItemTraced(ex, { parcelId: 'p1', orderItemId: 'i2', actorId: 'u' })).rejects.toMatchObject({ code: 'MARKET_MISMATCH' });
      expect(calls.some((q) => /INSERT INTO parcel_items/.test(q))).toBe(false);
    });
    test('findParcelMarketViolations est en lecture seule', async () => {
      const ex = mk([{ parcel_id: 'p1' }]);
      expect(await findParcelMarketViolations(ex)).toEqual([{ parcel_id: 'p1' }]);
      expect(ex.query.mock.calls[0][0]).toMatch(/^\s*SELECT/);
      expect(ex.query.mock.calls[0][0]).not.toMatch(/UPDATE|DELETE|INSERT/);
    });
  });
});

describe('assertSameMarket (garde canonique exportée, lecture seule)', () => {
  const { assertSameMarket } = require('../../services/parcel-item-mutation-service');
  const exec = rows => ({ query: jest.fn(async () => ({ rows })) });
  test('même commande : aucune requête, accepté', async () => {
    const e = exec([]);
    await expect(assertSameMarket(e, { order_id: 'o1' }, 'o1')).resolves.toBeUndefined();
    expect(e.query).not.toHaveBeenCalled();
  });
  test('marchés différents : 409 MARKET_MISMATCH', async () => {
    const e = exec([{ id: 'o1', market_id: 'm1' }, { id: 'o2', market_id: 'm2' }]);
    await expect(assertSameMarket(e, { order_id: 'o1' }, 'o2')).rejects.toMatchObject({ code: 'MARKET_MISMATCH', status: 409 });
  });
  test('marché inconnu : 409 MARKET_UNKNOWN', async () => {
    const e = exec([{ id: 'o1', market_id: 'm1' }, { id: 'o2', market_id: null }]);
    await expect(assertSameMarket(e, { order_id: 'o1' }, 'o2')).rejects.toMatchObject({ code: 'MARKET_UNKNOWN', status: 409 });
  });
});
