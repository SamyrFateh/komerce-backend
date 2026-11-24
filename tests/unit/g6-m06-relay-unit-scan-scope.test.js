/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const relayPath=path.join(root,'scripts/recette/g6-canonical-relay-receipt-chromium.js');
const relay=fs.readFileSync(relayPath,'utf8');
const pickup=fs.readFileSync(path.join(root,'scripts/recette/g6-canonical-client-pickup-chromium.js'),'utf8');

describe('M06 relay scope retains 3 scanned physical units for one commercial line',()=>{
 test('relay Chromium runner parses before any staging writer',()=>{
  const res=spawnSync(process.execPath,['--check',relayPath],{encoding:'utf8',timeout:15000});
  expect(res.error).toBeUndefined();expect(res.status).toBe(0);
 });
 test('M06 reuses strict custody/lineage proof with three rows × quantity one',()=>{
  expect(relay).toContain("const {checkM06UnitScanLineage}=require('./canonical/m06-unit-scan-custody')");
  expect(relay).toContain('check(SC.items===1&&SC.units===3&&base.placement.length===SC.units');
  expect(relay).toContain('checkM06UnitScanLineage(base,{boxId:env.G6_CANONICAL_BOX_ID,');
  expect(relay).toContain('allocationId:env.G6_CANONICAL_ALLOCATION_ID,units:SC.units,');
  expect(relay).toContain('placementIds:base.placement.map(p=>p.placement_id)');
  expect(relay).toContain('base.effective.length===(M06?SC.units:SC.items)');
  expect(relay).toContain('base.effective.reduce((n,e)=>n+Number(e.quantity),0)===SC.units');
  expect(relay).not.toContain('base.effective.length===SC.items&&');
 });
 test('retains M01/M03 bag contract, and keeps relay actual receipt UI',()=>{
  expect(relay).toContain('M06?base.links.length===0&&base.effective.every(e=>e.bag_unit_id===null):base.links.length===1');
  expect(relay).toContain("check(await field.count()===SC.items");
  expect(relay).toContain('planFullReceiptLines(rows,{itemIds:ITEMS,totalUnits:SC.units})');
  expect(relay).toContain("await openRelayLive(actor.page,");
  expect(relay).toContain("before.receipts.length===0");
 });
 test('client pickup is already quantity-aware and still rejects duplicate handover',()=>{
  expect(pickup).toContain('Number(r.received_qty)===SC.units');
  expect(pickup).toContain('Number(l.qty_collected)===SC.units');
  expect(pickup).toContain('after.scans.length===1+PRE');
 });
});
