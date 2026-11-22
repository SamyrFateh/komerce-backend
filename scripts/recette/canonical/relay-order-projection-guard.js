/**
 * @komerce-arch-lite
 * @role g6-relay-order-projection-guard
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Validate one order projected across one or many physical IMPORT purchase lines before relay receipt.
 * @impact-areas staging-only, logistics
 */
'use strict';

// readback().order joins orders -> order_items -> purchase_lines -> purchase_orders.
// It therefore returns one row per IMPORT purchase line, not one row per order.
// M01 has one row; M03 has three distinct PO lines for the same order.
function hasExpectedRelayOrderRows(rows,{orderId,reference,expectedRows}={}){
 if(!Number.isInteger(expectedRows)||expectedRows<1||!orderId||!reference||
   !Array.isArray(rows)||rows.length!==expectedRows)return false;
 return rows.every(row=>row&&row.id===orderId&&row.reference===reference&&
  row.simulation_scope==='G6-BUYER'&&row.payment_status==='paid'&&
  row.po_status==='hub_received'&&
  typeof row.sent_note==='string'&&row.sent_note.startsWith('[SIMULATED / STAGING ONLY]')&&
  Number(row.payment_authorizations)===0);
}
module.exports={hasExpectedRelayOrderRows};
