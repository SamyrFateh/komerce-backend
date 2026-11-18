/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.resolve(__dirname,'../../scripts/recette/g6-hub-shipment-chromium.js');
const source=fs.readFileSync(file,'utf8');
describe('G6 handover form repaint: no API shortcut or duplicate submit',()=>{
 test('script compiles and repairs only UI input values when PG says no handover',()=>{
  expect(()=>new vm.Script(source,{filename:file})).not.toThrow();
  expect(source).toContain('G6_HANDOVER_INVALID_FORM_UNSAFE_TO_REPAIR');
  expect(source).toContain('G6_HANDOVER_REFILL_PG_ALREADY_MUTATED');
  expect(source).toContain("current.shipments[0].stage==='hub_ready'");
  expect(source).toContain("current.parcelEvents.length===0");
  expect(source).toContain("current.shipmentEvents.length===1");
  expect(source).toContain("['forwarder_name','transport_mode','proof_ref'].includes(x.name)");
  expect(source).toContain("await humanFill(null,form.locator('[name=\"forwarder_name\"]'),FORWARDER)");
  expect(source).toContain("await humanSelect(null,form.locator('[name=\"transport_mode\"]'),'sea')");
  expect(source).toContain("await humanFill(null,form.locator('[name=\"proof_ref\"]'),HANDOVER_PROOF)");
 });
 test('repair precedes any button click and retries are strictly bounded',()=>{
  const start=source.indexOf("if(key==='handover-forwarder'){");
  const end=source.indexOf('const waitResponse=timeout',start);
  const block=source.slice(start,end);
  expect(block).toContain('for(let attempt=0;attempt<3&&!eligibility.valid;attempt++)');
  expect(block).toContain("refill_gesture:refillAttempts?'Chromium_UI_fill_only'");
  expect(block).not.toContain('button.click(');
  expect(block).not.toContain('route.continue()');
  expect(source).toContain('G6_HANDOVER_RETRY_NOT_SAFE');
  expect(source).not.toContain("page.request.post");
  expect(source).not.toContain("button.click({force:true})");
  expect(source).toContain('G6_SHIPMENT_HANDOVER_PG_INVALID');
 });
});
