/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('fs');
const path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../../scripts/recette/g6-p2-buyer-order-real-chromium.js'),'utf8');
describe('G6 staging real buyer axis selection',()=>{
 test('does not globally alternate available values of the same axis',()=>{
   expect(src).not.toContain('button[data-option-state="AVAILABLE"][data-option-value]:not([aria-pressed="true"])');
   expect(src).toContain("axisLocator.nth(axisIndex)");
   expect(src).toContain("axis.locator('button[data-option-state=\"AVAILABLE\"][aria-pressed=\"true\"]')");
   expect(src).toContain("axis.locator('button[data-option-state=\"AVAILABLE\"][data-option-value]')");
   expect(src).toContain('axisIndex++');
 });
 test('uses genuine Chromium pointer click and observes rerendered selected option',()=>{
   expect(src).toContain('await choice.click()');
   expect(src).toContain('await page.waitForFunction(({index,selectedValue})=>');
   expect(src).toContain("b.getAttribute('aria-pressed')==='true'");
   expect(src).toContain("throw Error('G6_NO_AVAILABLE_OPTION_IN_AXIS_'+axisKey)");
   expect(src).toContain("check(axisCount>0,'G6_VARIANT_AXES_NOT_RENDERED')");
 });
 test('fail closed if checkout does not persist a unique scoped cash order',()=>{
   expect(src).toContain("o.simulation_scope==='G6-BUYER'");
   expect(src).toContain("o.payment_mode==='cash_relais'");
   expect(src).toContain("o.products?.includes(REF)");
   expect(src).toContain("check(orders.length===1,'G6_EXACTLY_ONE_ORDER_NOT_SATISFIED')");
 });
});
