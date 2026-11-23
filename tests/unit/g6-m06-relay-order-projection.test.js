/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {hasExpectedRelayOrderRows}=require('../../scripts/recette/canonical/relay-order-projection-guard');
const root=path.resolve(__dirname,'../..');
const orderId='11111111-1111-4111-8111-111111111111',reference='G6-M06-RELAY-ORDER';
const base={id:orderId,reference,simulation_scope:'G6-BUYER',payment_status:'paid',
 po_status:'hub_received'};
const m06=(override={})=>({...base,sent_note:null,payment_authorizations:1,...override});
const legacy=(override={})=>({...base,sent_note:'[SIMULATED / STAGING ONLY] no external contact',
 payment_authorizations:0,...override});
const check=(rows,scenario,expectedRows=rows.length)=>hasExpectedRelayOrderRows(rows,{
 orderId,reference,expectedRows,scenario
});

describe('M06 relay: manual purchasing authorization is not supplier notification',()=>{
 test('accepts one received manual-PO line, with one separate internal authorization and no supplier note',()=>{
  expect(check([m06()],'M06',1)).toBe(true);
 });
 test('rejects missing or extra authorization, false supplier-notification shape, and foreign order',()=>{
  for(const change of [
   {payment_authorizations:0},{payment_authorizations:2},
   {sent_note:'[SIMULATED / STAGING ONLY] fake supplier notification'},
   {id:'foreign-order'},{reference:'FOREIGN'},{payment_status:'pending'},
   {po_status:'notified'},{simulation_scope:null}
  ])expect(check([m06(change)],'M06',1)).toBe(false);
  expect(check([m06(),m06()],'M06',2)).toBe(false);
  expect(check([m06()],'M06',2)).toBe(false);
  expect(check([m06()],'UNKNOWN',1)).toBe(false);
 });
 test('does not broaden original M01/M03 zero-authorization notification contract',()=>{
  expect(check([legacy()],'M01',1)).toBe(true);
  expect(check([legacy(),legacy(),legacy()],'M03',3)).toBe(true);
  expect(check([m06()],'M01',1)).toBe(false);
  expect(check([m06(),m06(),m06()],'M03',3)).toBe(false);
  expect(check([legacy()],'M06',1)).toBe(false);
 });
 test('Chromium relay receipt uses actual scenario and keeps physical and PostgreSQL oracles',()=>{
  const script=fs.readFileSync(path.join(root,'scripts/recette/g6-canonical-relay-receipt-chromium.js'),'utf8');
  expect(script).toContain('expectedRows:SC.items,scenario:env.G6_CANONICAL_SCENARIO');
  expect(script).toContain("before.base.shipments[0].stage==='local_delivery'");
  expect(script).toContain("before.base.parcels[0].status==='shipped'");
  expect(script).toContain("after.base.shipments[0].stage==='relay_received'");
  expect(script).toContain("after.base.parcels[0].status==='available'");
  expect(script).toContain("Number(r.received_qty)===SC.units");
 });
});
