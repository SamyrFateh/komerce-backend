'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @feature dashboard
 * @brief L8 — lecture par lot de la couverture physique : une seule requête, Map par commande, aucune écriture.
 */
const { getOrdersPhysicalCoverage } = require('../../services/order-physical-coverage-service');

describe('getOrdersPhysicalCoverage', () => {
  test('une seule requête SELECT pour toutes les commandes, dédoublonnées', async () => {
    const executor = { query: jest.fn(async () => ({ rows: [
      { order_id: 'a', lines: 2, needed: '5', usable: '2', covered: false },
      { order_id: 'b', lines: 1, needed: 3, usable: 3, covered: true },
    ] })) };
    const map = await getOrdersPhysicalCoverage(executor, ['a', 'b', 'a', null]);
    expect(executor.query).toHaveBeenCalledTimes(1);
    const [sql, params] = executor.query.mock.calls[0];
    expect(sql.trim()).toMatch(/^SELECT/);
    expect(sql).toContain('v_purchase_line_progress');
    expect(sql).toContain("<> 'LOCAL_STOCK'");
    expect(params).toEqual([['a', 'b']]);
    expect(map.get('a')).toEqual({ covered: false, lines: 2, needed: 5, usable: 2 });
    expect(map.get('b')).toEqual({ covered: true, lines: 1, needed: 3, usable: 3 });
    expect(map.has('c')).toBe(false);
  });

  test('liste vide → aucune requête', async () => {
    const executor = { query: jest.fn() };
    expect((await getOrdersPhysicalCoverage(executor, [])).size).toBe(0);
    expect(executor.query).not.toHaveBeenCalled();
  });
});
