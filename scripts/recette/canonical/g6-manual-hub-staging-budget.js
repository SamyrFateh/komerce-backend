/**
 * @komerce-arch-lite
 * @role g6-manual-hub-staging-indicative-budget-read-only
 * @domain purchasing
 * @layer test
 * @owner backend-core
 * @purpose Resolve a G6 staging-only indicative sourcing budget for a single manual Hub PO; never confirm vendor pricing.
 * @db-read purchase_orders, purchase_lines, order_items, orders, products, suppliers, sourcing_candidates
 * @impact-areas hub, purchasing, staging-only
 */
'use strict';

// This is NOT a supplier quotation, a confirmed price, a payment or a new source
// of purchase-line truth. It is a traceable, explicitly entered budget for the
// Director's *first* authorization on a simulated G6 M03 order only.
const SOURCE_KIND = 'central_hub_manual';
const fail = (code) => { throw new Error(code); };

function deriveIndicativeBudget(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    fail('G6_COMMITMENT_INDICATIVE_SOURCE_MISSING_OR_AMBIGUOUS');
  }
  const row = rows[0];
  if (row.source_kind !== SOURCE_KIND || row.system_key !== 'central_hub'
      || !row.sourcing_supplier_id || !row.po_supplier_id
      || !row.sourcing_product_id || !row.order_product_id
      || String(row.sourcing_supplier_id) !== String(row.po_supplier_id)
      || String(row.sourcing_product_id) !== String(row.order_product_id)
      || row.simulation_scope !== 'G6-BUYER'
      || !/^\[G6-HUB\]/.test(String(row.product_name || ''))
      || !String(row.candidate_ref || '').trim()
      || !String(row.product_ref || '').trim()) {
    fail('G6_COMMITMENT_INDICATIVE_SOURCE_IDENTITY_MISMATCH');
  }
  // Never override a supplier price already recorded on a purchase line.
  if (row.supplier_unit_price != null || row.supplier_currency != null) {
    fail('G6_COMMITMENT_INDICATIVE_SOURCE_NOT_REQUIRED');
  }
  const unit = Number(row.purchase_price);
  const qty = Number(row.quantity);
  const currency = String(row.currency || '').trim().toUpperCase();
  const amount = Number((unit * qty).toFixed(2));
  if (!Number.isFinite(unit) || !(unit > 0) || !Number.isSafeInteger(qty) || qty < 1
      || !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(amount) || amount <= 0) {
    fail('G6_COMMITMENT_INDICATIVE_SOURCE_INVALID_MONEY');
  }
  return {
    amount, currency, candidate_ref: String(row.candidate_ref),
    product_ref: String(row.product_ref), unit_amount: unit, quantity: qty,
    provenance: 'SOURCING_CANDIDATE_INDICATIVE_STAGING',
    confirmed_supplier_price: false,
    supplier_payment_authorized: false,
  };
}

async function loadIndicativeBudget(database, poId, orderId) {
  const { rows } = await database.query(`
    SELECT sc.candidate_ref, sc.purchase_price, sc.currency,
           sc.normalized_source_contract->>'source_kind' AS source_kind,
           sc.supplier_id::text AS sourcing_supplier_id,
           sc.product_id::text AS sourcing_product_id,
           pl.supplier_id::text AS po_supplier_id,
           pl.supplier_unit_price, pl.supplier_currency, pl.quantity,
           oi.product_id::text AS order_product_id,
           o.simulation_scope, p.product_ref, sc.product_name, s.system_key
      FROM purchase_orders po
      JOIN purchase_lines pl ON pl.purchase_order_id=po.id AND pl.cancelled_at IS NULL
      JOIN order_items oi ON oi.id=pl.order_item_id
      JOIN orders o ON o.id=oi.order_id
      JOIN products p ON p.id=oi.product_id
      JOIN suppliers s ON s.id=po.supplier_id AND s.id=pl.supplier_id
      JOIN sourcing_candidates sc ON sc.product_id=p.id AND sc.supplier_id=s.id
     WHERE po.id=$1 AND o.id=$2
     ORDER BY sc.created_at DESC, sc.id DESC
     LIMIT 2
  `, [poId, orderId]);
  return deriveIndicativeBudget(rows);
}
module.exports = { deriveIndicativeBudget, loadIndicativeBudget };
