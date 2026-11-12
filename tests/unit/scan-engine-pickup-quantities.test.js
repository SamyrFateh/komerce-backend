/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
jest.mock('../../utils/logger', () => ({
  child: () => ({info:jest.fn(),warn:jest.fn(),error:jest.fn()}),
}));
const { projectCollectedPickupQuantities } = require('../../services/scan-engine');

describe('scan-engine — projection des quantités de retrait par code', () => {
  test('met à jour parcel_items puis order_items pour le même colis et la même transaction', async () => {
    const client={query:jest.fn(async (sql, params)=>{
      if(sql.includes('SELECT pi.order_item_id') && sql.includes('FOR UPDATE OF pi')){
        return { rows:[
          {order_item_id:'item1',quantity:2,qty_received:2,qty_collected:0},
          {order_item_id:'item2',quantity:1,qty_received:1,qty_collected:0},
        ] };
      }
      return { rows:[], rowCount:2 };
    })};
    const result=await projectCollectedPickupQuantities(client,'parcel-a');
    expect(result).toEqual({parcelId:'parcel-a',orderItemIds:['item1','item2']});
    const queries=client.query.mock.calls.map(([sql])=>sql);
    const updateItems=queries.findIndex(x=>x.includes('UPDATE parcel_items'));
    const updateOrder=queries.findIndex(x=>x.includes('UPDATE order_items oi'));
    expect(updateItems).toBeGreaterThan(0);
    expect(updateOrder).toBeGreaterThan(updateItems);
    expect(queries[updateItems]).toContain('qty_collected = qty_received');
    expect(queries[updateOrder]).toContain("p.status <> 'cancelled'");
    expect(client.query.mock.calls[updateItems][1]).toEqual(['parcel-a']);
    expect(client.query.mock.calls[updateOrder][1]).toEqual([['item1','item2']]);
  });

  test('refuse un colis sans réception physique (aucune écriture)', async () => {
    const client={query:jest.fn(async ()=>({
      rows:[{order_item_id:'item1',quantity:2,qty_received:0,qty_collected:0}]
    }))};
    await expect(projectCollectedPickupQuantities(client,'parcel-a'))
      .rejects.toThrow('PICKUP_PHYSICAL_QUANTITY_INVALID');
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  test('refuse la projection sans transaction et les quantités impossibles', async () => {
    await expect(projectCollectedPickupQuantities(null,'p'))
      .rejects.toThrow('PICKUP_PHYSICAL_TRANSACTION_REQUIRED');
    const client={query:jest.fn(async ()=>({
      rows:[{order_item_id:'item1',quantity:2,qty_received:3,qty_collected:0}]
    }))};
    await expect(projectCollectedPickupQuantities(client,'p'))
      .rejects.toThrow('PICKUP_PHYSICAL_QUANTITY_INVALID');
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});
