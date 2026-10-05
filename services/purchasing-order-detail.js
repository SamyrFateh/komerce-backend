/**
 * @komerce-arch
 * @role          purchasing-order-detail-reader
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        purchase_order_id, database_query_interface
 * @outputs       grouped_purchase_order_with_supplier_execution
 * @depends       db.js, services/purchasing-grouped-service.js
 * @used-by       routes/purchasing.js
 * @db-read       supplier_execution_orders, supplier_execution_order_lines, supplier_execution_groups, supplier_execution_group_members, supplier_execution_payments, supplier_execution_payment_proofs, supplier_execution_events, purchase_lines
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md
 * @impact-areas  purchasing, admin-dashboard
 * @version       2026-10
 */
'use strict';

const db = require('../db');
const { getGroupedPurchaseOrder } = require('./purchasing-grouped-service');

// One statement gives the execution collections a shared PostgreSQL snapshot.
// Explicit columns exclude raw facts/messages. Collections keep their identities:
// parent payments/proofs must never be repeated for each child or purchase line.
const EXECUTION_SQL = `
  SELECT jsonb_build_object(
    'orders', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at, r.id) FROM (
      SELECT id, provider, supplier_order_id, supplier_order_code, provider_status, created_at, updated_at
        FROM supplier_execution_orders WHERE purchase_order_id = $1
    ) r), '[]'::jsonb),
    'order_lines', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.supplier_execution_order_id, r.purchase_line_id) FROM (
      SELECT l.supplier_execution_order_id, l.purchase_line_id, l.quantity
        FROM supplier_execution_order_lines l
        JOIN supplier_execution_orders o ON o.id = l.supplier_execution_order_id
        JOIN purchase_lines pl ON pl.id = l.purchase_line_id
       WHERE o.purchase_order_id = $1 AND pl.purchase_order_id = $1
    ) r), '[]'::jsonb),
    'groups', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at, r.id) FROM (
      SELECT id, provider, supplier_parent_order_id, payment_ref, provider_status, payment_status, created_at, updated_at
        FROM supplier_execution_groups WHERE purchase_order_id = $1
    ) r), '[]'::jsonb),
    'group_members', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.supplier_execution_group_id, r.supplier_execution_order_id) FROM (
      SELECT m.supplier_execution_group_id, m.supplier_execution_order_id
        FROM supplier_execution_group_members m
        JOIN supplier_execution_groups g ON g.id = m.supplier_execution_group_id
        JOIN supplier_execution_orders o ON o.id = m.supplier_execution_order_id
       WHERE g.purchase_order_id = $1 AND o.purchase_order_id = $1 AND g.provider = o.provider
    ) r), '[]'::jsonb),
    'payments', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at, r.id) FROM (
      SELECT id, provider, payment_execution_key, supplier_execution_order_id, supplier_execution_group_id,
             payment_ref, expected_amount::text AS expected_amount, observed_amount::text AS observed_amount,
             currency, status, reconciliation_status, real_debit_verified, created_at, updated_at
        FROM supplier_execution_payments WHERE purchase_order_id = $1
    ) r), '[]'::jsonb),
    'proofs', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at, r.id) FROM (
      SELECT p.id, p.supplier_payment_id, p.provider, p.proof_source, p.proof_ref, p.provider_order_id,
             p.payment_ref, p.observed_amount::text AS observed_amount, p.currency, p.debit_confirmed,
             p.sandbox, p.simulated, p.occurred_at, p.created_at
        FROM supplier_execution_payment_proofs p
        JOIN supplier_execution_payments payment ON payment.id = p.supplier_payment_id
       WHERE payment.purchase_order_id = $1 AND payment.provider = p.provider
    ) r), '[]'::jsonb),
    'events', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at, r.id) FROM (
      SELECT id, provider, supplier_execution_order_id, supplier_execution_group_id, operation, outcome,
             provider_request_id, provider_code, created_at
        FROM supplier_execution_events WHERE purchase_order_id = $1
    ) r), '[]'::jsonb)
  ) AS execution
`;

/** Admin-only route keeps its guard; this reader grants no authority and performs no provider operation. */
async function getPurchaseOrderDetail(poId, q = db) {
  // Preserve UUID validation, 404 and rejection of historical POs before reading execution.
  const detail = await getGroupedPurchaseOrder(poId, q);
  const { rows: [{ execution }] } = await q.query(EXECUTION_SQL, [detail.purchase_order.id]);
  return { ...detail, supplier_execution: execution };
}

module.exports = { getPurchaseOrderDetail };
