/** @test-kind unit @test-runner jest @test-requires none */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {checkM06UnitScanCustody,checkM06UnitScanLineage}=
 require('../../scripts/recette/canonical/m06-unit-scan-custody');
const boxId='box-M06',allocationId='allocation-M06',units=3;
const placementIds=['p1','p2','p3'];
function makeSnapshot(){
 return {
  placement:placementIds.map(id=>({
   placement_id:id,physical_unit_id:boxId,allocation_id:allocationId,
   quantity:1,operation_type:'REPACK',evidence_method:'SCAN',created_by:'agent-hub'
  })),
  effective:placementIds.map(id=>({
   placement_id:id,box_unit_id:boxId,bag_unit_id:null,allocation_id:allocationId,quantity:1
  }))
 };
}
const context={boxId,allocationId,units,placementIds};
const prove=s=>checkM06UnitScanLineage(s,context);
const fault=(mutate,code='G6_M06_DIRECT_BOX_CUSTODY_INVALID')=>{
 const s=makeSnapshot();mutate(s);expect(()=>prove(s)).toThrow(code);
};

describe('M06 direct COMBOX: 3 independently scanned units, never a legacy aggregate',()=>{
 test('certifies exactly 3 independent SCAN placements and effective links',()=>{
  const s=makeSnapshot();
  expect(checkM06UnitScanCustody(s,context)).toEqual(placementIds);
  expect(prove(s)).toBeUndefined();
 });
 test('rejects old one-row MANUAL quantity=3 aggregate',()=>{
  fault(s=>{
   s.placement=[{...s.placement[0],quantity:3,evidence_method:'MANUAL'}];
   s.effective=[{...s.effective[0],quantity:3}];
  });
 });
 test('rejects a missing scanned unit',()=>{
  fault(s=>s.placement.pop());
  fault(s=>s.effective.pop(),'G6_M06_DIRECT_BOX_LINEAGE_INVALID');
 });
 test('rejects a fourth unexpected placement or effective link',()=>{
  fault(s=>s.placement.push({...s.placement[2],placement_id:'p4'}));
  fault(s=>s.effective.push({...s.effective[2],placement_id:'p4'}),'G6_M06_DIRECT_BOX_LINEAGE_INVALID');
 });
 test('rejects duplicate unit identity even when there are three rows',()=>{
  fault(s=>s.placement[2].placement_id='p1');
  fault(s=>s.effective[2].placement_id='p1','G6_M06_DIRECT_BOX_LINEAGE_INVALID');
 });
 test('rejects fake scan or a quantity differing from 1',()=>{
  fault(s=>s.placement[0].evidence_method='MANUAL');
  fault(s=>s.placement[1].quantity=2);
  fault(s=>s.placement[0].operation_type='RECEIVE');
  fault(s=>s.placement[2].created_by=null);
 });
 test('rejects article moved to a different COMBOX or allocation',()=>{
  fault(s=>s.placement[1].physical_unit_id='other-box');
  fault(s=>s.placement[1].allocation_id='other-allocation');
 });
 test('rejects effective lineage not matching physical scanned placement',()=>{
  fault(s=>s.effective[1].placement_id='invented','G6_M06_DIRECT_BOX_LINEAGE_INVALID');
  fault(s=>s.effective[1].quantity=2,'G6_M06_DIRECT_BOX_LINEAGE_INVALID');
  fault(s=>s.effective[1].box_unit_id='other-box','G6_M06_DIRECT_BOX_LINEAGE_INVALID');
  fault(s=>s.effective[1].allocation_id='other-allocation','G6_M06_DIRECT_BOX_LINEAGE_INVALID');
  fault(s=>s.effective[1].bag_unit_id='old-bag','G6_M06_DIRECT_BOX_LINEAGE_INVALID');
  fault(s=>delete s.effective[1].bag_unit_id,'G6_M06_DIRECT_BOX_LINEAGE_INVALID');
 });
 test('rejects unknown or duplicated expected placement IDs',()=>{
  expect(()=>checkM06UnitScanLineage(makeSnapshot(),{...context,placementIds:['p1','p2','unknown']}))
   .toThrow('G6_M06_DIRECT_BOX_LINEAGE_INVALID');
  expect(()=>checkM06UnitScanLineage(makeSnapshot(),{...context,placementIds:['p1','p1','p3']}))
   .toThrow('G6_M06_DIRECT_BOX_LINEAGE_INVALID');
 });
 test('keeps M01/M03 historical MANUAL bag custody in independent branch',()=>{
  const runner=fs.readFileSync(path.resolve(__dirname,'../../scripts/recette/g6-hub-shipment-chromium.js'),'utf8');
  expect(runner).toContain("checkM06UnitScanCustody(s,{boxId:BOX,allocationId:ALLOCATION,units:SC.units})");
  expect(runner).toContain('checkM06UnitScanLineage(s,{boxId,allocationId:ALLOCATION,units:SC.units,placementIds})');
  expect(runner).toContain("p.evidence_method==='MANUAL'");
  expect(runner).toContain('s.links.length===1');
 });
});
