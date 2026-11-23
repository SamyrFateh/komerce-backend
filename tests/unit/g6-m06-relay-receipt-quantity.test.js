/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {planFullReceiptLines}=require('../../scripts/recette/canonical/relay-receipt-quantity-plan');
const plan=(rows,ids,units)=>planFullReceiptLines(rows,{itemIds:ids,totalUnits:units});
describe('M06 receipt quantity is derived from real UI expected quantities',()=>{
 test('M06 3 units on a single item',()=>{
  expect(plan([{order_item_id:'manual',max:'3'}],['manual'],3))
   .toEqual([{order_item_id:'manual',received_qty:3}]);
 });
 test('historical M01 one item, one unit',()=>{
  expect(plan([{order_item_id:'one',max:'1'}],['one'],1))
   .toEqual([{order_item_id:'one',received_qty:1}]);
 });
 test('M03 three independent items of one unit each',()=>{
  expect(plan([{order_item_id:'a',max:'1'},{order_item_id:'b',max:'1'},{order_item_id:'c',max:'1'}],
   ['a','b','c'],3)).toEqual([
    {order_item_id:'a',received_qty:1},
    {order_item_id:'b',received_qty:1},
    {order_item_id:'c',received_qty:1}
   ]);
 });
 test.each([
  [[{order_item_id:'a',max:'1'}],['a'],3],
  [[{order_item_id:'a',max:'4'}],['a'],3],
  [[{order_item_id:'a',max:'0'}],['a'],1],
  [[{order_item_id:'a',max:'1.5'}],['a'],1],
  [[{order_item_id:'a',max:''}],['a'],1],
  [[{order_item_id:'foreign',max:'3'}],['a'],3],
  [[{order_item_id:'a',max:'1'},{order_item_id:'a',max:'2'}],['a','b'],3]
 ])('fail closed on incomplete, over-counted, or foreign input',(rows,ids,units)=>{
  expect(()=>plan(rows,ids,units)).toThrow(/G6_RELAY_RECEIPT_/);
 });
 test('Chromium fills its validated exact payload; keeps physical PostgreSQL oracle',()=>{
  const s=fs.readFileSync(path.join(__dirname,'../../scripts/recette/g6-canonical-relay-receipt-chromium.js'),'utf8');
  expect(s).toContain('planFullReceiptLines(rows,{itemIds:ITEMS,totalUnits:SC.units})');
  expect(s).toContain('String(expectedLines[i].received_qty)');
  expect(s).toContain('const expected={proof_ref:PROOF,lines:expectedLines}');
  expect(s).not.toContain("humanFill(null,field.nth(i),'1')");
  expect(s).toContain("after.items.every(i=>Number(i.qty_received)===SC.units");
  expect(s).toContain("after.receipts.length===SC.items");
 });
});
