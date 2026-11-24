/** @komerce-arch-lite
 * @role g6-m06-handover-plan
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Validate the packed direct M06 COMBOX and shipment prerequisites before Hub handover.
 * @impact-areas staging-only
 */
'use strict';
const text=value=>typeof value==='string'?value.trim():'';
function fail(code){throw Error(code);}
function buildM06HandoverPlan(s,{forwarderName,transportMode,proofRef}={}){
 if(!s||typeof s!=='object')fail('G6_M06_HANDOVER_STATE_REQUIRED');
 const forwarder=text(forwarderName),mode=text(transportMode).toLowerCase(),proof=text(proofRef);
 if(forwarder.length<2||forwarder.length>160||!['sea','air'].includes(mode)||proof.length<6||proof.length>500)
  fail('G6_M06_HANDOVER_OPERATOR_FACTS_REQUIRED');
 if(s.scenario_id!=='M06'||s.market!=='KM'||s.simulation_scope!=='G6-BUYER'||
   s.payment_status!=='paid'||s.po_status!=='hub_received'||s.product_ref!=='KPR-000255'||
   s.procure_on_order!==true||s.fulfillment_source!=='IMPORT'||
   Number(s.order_quantity)!==3||Number(s.received_quantity)!==3)
  fail('G6_M06_HANDOVER_ORDER_INVALID');
 if(Number(s.payment_authorization_count)!==1||Number(s.external_payment_rows)!==0||
   Number(s.settlement_rows)!==0||Number(s.local_stock_allocations_count)!==0)
  fail('G6_M06_HANDOVER_FINANCE_INVALID');
 if(!s.box_id||s.box_reference!=='G6-M06-COMBOX-'+s.order_reference||
   s.box_unit_type!=='MARKET_PARCEL'||s.box_state!=='PACKED'||
   Number(s.box_placement_count)!==3||Number(s.box_placement_quantity)!==3||
   Number(s.box_label_scan_count)!==3)
  fail('G6_M06_HANDOVER_COMBOX_INVALID');
 if(Number(s.customer_bag_count)!==0)fail('G6_M06_HANDOVER_LEGACY_BAG_PRESENT');
 if(Number(s.parcel_count)!==1||s.parcel_status!=='preparation'||
   Number(s.parcel_item_count)!==1||Number(s.parcel_item_quantity)!==3||
   Number(s.parcel_qty_shipped)!==0)fail('G6_M06_HANDOVER_CLIENT_PARCEL_INVALID');
 if(Number(s.shipment_count)!==0||Number(s.shipment_link_count)!==0||
   Number(s.box_custody_dispatch_count)!==0)fail('G6_M06_HANDOVER_ALREADY_STARTED');
 return Object.freeze({order_id:s.order_id,order_reference:s.order_reference,po_id:s.po_id,
  box_id:s.box_id,box_reference:s.box_reference,allocation_id:s.allocation_id,
  parcel_id:s.parcel_id,quantity:3,forwarder_name:forwarder,transport_mode:mode,
  proof_ref:proof,source:'OPERATOR_SUPPLIED_STAGING_HANDOVER_FACTS'});
}
module.exports={buildM06HandoverPlan};
