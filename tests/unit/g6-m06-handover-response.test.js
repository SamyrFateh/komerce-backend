/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {assertM06HandoverResponse}=require('../../scripts/recette/canonical/m06-handover-response');
const root=path.resolve(__dirname,'../..');
const REF='G6-M06-EXP-EXAMPLE';
const valid=()=>({ok:true,result:{reference:REF,from_stage:'hub_ready',stage:'handed_over',client_parcels_shipped:[]}});

describe('M06 real shipment handover: canonical HTTP envelope',()=>{
 test('accepts only the exact successful transition and reference',()=>{
  expect(assertM06HandoverResponse(valid(),REF)).toMatchObject({
   reference:REF,from_stage:'hub_ready',stage:'handed_over'
  });
 });
 test('rejects nonexistent top-level stage, wrong shipment, incomplete transition or failed API',()=>{
  const bad=[
   {stage:'handed_over',reference:REF},
   {...valid(),ok:false},
   {ok:true,result:{...valid().result,reference:'OTHER'}},
   {ok:true,result:{...valid().result,from_stage:'handed_over'}},
   {ok:true,result:{...valid().result,stage:'forwarder_received'}},
   {ok:true,result:null},
  ];
  for(const payload of bad)expect(()=>assertM06HandoverResponse(payload,REF))
   .toThrow('G6_M06_HANDOVER_RESPONSE_INVALID');
  expect(()=>assertM06HandoverResponse(valid(),'')).toThrow('G6_M06_HANDOVER_RESPONSE_INVALID');
 });
 test('matches the route contract and keeps the actual UI gesture plus independent PG proof',()=>{
  const route=fs.readFileSync(path.join(root,'routes/admin-shipping-customs-workspace.js'),'utf8');
  const runner=fs.readFileSync(path.join(root,'scripts/recette/g6-m06-shipment-handover-chromium.js'),'utf8');
  expect(route).toContain('res.json({ok:true,result:await journey.transition');
  expect(runner).toContain("const result=await exactGesture(actor,'handover-forwarder'");
  expect(runner).toContain('assertM06HandoverResponse(result,SHIPMENT)');
  expect(runner).toContain("after.shipments[0].stage==='handed_over'");
  expect(runner).toContain("after.parcel_status==='shipped'");
  expect(runner).toContain("Number(after.parcel_qty_shipped)===3");
  expect(runner).toContain("'G6_M06_HANDOVER_POSTGRES_ORACLE_INVALID'");
  expect(runner).toContain("print-box-label");
  expect(runner).toContain("b.label_applied_confirmed===true");
  expect(runner).toContain("b.event_type==='HUB_HANDOVER'");
  expect(runner).toContain("hub_box_custody_scans");
 });
});
