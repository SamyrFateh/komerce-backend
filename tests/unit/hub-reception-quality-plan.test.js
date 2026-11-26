'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {planReceptionQuality}=require('../../services/hub-reception-quality-plan');
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
