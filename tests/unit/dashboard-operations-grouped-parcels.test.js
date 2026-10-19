'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...a) => mockQuery(...a) }));
jest.mock('../../utils/logger', () => ({ child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }) }));

const { getActiveOrders } = require('../../services/dashboard-operations');

describe('S7b-2 : colis d’une commande groupée comptés aussi par ses lignes', () => {
  beforeEach(() => { mockQuery.mockReset(); mockQuery.mockResolvedValue({ rows: [] }); });

  test('parcels_count rattache les colis par la commande porteuse OU par les lignes (parcel_items → order_items)', async () => {
    await getActiveOrders({});
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain('p.order_id = o.id');
    expect(sql).toContain('FROM parcel_items pi');
    expect(sql).toContain('pi.parcel_id = p.id');
    expect(sql).toContain('JOIN order_items oi ON oi.id = pi.order_item_id');
    expect(sql).toContain('oi.order_id = o.id');
    expect(sql).toContain('COUNT(DISTINCT p.id)');
  });

  test('le rattachement ne passe pas par une jointure qui multiplierait les lignes de commande', async () => {
    await getActiveOrders({});
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toMatch(/LEFT JOIN parcels p ON p\.order_id = o\.id\s+OR EXISTS/);
  });
});
