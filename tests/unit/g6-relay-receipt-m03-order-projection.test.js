/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const {hasExpectedRelayOrderRows}=require('../../scripts/recette/canonical/relay-order-projection-guard');

const orderId='11111111-1111-4111-8111-111111111111';
const reference='G6-ORDER-RELAY';
const row=(override={})=>({
 id:orderId,reference,simulation_scope:'G6-BUYER',payment_status:'paid',
 po_status:'hub_received',sent_note:'[SIMULATED / STAGING ONLY] no supplier contact',
 payment_authorizations:0,...override
});
const valid=(rows,count)=>hasExpectedRelayOrderRows(rows,{orderId,reference,expectedRows:count});

describe('G6 relay receipt: M01 and M03 order projection',()=>{
 test('M01: one import PO line belonging to exactly this order',()=>{
  expect(valid([row()],1)).toBe(true);
 });
 test('M03: three PO lines for ONE order must reach the relay UI',()=>{
  expect(valid([row(),row(),row()],3)).toBe(true);
 });
 test('rejects a projected line belonging to a foreign order',()=>{
  expect(valid([row(),row({id:'foreign-order'}),row()],3)).toBe(false);
 });
 test('rejects incomplete or extra projected lines, including duplicate rows',()=>{
  expect(valid([row(),row()],3)).toBe(false);
  expect(valid([row(),row(),row(),row()],3)).toBe(false);
  expect(valid([row(),row()],1)).toBe(false);
 });
 test('rejects a wrong reference, unpaid order or unreceived PO',()=>{
  expect(valid([row(),row({reference:'OTHER'}),row()],3)).toBe(false);
  expect(valid([row(),row({payment_status:'pending'}),row()],3)).toBe(false);
  expect(valid([row(),row({po_status:'confirmed'}),row()],3)).toBe(false);
 });
 test('rejects foreign simulation, supplier external contact and payment authorization',()=>{
  expect(valid([row({simulation_scope:null})],1)).toBe(false);
  expect(valid([row({sent_note:null})],1)).toBe(false);
  expect(valid([row({payment_authorizations:1})],1)).toBe(false);
 });
 test('rejects empty or invalid expected row counts',()=>{
  expect(valid([],1)).toBe(false);
  expect(valid([row()],0)).toBe(false);
  expect(valid([row()],NaN)).toBe(false);
 });
});
