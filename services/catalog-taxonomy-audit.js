/**
 * @komerce-arch
 * @role          catalog-taxonomy-audit-boundary
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        taxonomy_mutation_fact, authenticated_actor, source_surface
 * @outputs       append_only_catalog_taxonomy_audit
 * @depends       db contract supplied by caller
 * @used-by       services/boutique-taxonomy-admin.js
 * @db-read       none
 * @db-write      catalog_taxonomy_audit
 * @db-txn        caller_owned_same_transaction_as_taxonomy_mutation
 * @doctrine      admin_mutation_must_be_audited, audit_is_fact_not_authority
 * @impact-areas  catalog, admin-dashboard, audit
 * @version       2026-10
 */

'use strict';

function publicActor(actor) {
  return {
    user_id: actor && actor.id ? actor.id : null,
    role: actor && actor.role ? actor.role : null,
  };
}

async function recordTaxonomyMutation(q, {
  action,
  entityType,
  categoryKey,
  subcategoryKey = null,
  actor = null,
  sourceSurface = 'catalog',
  before = null,
  after = null,
}) {
  if (!q || typeof q.query !== 'function') throw new Error('catalog_taxonomy_audit_query_required');
  const identity = publicActor(actor);
  const { rows: [row] } = await q.query(
    `INSERT INTO catalog_taxonomy_audit
       (action, entity_type, category_key, subcategory_key, actor_user_id, actor_role,
        source_surface, before_snapshot, after_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
     RETURNING id, created_at`,
    [
      action,
      entityType,
      categoryKey,
      subcategoryKey,
      identity.user_id,
      identity.role,
      sourceSurface,
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after),
    ]
  );
  return row || null;
}

module.exports = { publicActor, recordTaxonomyMutation };
