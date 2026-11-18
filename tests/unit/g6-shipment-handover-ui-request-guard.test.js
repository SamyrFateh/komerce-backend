/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const target=path.resolve(__dirname,'../../scripts/recette/g6-hub-shipment-chromium.js');
describe('G6 fresh Hub shipment handover: one safe UI commit only',()=>{
 const source=fs.readFileSync(target,'utf8');
 test('the runner compiles with real Chromium gesture only',()=>{
  expect(()=>new vm.Script(source,{filename:target})).not.toThrow();
  expect(source).toContain("G6_HANDOVER_FORM_INVALID");
  expect(source).toContain("handover_form_preflight");
  expect(source).toContain("handover_network_diagnostic");
  expect(source).toContain("G6_HANDOVER_UI_POST_NOT_EMITTED_");
  expect(source).toContain("await button.press('Enter',{timeout:10000})");
  expect(source).not.toContain("page.request.post");
  expect(source).not.toContain("button.click({force:true})");
 });
 test('a missing response never retries after a POST or an observed PG transition',()=>{
  const start=source.indexOf("if(!response&&key==='handover-forwarder'");
  const end=source.indexOf("  if(!response){",start);
  const block=source.slice(start,end);
  expect(block).toContain('count===0');
  expect(block).toContain('actor.blocked.length===0');
  expect(block).toContain("current.shipments[0].stage==='hub_ready'");
  expect(block).toContain("current.parcelEvents.length===0");
  expect(block).toContain("current.shipmentEvents.length===1");
  expect(block).toContain('G6_HANDOVER_RETRY_NOT_SAFE');
  expect(block).toContain("G6_HANDOVER_FORM_BECAME_INVALID");
  expect(block).toContain("await button.press('Enter'");
 });
 test('script still requires the entire handover PG oracle',()=>{
  expect(source).toContain('G6_SHIPMENT_HANDOVER_PG_INVALID');
  expect(source).toContain('G6_BOX_UNEXPECTED_UI_WRITE');
  expect(source).toContain('G6_DYNAMIC_PARTIAL_SHIPMENT_NEEDS_INDEPENDENT_RECONCILIATION');
 });
});