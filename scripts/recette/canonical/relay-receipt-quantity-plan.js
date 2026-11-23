/** @komerce-arch-lite
 * @role g6-relay-receipt-quantity-plan
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Validate full receipt quantities from the actual Relais UI for M01 M03 and M06.
 * @impact-areas staging-only, logistics
 */
'use strict';
function planFullReceiptLines(rows,{itemIds,totalUnits}={}){
 if(!Array.isArray(rows)||!Array.isArray(itemIds)||!rows.length||
    rows.length!==itemIds.length||new Set(itemIds).size!==itemIds.length||
    !Number.isSafeInteger(totalUnits)||totalUnits<rows.length)
  throw Error('G6_RELAY_RECEIPT_QUANTITY_SCOPE_INVALID');
 const expected=new Set(itemIds),seen=new Set();
 const lines=rows.map(row=>{
  const id=row?.order_item_id;
  const qty=Number(row?.max);
  if(typeof id!=='string'||!expected.has(id)||seen.has(id)||
     row?.max===undefined||row?.max===null||String(row.max).trim()===''||
     !Number.isSafeInteger(qty)||qty<1)
   throw Error('G6_RELAY_RECEIPT_UI_QUANTITY_INVALID');
  seen.add(id);
  return {order_item_id:id,received_qty:qty};
 });
 if(seen.size!==expected.size||lines.reduce((n,line)=>n+line.received_qty,0)!==totalUnits)
  throw Error('G6_RELAY_RECEIPT_UI_TOTAL_INVALID');
 return lines;
}
module.exports={planFullReceiptLines};
