/** @komerce-arch-lite
 * @role g6-canonical-final-mile-proof-boundary
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Cross-check fresh M01 customs, relay and pickup prerequisites without historical order fixtures.
 * @impact-areas staging-only
 */
'use strict';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const REFERENCE=/^[A-Z0-9][A-Z0-9-]{5,63}$/;
const POLICIES=Object.freeze({
 CUSTOMS:Object.freeze({priorStage:'FORWARDER',nextStage:'CUSTOMS',
  reportVerdict:'G6_FORWARDER_SIMULATED_CHROMIUM_PG_PASS_ARRIVED',
  shipmentStage:'arrived',parcelStatus:'shipped',eventKeys:['forwarder_received','tracking','in_transit','arrived']}),
 RELAY_RECEIPT:Object.freeze({priorStage:'CUSTOMS_LOCAL',nextStage:'RELAY_RECEIPT',
  reportVerdict:'G6_CUSTOMS_LOCAL_SIMULATED_CHROMIUM_PG_PASS',
  shipmentStage:'local_delivery',parcelStatus:'shipped',
  eventKeys:['customs_create','customs_link','customs_amount','customs_released','local_delivery']}),
 CLIENT_PICKUP:Object.freeze({priorStage:'RELAY_RECEIPT',nextStage:'CLIENT_PICKUP',
  reportVerdict:'G6_RELAY_RECEIPT_SIMULATED_CHROMIUM_PG_PASS_AVAILABLE',
  shipmentStage:'relay_received',parcelStatus:'available',eventKeys:['relay-receipt']})
});
function validateFinalMileCheckpoint(stageId,previous,prior){
 const policy=POLICIES[stageId];
 if(!policy)throw Error('G6_FINAL_MILE_STAGE_UNKNOWN');
 const reference=previous?.order?.reference,orderId=previous?.order?.id,poId=previous?.po_id;
 const db=previous?.db_fingerprint,shipmentId=prior?.shipment_id,parcelId=prior?.parcel_id||prior?.after?.base?.parcels?.[0]?.id;
 const base=prior?.after?.base;
 const record=previous?.stages?.find(s=>s.id===policy.priorStage&&
  s.verdict==='PASS_SIMULATED_STAGING'&&s.shipment_id===shipmentId);
 const eventKeys=prior?.events?.map(x=>x.key);
 const eventHttp=stageId==='RELAY_RECEIPT'?[201,200,200,200,200]:stageId==='CLIENT_PICKUP'?[201]:[200,200,200,200];
 const uuidFields=[orderId,poId,shipmentId,parcelId];
 if(previous?.scenario_id!=='M01'||previous?.market!=='KM'||
    previous?.verdict!=='NOT_PROVEN'||previous?.full_chain_certified!==false||
    previous?.production_permitted!==false||previous?.next_stage!==policy.nextStage||
    !REFERENCE.test(String(reference||''))||
    !uuidFields.every(x=>UUID.test(String(x||'')))||
    !String(db||'').trim()||!record||
    prior?.verdict!==policy.reportVerdict||prior?.order_id!==orderId||
    prior?.shipment_id!==shipmentId||prior?.db_fingerprint!==db||
    prior?.provenance!=='SIMULATED / STAGING ONLY'||
    prior?.external_supplier_calls!==0||prior?.external_payment_executed!==false||
    !Array.isArray(eventKeys)||eventKeys.length!==policy.eventKeys.length||
    !eventKeys.every((k,i)=>k===policy.eventKeys[i]&&prior.events[i].http===eventHttp[i])||
    base?.shipments?.length!==1||base.shipments[0].id!==shipmentId||
    base.shipments[0].stage!==policy.shipmentStage||
    base.parcels?.length!==1||base.parcels[0].id!==parcelId||
    base.parcels[0].status!==policy.parcelStatus)
  throw Error('G6_FINAL_MILE_PROVENANCE_INVALID_'+stageId);
 if(stageId==='CUSTOMS'&&(
    prior?.role!=='agent_transitaire'||!prior?.after?.tracking?.arrived_at||
    !/^SIM-STAGING-TRK-[A-Z0-9-]{6,}$/.test(String(prior.after.tracking.tracking_reference||''))||
    base.box?.length!==1||!UUID.test(String(base.box[0].id||''))||base.box[0].state!=='DISPATCHED'||
    base.bag?.length!==1||!UUID.test(String(base.bag[0].id||''))||
    base.effective?.length!==1||!UUID.test(String(base.effective[0].allocation_id||''))||
    Number(base.effective[0].quantity)!==1))
  throw Error('G6_FINAL_MILE_CUSTOMS_PHYSICAL_INVALID');
 if(stageId==='RELAY_RECEIPT'&&(
    base.box?.length!==1||!UUID.test(String(base.box[0].id||''))||
    base.box[0].state!=='DISPATCHED'||prior?.after?.linked!==true||
    prior?.after?.customs?.length!==1))
  throw Error('G6_FINAL_MILE_RELAY_CUSTOMS_INVALID');
 if(stageId==='CLIENT_PICKUP'&&(
    prior?.schema!=='komerce-g6-relay-receipt/1'||prior.events[0].role!=='agent_relais'||
    prior?.assignment?.via!=='Chromium_UI'||prior.assignment.http!==200||
    prior?.after?.orders?.length!==1||prior.after.orders[0].id!==orderId||
    prior.after.orders[0].status!=='available'||prior?.after?.receipts?.length!==1||
    Number(prior.after.receipts[0].received_qty)!==1||
    prior.after.receipts[0].incident_id!==null))
  throw Error('G6_FINAL_MILE_PICKUP_RELAY_INVALID');
 return Object.freeze({orderId,reference,poId,dbFingerprint:db,shipmentId,parcelId,
  boxId:base.box?.[0]?.id||null,bagId:base.bag?.[0]?.id||null,
  allocationId:base.effective?.[0]?.allocation_id||null,
  stage:stageId,verdict:'NOT_PROVEN',execution_authorized:false});
}
module.exports={validateFinalMileCheckpoint};
