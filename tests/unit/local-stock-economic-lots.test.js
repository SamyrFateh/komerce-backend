'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const lots=require('../../services/cost-allocation/local-stock-economic-lots');
const receiptId='10000000-0000-0000-0000-000000000001';
const orderItemId='10000000-0000-0000-0000-000000000002';
const args={marketId:'market',receiptId,orderItemId,lotProofRef:'BL/lot',actorId:'admin'};
test('no cost from an undocumented or unpriced receipt',async()=>{
  const q={query:jest.fn().mockResolvedValue({rows:[]})};
  await expect(lots.close(q,{...args,purchaseTotalKmf:'50000',paymentProofRef:'bank'})).rejects.toMatchObject({code:'LOCAL_LOT_RECEIPT_UNPROVEN'});
  await expect(lots.close(q,{...args,purchaseTotalKmf:null,paymentProofRef:'bank'})).rejects.toMatchObject({code:'LOCAL_LOT_AMOUNT_INVALID'});
  expect(q.query).toHaveBeenCalledTimes(1);
});
test('refuses sale beyond proven receipt quantity',async()=>{
  const q={query:jest.fn()
    .mockResolvedValueOnce({rows:[{sku_id:'sku',quantity:10,received_at:'2026-11-01'}]})
    .mockResolvedValueOnce({rows:[{id:orderItemId,quantity:4}]})
    .mockResolvedValueOnce({rows:[]})
    .mockResolvedValueOnce({rows:[{quantity:7}]})};
  await expect(lots.link(q,args)).rejects.toMatchObject({code:'LOCAL_LOT_QUANTITY_EXCEEDED'});
  expect(q.query).toHaveBeenCalledTimes(4);
});
test('replays the exact existing sale attribution without rewriting it',async()=>{
  const existing={receipt_id:receiptId,quantity:4,lot_proof_ref:'BL/lot'};
  const q={query:jest.fn().mockResolvedValueOnce({rows:[{sku_id:'sku',quantity:10}]})
    .mockResolvedValueOnce({rows:[{id:orderItemId,quantity:4}]})
    .mockResolvedValueOnce({rows:[existing]})};
  await expect(lots.link(q,args)).resolves.toEqual(existing);
  expect(q.query).toHaveBeenCalledTimes(3);
});

test('partial links remain unpriced until exact sale coverage',()=>{
 const row={order_item_id:'a',shipment_id:'L1',part_quantity:4,sale_quantity:10,purchase_kmf:'20000'};
 expect(lots.groupCompleteSaleLots([row]).size).toBe(0);
 const second={...row,shipment_id:'L2',part_quantity:6,purchase_kmf:'30000.01'};
 expect(lots.groupCompleteSaleLots([row,second]).get('a')).toMatchObject({purchase_kmf:50000.01,parts:[row,second]});
 expect(lots.groupCompleteSaleLots([row,second,second]).size).toBe(0);
});
test('refuses cumulative attribution exceeding the sale quantity',async()=>{
 const q={query:jest.fn().mockResolvedValueOnce({rows:[{sku_id:'sku',quantity:10}]})
 .mockResolvedValueOnce({rows:[{id:orderItemId,quantity:4}]})
 .mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{quantity:0}]})
 .mockResolvedValueOnce({rows:[{quantity:3}]})};
 await expect(lots.link(q,{...args,quantity:2})).rejects.toMatchObject({code:'LOCAL_LOT_SALE_QUANTITY_EXCEEDED'});
});
