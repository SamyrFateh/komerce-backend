/**
 * @komerce-arch
 * @role          supplier-payment-review-reader
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        supplier_payment_current_state, optional_limit, optional_market_lineage, database_query_interface
 * @outputs       canonical_supplier_payment_review_population
 * @depends       db.js
 * @used-by       services/dashboard-finance-canonical.js, services/signal-service.js
 * @db-read       supplier_execution_payments, purchase_lines, order_items, orders
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_PAYMENT_FACT.md
 * @impact-areas  purchasing, finance, decision-signals, admin-dashboard
 * @version       2026-10
 */
'use strict';

const db = require('../db');

const REVIEW_PREDICATE = `status IN ('ambiguous', 'rejected') OR reconciliation_status = 'mismatched'`;

function normalizeLimit(raw) {
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return 50;
  return Math.min(100, Math.floor(parsed));
}

async function getSupplierPaymentReview(options = {}, q = db) {
  const limit = normalizeLimit(options.limit === undefined ? 50 : options.limit);
  const includeInternalIdentity = options.include_internal_identity === true;
  const marketId = options.market_id || null;
  const params = [];
  let marketClause = '';

  if (marketId) {
    params.push(marketId);
    marketClause = `
      AND EXISTS (
        SELECT 1
        FROM purchase_lines pl
        JOIN order_items oi ON oi.id = pl.order_item_id
        JOIN orders o ON o.id = oi.order_id
        WHERE pl.purchase_order_id = supplier_execution_payments.purchase_order_id
          AND pl.cancelled_at IS NULL
          AND o.market_id = ${params.length}
      )`;
  }

  let limitClause = '';
  if (limit != null) {
    params.push(limit);
    limitClause = `LIMIT ${params.length}`;
  }

  const { rows } = await q.query(`
    SELECT
      id AS payment_id,
      purchase_order_id,
      provider,
      payment_ref,
      expected_amount::text AS expected_amount,
      observed_amount::text AS observed_amount,
      currency,
      status,
      reconciliation_status,
      real_debit_verified,
      created_at,
      updated_at,
      COUNT(*) OVER()::int AS total_count,
      CASE
        WHEN status = 'ambiguous' THEN 'PAYMENT_AMBIGUOUS_RECONCILIATION_REQUIRED'
        WHEN status = 'rejected' THEN 'PAYMENT_REJECTED_REVIEW_REQUIRED'
        WHEN reconciliation_status = 'mismatched' THEN 'PAYMENT_RECONCILIATION_MISMATCH'
        ELSE NULL
      END AS review_reason
    FROM supplier_execution_payments
    WHERE ${REVIEW_PREDICATE}
      ${marketClause}
    ORDER BY updated_at DESC, id DESC
    ${limitClause}
  `, params);

  const count = rows.length ? Number(rows[0].total_count) || 0 : 0;
  const items = rows.map(row => Object.freeze({
    ...(includeInternalIdentity ? { payment_id: row.payment_id } : {}),
    purchase_order_id: row.purchase_order_id,
    provider: row.provider,
    payment_ref: row.payment_ref || null,
    expected_amount: row.expected_amount,
    observed_amount: row.observed_amount,
    currency: row.currency,
    status: row.status,
    reconciliation_status: row.reconciliation_status,
    real_debit_verified: row.real_debit_verified === true,
    review_reason: row.review_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
    drill_to: `/admin/workspaces/purchasing?po=${encodeURIComponent(row.purchase_order_id)}`,
  }));

  return Object.freeze({
    count,
    items: Object.freeze(items),
    truncated: count > items.length,
    basis: marketId ? 'current_state_all_time_market_lineage' : 'current_state_all_time',
  });
}

module.exports = {
  REVIEW_PREDICATE,
  normalizeLimit,
  getSupplierPaymentReview,
};
