/**
 * @komerce-arch
 * @role hub-supplier-receipt-quality
 * @domain logistics,purchasing
 * @layer service
 * @criticality high
 * @inputs server market and actor, PO, stable reference, explicit physical observations
 * @outputs immutable receipt and return attestations, canonical conforming placements
 * @depends services/hub-reception-quality-plan.js, services/hub-physical-identity.js
 * @used-by pending canonical route integration (#5298)
 * @db-read hub_supplier_receipt_checks, hub_supplier_receipt_check_lines, hub_supplier_return_attestations
 * @db-write hub_supplier_receipt_checks, hub_supplier_receipt_check_lines, hub_supplier_return_attestations
 * @db-txn caller-owned transaction; reference advisory lock then PO/line locks
 * @doctrine no_rejected_client_stock_no_implicit_supplier_return
 * @impact-areas logistics,purchasing
 * @version 2026-11-v1
 */
'use strict';
const crypto=require('node:crypto');
const {lockReceptionQualityPlan}=require('./hub-reception-quality-plan');
const physical=require('./hub-physical-identity');
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function fail(code,status=400){throw Object.assign(new Error(code),{code,status});}
function checkScope(client,marketId,actorId,reference){
  if(!client||typeof client.query!=='function'||!uuid.test(marketId||'')||!uuid.test(actorId||'')||
      typeof reference!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(reference))fail('HUB_SUPPLIER_CHECK_INVALID');
}
async function lockReference(client,kind,reference){
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[kind+':'+reference]);
}
function canonicalObservations(observations){
  if(!Array.isArray(observations)||observations.some(r=>!r||!uuid.test(r.product_sku_id||'')))fail('HUB_QUALITY_INPUT_INVALID');
  return observations.map(r=>({
    product_sku_id:r.product_sku_id.toLowerCase(),received_quantity:r.received_quantity,rejected_quantity:r.rejected_quantity,
    quantity_confirmed:r.quantity_confirmed===true,evidence_method:r.evidence_method||null,
    evidence_code:r.evidence_code||null,evidence_ref:r.evidence_ref||null
  })).sort((a,b)=>a.product_sku_id.localeCompare(b.product_sku_id));
}
function conformingContents(plan,observations,purchaseOrderId){
  const bySku=new Map(observations.map(r=>[r.product_sku_id,r]));
  return plan.lines.filter(l=>l.conforming_quantity>0).map(l=>{
    const r=bySku.get(l.product_sku_id),base={purchase_order_id:purchaseOrderId,product_sku_id:l.product_sku_id,quantity:l.conforming_quantity};
    if(r?.evidence_method==='SCAN'&&typeof r.evidence_code==='string'&&r.evidence_code.trim()&&!r.evidence_ref)
      return {...base,evidence_code:r.evidence_code};
    if(r?.evidence_method==='MANUAL'&&typeof r.evidence_ref==='string'&&r.evidence_ref.trim().length>=6&&!r.evidence_code)
      return {...base,evidence_method:'MANUAL',evidence_ref:r.evidence_ref};
    fail('HUB_QUALITY_PHYSICAL_EVIDENCE_REQUIRED');
  });
}
// Caller MUST own a transaction; no catch/commit on a failed canonical receipt.
async function observeSupplierReceipt(client,{purchaseOrderId,marketId,actorId,reference,observations,physicalConfirmed}={}){
  checkScope(client,marketId,actorId,reference);
  if(!uuid.test(purchaseOrderId||'')||physicalConfirmed!==true)fail('HUB_QUALITY_PHYSICAL_CONFIRMATION_REQUIRED');
  const normalized=canonicalObservations(observations);
  const hash=crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  await lockReference(client,'supplier-check',reference);
  const {rows:[prior]}=await client.query('SELECT * FROM hub_supplier_receipt_checks WHERE reference=$1',[reference]);
  if(prior){
    if(prior.market_id!==marketId||prior.purchase_order_id!==purchaseOrderId||prior.observation_hash!==hash)fail('HUB_SUPPLIER_CHECK_REFERENCE_CONFLICT',409);
    return {check:prior,replayed:true};
  }
  const plan=await lockReceptionQualityPlan(client,{purchaseOrderId,marketId,observations:normalized});
  const contents=conformingContents(plan,normalized,purchaseOrderId);
  let unitId=null,allocations=[];
  if(contents.length){
    const result=await physical.receiveSupplierPackage(client,{reference:'V3-'+reference,actorId,contents});
    if(result.quarantined||!result.unit?.id)fail('HUB_QUALITY_CONFORMING_RECEIPT_REFUSED',409);
    unitId=result.unit.id;allocations=result.allocations;
    await physical.transitionPhysicalUnit(client,{unitId,toState:'IDENTIFIED',actorId,details:{operator_action:'quality_v3_identified',check_reference:reference}});
    await physical.transitionPhysicalUnit(client,{unitId,toState:'QUALITY_CHECKED',actorId,details:{operator_action:'quality_v3_checked',check_reference:reference}});
  }
  const {rows:[check]}=await client.query(
    'INSERT INTO hub_supplier_receipt_checks(reference,purchase_order_id,market_id,observed_by,observation_hash,conforming_unit_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [reference,purchaseOrderId,marketId,actorId,hash,unitId]);
  for(const line of plan.lines)await client.query(
    'INSERT INTO hub_supplier_receipt_check_lines(check_id,product_sku_id,expected_quantity,received_quantity,rejected_quantity) VALUES($1,$2,$3,$4,$5)',
    [check.id,line.product_sku_id,line.expected_quantity,line.received_quantity,line.rejected_quantity]);
  return {check,plan,allocations,replayed:false};
}
async function attestSupplierReturn(client,{checkLineId,marketId,actorId,reference,quantity,physicalConfirmed}={}){
  checkScope(client,marketId,actorId,reference);
  if(!uuid.test(checkLineId||'')||!Number.isSafeInteger(quantity)||quantity<1||physicalConfirmed!==true)fail('HUB_SUPPLIER_RETURN_INVALID');
  await lockReference(client,'supplier-return',reference);
  const {rows:[line]}=await client.query(
    'SELECT l.id,l.rejected_quantity,c.market_id FROM hub_supplier_receipt_check_lines l JOIN hub_supplier_receipt_checks c ON c.id=l.check_id WHERE l.id=$1 AND c.market_id=$2 FOR UPDATE OF l',
    [checkLineId,marketId]);
  if(!line)fail('HUB_SUPPLIER_RETURN_SCOPE',404);
  const {rows:[prior]}=await client.query('SELECT * FROM hub_supplier_return_attestations WHERE reference=$1',[reference]);
  if(prior){
    if(prior.check_line_id!==checkLineId||Number(prior.quantity)!==quantity)fail('HUB_SUPPLIER_RETURN_REFERENCE_CONFLICT',409);
    return {attestation:prior,replayed:true};
  }
  const {rows:[total]}=await client.query('SELECT COALESCE(SUM(quantity),0) AS returned FROM hub_supplier_return_attestations WHERE check_line_id=$1',[checkLineId]);
  if(Number(total.returned)+quantity>Number(line.rejected_quantity))fail('HUB_SUPPLIER_RETURN_EXCEEDS_REJECTED',409);
  const {rows:[attestation]}=await client.query(
    'INSERT INTO hub_supplier_return_attestations(reference,check_line_id,quantity,returned_by) VALUES($1,$2,$3,$4) RETURNING *',
    [reference,checkLineId,quantity,actorId]);
  return {attestation,replayed:false};
}
module.exports={observeSupplierReceipt,attestSupplierReturn,conformingContents};
