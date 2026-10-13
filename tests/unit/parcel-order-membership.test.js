'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {
  memberParcelPredicate, listParcelsRepresentingOrder, listOrdersRepresentedByParcel, listOrdersRepresentedByParcels,
} = require('../../services/parcel-order-membership');

describe('parcel-order-membership (HUB-A)', () => {
  test('prédicat : lignes de la commande OU colis porteur sans ligne rattachée', () => {
    const sql = memberParcelPredicate('p', '$1');
    expect(sql).toContain('moi.order_id = $1');
    expect(sql).toContain('p.order_id = $1');
    expect(sql).toContain('NOT EXISTS');
  });

  test('listParcelsRepresentingOrder : colonnes par défaut et exclusion des annulés', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'p1' }] }) };
    expect(await listParcelsRepresentingOrder(executor, 'o1')).toEqual([{ id: 'p1' }]);
    expect(executor.query.mock.calls[0][0]).not.toContain("<> 'cancelled'");
    await listParcelsRepresentingOrder(executor, 'o1', { columns: 'p.id', excludeCancelled: true });
    expect(executor.query.mock.calls[1][0]).toContain("p.status <> 'cancelled'");
    expect(executor.query.mock.calls[1][1]).toEqual(['o1']);
  });

  test('listOrdersRepresentedByParcels : accepte un id ou une liste et renvoie les commandes distinctes', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [{ order_id: 'o1' }, { order_id: 'o2' }] }) };
    expect(await listOrdersRepresentedByParcels(executor, ['p1', 'p2'])).toEqual(['o1', 'o2']);
    expect(executor.query.mock.calls[0][1]).toEqual([['p1', 'p2']]);
    expect(await listOrdersRepresentedByParcel(executor, 'p1')).toEqual(['o1', 'o2']);
    expect(executor.query.mock.calls[1][1]).toEqual([['p1']]);
    await listOrdersRepresentedByParcels(executor, 'p9');
    expect(executor.query.mock.calls[2][1]).toEqual([['p9']]);
  });
});
