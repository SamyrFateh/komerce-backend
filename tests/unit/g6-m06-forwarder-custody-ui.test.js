/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const runnerPath=path.join(root,'scripts/recette/g6-canonical-forwarder-chromium.js');
const runner=fs.readFileSync(runnerPath,'utf8');
const journey=fs.readFileSync(path.join(root,'services/international-shipment-journey.js'),'utf8');
const custody=fs.readFileSync(path.join(root,'services/hub-box-custody-scans.js'),'utf8');
const ui=fs.readFileSync(path.join(root,'public/dashboards/canonical/js/international-journey-panel.js'),'utf8');

describe('M06 forwarder: explicit COMBOX scan required before each carrier transition',()=>{
 test('runner parses on Node before any staging order is written',()=>{
  const r=spawnSync(process.execPath,['--check',runnerPath],{encoding:'utf8',timeout:15000});
  expect(r.error).toBeUndefined();
  expect(r.status).toBe(0);
 });
 test('performs authorized CARRIER_ACCEPTED scan before forwarder_received',()=>{
  expect(runner).toContain("if(M06&&key==='forwarder_received')await scanCarrierBox(actor,'CARRIER_ACCEPTED',boxAlias)");
  expect(runner).toContain("'Transitaire · scanner et accepter chaque COMBOX'");
  expect(runner).toContain("await humanFill(null,item.locator");
  expect(runner).toContain("await humanSelect(null,item.locator('[name=\"confirmed\"]'),'yes')");
  expect(runner).toContain("const url=BASE+API+'/box-scan'");
  expect(runner).toContain('const pending=actor.page.waitForResponse');
  expect(runner).toContain('await humanClick(null,item.locator(\'button[type="submit"]\'))');
  expect(runner).toContain('response.status()===201');
  expect(runner).toContain('payload.result?.event_type===step');
 });
 test('performs separate CARRIER_LOADED scan before in_transit',()=>{
  expect(runner).toContain("if(M06&&key==='in_transit')await scanCarrierBox(actor,'CARRIER_LOADED',boxAlias)");
  expect(runner).toContain("'Transitaire · rescanner chaque COMBOX chargée dans le conteneur'");
  expect(runner).toContain("step==='CARRIER_ACCEPTED'?!accepted:!!accepted");
  expect(runner).toContain('latest.actor_id!==handover.actor_id');
  expect(runner).toContain('latest.actor_id===accepted.actor_id');
 });
 test('checks each custody scan with PostgreSQL and denies invented event or box',()=>{
  expect(runner).toContain('FROM hub_box_custody_scans c JOIN hub_scan_labels l ON l.id=c.label_id');
  expect(runner).toContain('after.length===prior.length+1');
  expect(runner).toContain('isDeepStrictEqual(after.slice(0,-1),prior)');
  expect(runner).toContain('latest.box_unit_id===BOX');
  expect(runner).toContain('latest.proof_ref===scanProof');
  expect(runner).toContain('actor.blocked.length===0');
  expect(runner).not.toMatch(/page\.request\.post\([^)]*box-scan/);
 });
 test('marine transport requires real UI container reference and explicit sealed attestation',()=>{
  expect(runner).toContain('container_reference:CONTAINER');
  expect(runner).toContain("container_sealed:'yes'");
  expect(runner).toContain('container_sealed:true');
  expect(runner).toContain("await humanSelect(null,item.locator('[name=\"container_sealed\"]'),value)");
  expect(runner).toContain("state.tracking.container_reference===CONTAINER");
  expect(journey).toContain("'JOURNEY_CONTAINER_REQUIRED'");
  expect(journey).toContain("'JOURNEY_CONTAINER_SEAL_REQUIRED'");
 });
 test('preserves server guards and two-party scan flow, not bypassed for M01/M03',()=>{
  expect(custody).toContain("CARRIER_ACCEPTED:{role:['admin','agent_transitaire'],stage:'handed_over',prior:'HUB_HANDOVER'}");
  expect(custody).toContain("CARRIER_LOADED:{role:['admin','agent_transitaire'],stage:'forwarder_received',prior:'CARRIER_ACCEPTED'}");
  expect(custody).toContain("'CUSTODY_DUAL_ACTOR_REQUIRED'");
  expect(journey).toContain("await custodyScans.requireScanCoverage(client,s.id,'CARRIER_ACCEPTED')");
  expect(journey).toContain("await custodyScans.requireScanCoverage(client,s.id,'CARRIER_LOADED')");
  expect(ui).toContain("CARRIER_ACCEPTED:'Transitaire · scanner et accepter chaque COMBOX'");
  expect(runner).toContain("M06?{tracking_reference:TRACK,container_reference:CONTAINER,proof_ref:proof('SUIVI')}:{tracking_reference:TRACK,proof_ref:proof('SUIVI')}");
 });
});
