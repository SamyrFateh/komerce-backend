/** @komerce-arch-lite
 * @role g6-m06-hub-receipt-http-contract
 * @domain logistics
 * @layer test
 * @owner backend-core
 * @purpose Validate the real completed-content supplier receiving API response without assuming an absent reconciliation_pending flag.
 * @impact-areas staging-only
 * @db-read none
 * @db-write none
 */
'use strict';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const fail=()=>{throw Error('G6_M06_RECEIPT_UI_HTTP_OR_RECONCILIATION_INVALID');};

/**
 * POST /api/scans/hub/receive with contents returns
 * {quarantined:false,unit:{state:'RECEIVED'},allocations:[{allocation,quantity}],operation_id}.
 * reconciliation_pending exists on the arrival-only route, not the complete-content route.
 * A valid POST still requires an independent read of PostgreSQL before certification.
 */
function validateM06ReceiptResponse({http,json,receiptRef,poId,orderId,skuId,quantity}={}){
 const unit=json?.unit;
 const allocations=json?.allocations;
 const row=Array.isArray(allocations)&&allocations.length===1?allocations[0]:null;
 const allocation=row?.allocation;
 const count=Number(quantity);
 if(![200,201].includes(http)||json?.quarantined!==false||
    json?.reconciliation_pending===true||!UUID.test(String(json?.operation_id||''))||
    !UUID.test(String(unit?.id||''))||unit?.reference!==receiptRef||
    !/^SUPPLIER_PACKAGE-[a-f0-9-]{36}$/i.test(String(unit?.reference||''))||
    unit?.unit_type!=='SUPPLIER_PACKAGE'||unit?.state!=='RECEIVED'||
    !row||!allocation||!UUID.test(String(allocation.id||''))||
    !Number.isSafeInteger(count)||count!==3||
    allocation.purchase_order_id!==poId||
    allocation.order_id!==orderId||
    allocation.product_sku_id!==skuId||
    Number(allocation.quantity)!==count||Number(row.quantity)!==count)
  fail();
 return Object.freeze({
  http,unit_id:unit.id,reference:unit.reference,unit_type:unit.unit_type,
  state:unit.state,allocation_id:allocation.id,received_quantity:count,
  reconciliation_pending:false,allocation_count:1,receipt_contract_valid:true,
  readback_required:true
 });
}
module.exports={validateM06ReceiptResponse};
