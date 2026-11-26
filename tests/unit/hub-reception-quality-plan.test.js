'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {planReceptionQuality,lockReceptionQualityPlan}=require('../../services/hub-reception-quality-plan');
const expected=(sku,qty)=>({product_sku_id:sku,remaining_quantity:qty});
const observation=(sku,received,rejected,confirmed=true)=>({product_sku_id:sku,received_quantity:received,rejected_quantity:rejected,quantity_confirmed:confirmed});
test('réception nominale : les quantités multiples sont confirmées et les unités simples explicites',()=>{
 const result=planReceptionQuality([expected('a',5),expected('b',1)],[observation('a',5,0),observation('b',1,0,false)]);
 expect(result.totals).toEqual({expected_quantity:6,received_quantity:6,conforming_quantity:6,rejected_quantity:0,missing_quantity:0});
});
test('réception mixte : distingue les conformes, refusés et manquants pour une même référence',()=>{
 const result=planReceptionQuality([expected('a',2),expected('a',3)],[observation('a',4,1)]);
 expect(result.lines).toEqual([{product_sku_id:'a',expected_quantity:5,received_quantity:4,conforming_quantity:3,rejected_quantity:1,missing_quantity:1}]);
});
test('article absent : pas de retour inventé',()=>{
 expect(planReceptionQuality([expected('a',1)],[observation('a',0,0,false)]).totals).toMatchObject({conforming_quantity:0,rejected_quantity:0,missing_quantity:1});
});
test.each([
 [[], 'HUB_QUALITY_OBSERVATION_INCOMPLETE'],
 [[observation('a',5,0,false)], 'HUB_QUALITY_QUANTITY_UNCONFIRMED'],
 [[observation('a',6,0)], 'HUB_QUALITY_QUANTITY_INVALID'],
 [[observation('a',4,5)], 'HUB_QUALITY_QUANTITY_INVALID'],
 [[observation('a',4,-1)], 'HUB_QUALITY_QUANTITY_INVALID'],
 [[observation('a',1.5,0)], 'HUB_QUALITY_QUANTITY_INVALID'],
 [[observation('a','4',0)], 'HUB_QUALITY_QUANTITY_INVALID'],
 [[observation('a',1,0),observation('a',1,0)], 'HUB_QUALITY_DUPLICATE_SKU'],
 [[observation('b',1,0)], 'HUB_QUALITY_UNKNOWN_SKU'],
])('réception refuse un constat invalide %#',(rows,code)=>{
 expect(()=>planReceptionQuality([expected('a',5)],rows)).toThrow(code);
});
test('réception ne permet pas un second constat sur une quantité épuisée',()=>{
 expect(()=>planReceptionQuality([expected('a',0)],[observation('a',1,0)])).toThrow('HUB_QUALITY_NO_REMAINING');
});

describe('attendus canoniques sous verrou transactionnel',()=>{
 const header={id:'p1',order_id:null,market_id:'m1',status:'confirmed'};
 const rows=[{id:'l1',market_id:'m1',product_sku_id:'a',effective:3},{id:'l2',market_id:'m1',product_sku_id:'a',effective:4}];
 const db=(po=header,lines=rows,receipts=[1,1])=>{
   const query=jest.fn().mockResolvedValueOnce({rows:po?[po]:[]}).mockResolvedValueOnce({rows:lines});
   for(const received of receipts)query.mockResolvedValueOnce({rows:[{received}]});
   return {query};
 };
 test('relit le reçu après le verrou et agrège les restants de plusieurs lignes FIFO',async()=>{
   const client=db();
   const result=await lockReceptionQualityPlan(client,{purchaseOrderId:'p1',marketId:'m1',observations:[observation('a',4,1)]});
   expect(result.totals).toEqual({expected_quantity:5,received_quantity:4,conforming_quantity:3,rejected_quantity:1,missing_quantity:1});
   expect(client.query.mock.calls[0][0]).toMatch(/purchase_orders.*FOR UPDATE/);
   expect(client.query.mock.calls[1][0]).toContain('FOR UPDATE OF pl');
   expect(client.query.mock.calls[2]).toEqual(['SELECT purchase_line_received_quantity($1) AS received',['l1']]);
   expect(client.query.mock.calls[3][1]).toEqual(['l2']);
 });
 test.each([[null,'HUB_QUALITY_PO_SCOPE'],[{...header,market_id:'m2'},'HUB_QUALITY_PO_SCOPE'],[{...header,order_id:'o1'},'HUB_QUALITY_GROUPED_PO_REQUIRED'],[{...header,status:'draft'},'HUB_QUALITY_PO_NOT_RECEIVABLE']])('refuse la PO invalide avant lecture des lignes %#',async(po,code)=>{
   const client=db(po);
   await expect(lockReceptionQualityPlan(client,{purchaseOrderId:'p1',marketId:'m1',observations:[]})).rejects.toThrow(code);
   expect(client.query).toHaveBeenCalledTimes(1);
 });
 test('refuse une PO dont une ligne relève d’un autre marché',async()=>{
   const client=db(header,[...rows,{...rows[0],market_id:'m2'}]);
   await expect(lockReceptionQualityPlan(client,{purchaseOrderId:'p1',marketId:'m1',observations:[]})).rejects.toThrow('HUB_QUALITY_PO_SCOPE');
   expect(client.query).toHaveBeenCalledTimes(2);
 });
 test('refuse une quantité au-delà du restant relu sous verrou',async()=>{
   const client=db(header,rows,[2,2]);
   await expect(lockReceptionQualityPlan(client,{purchaseOrderId:'p1',marketId:'m1',observations:[observation('a',4,0)]})).rejects.toThrow('HUB_QUALITY_QUANTITY_INVALID');
 });
});
