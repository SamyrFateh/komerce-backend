/**
 * @komerce-arch
 * @role          catalog-publication-decision-audit
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        catalog_publication_decision, authenticated_actor, before_after_snapshots
 * @outputs       append_only_catalog_publication_decision_audit
 * @depends       caller supplied db executor
 * @used-by       services/catalog-approval.js
 * @db-read       none
 * @db-write      catalog_publication_decision_audit
 * @db-txn        caller_owned_same_transaction_as_catalog_decision
 * @doctrine      human_publication_decision_must_be_audited, audit_is_fact_not_authority
 * @impact-areas  catalog, admin-dashboard, audit
 * @version       2026-10
 */

'use strict';

function decisionSnapshot(product) {
  return Object.freeze({
    product_ref: product && product.product_ref || null,
    lifecycle_status: product && product.lifecycle_status || null,
    is_active: Boolean(product && product.is_active),
    is_available: Boolean(product && product.is_available),
    needs_review: Boolean(product && product.needs_review),
    content_source: product && product.content_source || null,
  });
}

async function recordCatalogPublicationDecision(q, {
  action,
  productId,
  productRef,
  actor = null,
  sourceSurface = 'catalog_approval',
  reason = null,
  overriddenFields = [],
  before,
  after,
}) {
  if (!q || typeof q.query !== 'function') throw new Error('catalog_publication_decision_audit_query_required');
  const { rows: [row] } = await q.query(
    `INSERT INTO catalog_publication_decision_audit
       (action, product_id, product_ref, actor_user_id, actor_role, source_surface,
        reason, overridden_fields, before_snapshot, after_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)
     RETURNING id, created_at`,
    [
      action,
      productId,
      productRef,
      actor && actor.id || null,
      actor && actor.role || null,
      actor && actor.source_surface || sourceSurface,
      reason == null ? null : String(reason).trim().slice(0, 1000),
      Array.isArray(overriddenFields) ? overriddenFields : [],
      JSON.stringify(decisionSnapshot(before)),
      JSON.stringify(decisionSnapshot(after)),
    ]
  );
  return row || null;
}

module.exports = { decisionSnapshot, recordCatalogPublicationDecision };
