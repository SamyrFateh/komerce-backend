/** @komerce-arch-lite
 * @role g6-m06-direct-box-custody-oracle
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Assert unit-by-unit SCAN custody and direct COMBOX lineage without masking missing or duplicate units.
 * @impact-areas staging-only, hub, logistics
 */
'use strict';

const check=(ok,code)=>{if(!ok)throw Error(code);};
const sameIds=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&
 new Set(a).size===a.length&&new Set(b).size===b.length&&
 JSON.stringify([...a].sort())===JSON.stringify([...b].sort());

function checkM06UnitScanCustody(s,{boxId,allocationId,units}){
 const rows=s?.placement;
 check(Number.isSafeInteger(units)&&units>0&&Array.isArray(rows)&&rows.length===units&&
  rows.every(p=>typeof p.placement_id==='string'&&p.placement_id.length>0&&
   p.physical_unit_id===boxId&&p.allocation_id===allocationId&&
   Number(p.quantity)===1&&p.operation_type==='REPACK'&&p.evidence_method==='SCAN'&&
   typeof p.created_by==='string'&&p.created_by.length>0)&&
  new Set(rows.map(p=>p.placement_id)).size===units,
  'G6_M06_DIRECT_BOX_CUSTODY_INVALID');
 return rows.map(p=>p.placement_id);
}

function checkM06UnitScanLineage(s,{boxId,allocationId,units,placementIds}){
 const actualIds=checkM06UnitScanCustody(s,{boxId,allocationId,units});
 const rows=s?.effective;
 check(sameIds(actualIds,placementIds)&&Array.isArray(rows)&&rows.length===units&&
  rows.every(p=>p.box_unit_id===boxId&&p.bag_unit_id===null&&
   p.allocation_id===allocationId&&Number(p.quantity)===1)&&
  sameIds(rows.map(p=>p.placement_id),actualIds),
  'G6_M06_DIRECT_BOX_LINEAGE_INVALID');
}

module.exports={checkM06UnitScanCustody,checkM06UnitScanLineage};
