/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const forwarder=fs.readFileSync(path.join(root,'scripts/recette/g6-canonical-forwarder-chromium.js'),'utf8');
const adapter=fs.readFileSync(path.join(root,'scripts/recette/canonical/real-buyer-cash-adapters.js'),'utf8');

describe('M06 forwarder: parcel identity in real Chromium prior readback',()=>{
 test('binds the M06 parcel from the exact canonical stage environment',()=>{
  expect(forwarder).toContain('PARCEL=env.G6_CANONICAL_PARCEL_ID');
  expect(forwarder).toContain('prior.parcel_id===PARCEL&&prior.box_id===BOX');
  expect(forwarder).toContain("prior.after?.shipment_stage==='handed_over'");
  expect(forwarder).toContain("prior.after?.parcel_status==='shipped'");
  expect(adapter).toContain('G6_CANONICAL_PARCEL_ID:ids.parcel_id');
  expect(adapter).toContain('G6_CANONICAL_DB_FINGERPRINT:context.db_fingerprint');
 });
 test('keeps physical shipment and runtime/PG identity guards, without altering service or schema',()=>{
  expect(forwarder).toContain("checkShipment(base,ID,stage)");
  expect(forwarder).toContain("base.box[0].state==='DISPATCHED'");
  expect(forwarder).toContain('sameSet(base.effective.map(e=>e.placement_id),placement)');
  expect(forwarder).toContain("target.fingerprint===env.G6_CANONICAL_DB_FINGERPRINT");
  expect(forwarder).toContain("await runtime()");
  expect(forwarder).toContain("env.G6_CANONICAL_SCENARIO==='M06'");
 });
});
