/**
 * @komerce-arch
 * @role          allegro-sandbox-manual-purchase-proof
 * @domain        purchasing
 * @layer         script
 * @criticality   high
 * @inputs        purchase_order_id, optional Allegro checkoutForm id
 * @outputs       discovered/verified supplier purchase reconciliation and PO confirmation
 * @depends       db.js, services/suppliers/allegro-purchase-reconciliation.js, services/purchasing-admin-service.js
 * @used-by       operator CLI / Golden E2E
 * @db-read       purchase_orders
 * @db-write      purchase_orders, orders (delegated confirmation snapshot)
 * @db-txn        delegated
 * @doctrine      docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md
 * @impact-areas  purchasing, supplier-integration, e2e
 */
'use strict';

const db = require('../db');
const reconciliation = require('../services/suppliers/allegro-purchase-reconciliation');
const { confirmPurchaseOrder } = require('../services/purchasing-admin-service');

function purchaseOrderId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new Error('PURCHASE_ORDER_ID_INVALID');
  }
  return id;
}

async function loadPurchaseOrder(dbImpl, id) {
  const { rows: [po] } = await dbImpl.query(`
    SELECT id, order_id, status, supplier_order_id, supplier_sku,
           supplier_unit_ref, supplier_order_identity, qty, product_sku_id,
           supplier_unit_price, supplier_currency, created_at
      FROM purchase_orders
     WHERE id = $1
  `, [id]);
  if (!po) throw new Error('PURCHASE_ORDER_NOT_FOUND');
  if (!po.product_sku_id || !po.supplier_unit_ref || !po.supplier_order_identity) {
    throw new Error('PURCHASE_ORDER_EXACT_IDENTITY_REQUIRED');
  }
  return po;
}

async function run(argv, {
  dbImpl = db,
  discover = reconciliation.discoverCheckoutForm,
  reconcile = reconciliation.reconcile,
  confirm = confirmPurchaseOrder,
} = {}) {
  if (!Array.isArray(argv) || argv.length < 1 || argv.length > 2) {
    throw new Error('Usage: node scripts/allegro-sandbox-purchase-proof.js PURCHASE_ORDER_ID [CHECKOUT_FORM_ID]');
  }
  const poId = purchaseOrderId(argv[0]);
  const po = await loadPurchaseOrder(dbImpl, poId);
  if (!['pending', 'notified', 'confirmed'].includes(po.status)) {
    throw new Error(`PURCHASE_ORDER_STATUS_NOT_RECONCILABLE:${po.status}`);
  }

  let checkoutFormId = String(argv[1] || po.supplier_order_id || '').trim().toLowerCase();
  let discovery = null;
  if (!checkoutFormId) {
    discovery = await discover({
      identity: po.supplier_order_identity,
      supplierUnitRef: po.supplier_unit_ref,
      supplierSku: po.supplier_sku,
      quantity: po.qty,
      expectedUnitPrice: po.supplier_unit_price,
      expectedCurrency: po.supplier_currency,
      boughtAtGte: po.created_at,
    });
    checkoutFormId = discovery.checkoutFormId;
  }

  const proof = await reconcile({
    checkoutFormId,
    identity: po.supplier_order_identity,
    supplierUnitRef: po.supplier_unit_ref,
    supplierSku: po.supplier_sku,
    quantity: po.qty,
  });

  if (po.status === 'confirmed') {
    if (po.supplier_order_id !== proof.supplier_order_id) {
      throw new Error('PURCHASE_ORDER_ALREADY_CONFIRMED_WITH_DIFFERENT_SUPPLIER_ORDER');
    }
    return {
      purchase_order_id: po.id,
      order_id: po.order_id,
      purchase_confirmed: true,
      already_confirmed: true,
      discovered_checkout_form: Boolean(discovery),
      proof,
    };
  }

  const confirmed = await confirm(po.id, po.order_id, {
    supplier_order_id: proof.supplier_order_id,
  });
  return {
    purchase_order_id: po.id,
    order_id: po.order_id,
    purchase_confirmed: true,
    already_confirmed: false,
    discovered_checkout_form: Boolean(discovery),
    purchase_order_status: confirmed?.purchase_order?.status || 'confirmed',
    proof,
  };
}

if (require.main === module) {
  run(process.argv.slice(2))
    .then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(async () => { await db.pool.end(); process.exit(process.exitCode || 0); });
}

module.exports = { purchaseOrderId, loadPurchaseOrder, run };
