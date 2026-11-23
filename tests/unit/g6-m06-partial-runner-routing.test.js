/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const {SCENARIO_STAGE_IDS,graphFor}=require('../../scripts/recette/canonical/stage-registry');
const adapter=fs.readFileSync(path.join(root,'scripts/recette/canonical/real-buyer-cash-adapters.js'),'utf8');
const workflow=fs.readFileSync(path.join(root,'.github/workflows/staging-g6-dynamic-fresh-buyer-cash.yml'),'utf8');
const expected=['BUYER','RELAY_CASH','HUB_PO','HUB_COMMITMENT',
 'M06_MANUAL_PURCHASE','M06_PAYMENT_AUTHORIZATION','M06_RECEIVING','M06_DIRECT_COMBOX','M06_SHIPMENT_HANDOVER','M06_FORWARDER','M06_CUSTOMS','M06_RELAY_RECEIPT','M06_CLIENT_PICKUP','M06_SAV_ORACLE'];
describe('M06 partial canonical runner wiring',()=>{
 test('routes through M06 SAV eligibility after pickup',()=>{
  expect(SCENARIO_STAGE_IDS.M06).toEqual(expected);
  expect(graphFor('M06').order).toEqual(expected);
  expect(graphFor('M06').byId.get('M06_MANUAL_PURCHASE').requires).toEqual(['HUB_COMMITMENT']);
  expect(graphFor('M06').byId.has('HUB_VENDOR_READINESS')).toBe(false);
  expect(graphFor('M06').byId.get('M06_PAYMENT_AUTHORIZATION').requires).toEqual(['M06_MANUAL_PURCHASE']);
  expect(graphFor('M06').byId.get('M06_SHIPMENT_HANDOVER').requires).toEqual(['M06_DIRECT_COMBOX']);
  expect(graphFor('M06').byId.get('M06_FORWARDER').requires).toEqual(['M06_SHIPMENT_HANDOVER']);
  expect(graphFor('M06').byId.get('M06_SAV_ORACLE').requires).toEqual(['M06_CLIENT_PICKUP']);
 });
 test('executes and verifies each M06 Chromium adapter with its own report',()=>{
  for(const id of expected.slice(4)){
   expect(adapter).toContain(id+':');
   expect(adapter).toContain('M06_FINAL_STAGES.includes(stageId)');
  }
 });
 test('dispatches KM M06 canonically but never treats routing as physical certification',()=>{
  const title='[staging-op] g6-dynamic-fresh-full-M06-KM';
  expect(workflow).toContain("github.event.issue.title == '"+title+"'");
  expect(workflow).toContain("contains(github.event.issue.title, '-full-M06-') && 'M06'");
  expect(workflow).toContain("github.event.issue.title == '"+title+"' && 'M06_SAV_ORACLE'");
  expect(workflow).toContain('node scripts/recette/g6-m06-input-preflight.js');
  expect(workflow.indexOf('node scripts/recette/g6-m06-input-preflight.js'))
   .toBeLessThan(workflow.indexOf('node scripts/recette/g6-dynamic-buyer-cash.js'));
  expect(workflow).not.toContain("g6-dynamic-fresh-full-M06-CM'");
  expect(workflow).not.toContain("g6-dynamic-fresh-full-M06-CG'");
  expect(workflow).toContain("github.event.issue.title == '[staging-op] g6-m06-rehearsal-KM'");
  expect(workflow).toContain('node scripts/recette/canonical/m06-staging-rehearsal-inputs.js');
 });
});
