/**
 * @komerce-arch
 * @role          unified-catalog-operator-read
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        read-only catalog filters
 * @outputs       single candidate/product projection, counts and safe next steps
 * @depends       db.js
 * @db-read       products, sourcing_candidates, boutique_categories, boutique_subcategories, catalog_field_overrides
 * @db-write      none
 * @doctrine      one_operator_surface_without_cross_domain_write, product_ref_is_public_identity
 * @impact-areas  catalog, admin-dashboard
 * @version       2026-10
 */
'use strict';

const db = require('../db');

// ONE row per product, even if several sourcing observations point to it.
// An unhanded candidate stays identified by candidate_ref. Neither a supplier
// record nor an active legacy product disappears solely for lacking a handoff.
const UNIFIED_CTE = `
WITH picked_source AS (
 SELECT DISTINCT ON (sc.product_id)
        sc.product_id, sc.candidate_ref, sc.product_name, sc.description,
        sc.supplier_name, sc.supplier_product_id, sc.supplier_category,
        sc.image_url, sc.product_url, sc.normalized_source_contract,
        sc.state, sc.scan_result, sc.confidence, sc.updated_at
   FROM sourcing_candidates sc
  WHERE sc.product_id IS NOT NULL
  ORDER BY sc.product_id, (sc.state = 'imported_to_catalog') DESC,
           sc.updated_at DESC NULLS LAST, sc.id DESC
), unified AS (
 SELECT 'product'::text AS record_kind, p.product_ref, sc.candidate_ref,
        p.name, p.description, p.name_source, p.description_source,
        COALESCE(NULLIF(BTRIM(p.image_url), ''), NULLIF(BTRIM(sc.image_url), '')) AS image_url,
        p.source_locale, p.content_source, sc.supplier_name,
        sc.supplier_product_id, sc.supplier_category, sc.product_name AS supplier_name_original,
        sc.description AS supplier_description, sc.product_url,
        sc.state AS candidate_state, sc.scan_result->>'sourcing_decision' AS sourcing_decision,
        sc.confidence AS sourcing_confidence,
        (sc.normalized_source_contract IS NOT NULL
          AND NULLIF(BTRIM(sc.supplier_name),'') IS NOT NULL
          AND NULLIF(BTRIM(sc.supplier_product_id),'') IS NOT NULL) AS source_ready,
        (bc.key IS NOT NULL AND bs.key IS NOT NULL) AS taxonomy_ready,
        (((p.description IS NOT NULL AND BTRIM(p.description) <> '')
          OR EXISTS (SELECT 1 FROM catalog_field_overrides ov
                      WHERE ov.product_id = p.id AND ov.field_name='name'
                        AND ov.reason='KOMERCE_FR_SUFFICIENCY_ACCEPTED_V1'
                        AND ov.set_by IS NOT NULL AND ov.field_value=p.name))
          AND p.needs_review IS FALSE
          AND (COALESCE(p.content_source,'connector_raw') <> 'connector_raw'
               OR p.source_locale='fr' OR p.source_locale LIKE 'fr-%')) AS editorial_ready,
        p.boutique_category_key, p.boutique_subcategory_key,
        bc.label AS boutique_category_label, bs.label AS boutique_subcategory_label,
        p.lifecycle_status, p.is_active, p.needs_review,
        (NULLIF(BTRIM(p.image_url),'') IS NULL
         AND NULLIF(BTRIM(sc.image_url),'') IS NOT NULL) AS supplier_image_preview,
        p.updated_at
   FROM products p
   LEFT JOIN picked_source sc ON sc.product_id=p.id
   LEFT JOIN boutique_categories bc
     ON bc.key=p.boutique_category_key AND bc.is_active=TRUE
   LEFT JOIN boutique_subcategories bs
     ON bs.category_key=bc.key AND bs.key=p.boutique_subcategory_key
    AND bs.is_active=TRUE
 UNION ALL
 SELECT 'candidate'::text, NULL::text, sc.candidate_ref,
        sc.product_name, sc.description, NULL::text, NULL::text,
        sc.image_url, NULL::text, NULL::text, sc.supplier_name,
        sc.supplier_product_id, sc.supplier_category, sc.product_name,
        sc.description, sc.product_url, sc.state,
        sc.scan_result->>'sourcing_decision', sc.confidence,
        (sc.normalized_source_contract IS NOT NULL
          AND NULLIF(BTRIM(sc.supplier_name),'') IS NOT NULL
          AND NULLIF(BTRIM(sc.supplier_product_id),'') IS NOT NULL),
        NULL::boolean, NULL::boolean,
        NULL::text, NULL::text, NULL::text, NULL::text,
        NULL::text, FALSE, FALSE, FALSE, sc.updated_at
   FROM sourcing_candidates sc
  WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.id=sc.product_id)
), marked AS (
 SELECT u.*,
   CASE
     WHEN u.record_kind='candidate' AND u.candidate_state IN ('rejected','archived')
       THEN 'excluded'
     WHEN u.record_kind='candidate' AND u.candidate_state IN ('scanned','test_ready','watchlist')
       THEN 'sourcing_review'
     WHEN u.record_kind='candidate' THEN 'processing'
     WHEN u.lifecycle_status='rejected' THEN 'excluded'
     WHEN NOT u.source_ready THEN 'source_to_normalize'
     WHEN NOT u.taxonomy_ready THEN 'taxonomy_to_confirm'
     WHEN NOT u.editorial_ready THEN 'editorial_to_complete'
     WHEN u.lifecycle_status='candidate' THEN 'approval_pending'
     WHEN u.is_active=TRUE AND u.lifecycle_status='active' THEN 'catalog_approved'
     ELSE 'inactive'
   END AS work_status
 FROM unified u
), operator_view AS (
 SELECT m.*,
   CASE
     WHEN m.work_status='catalog_approved' THEN 'validated'
     WHEN m.work_status='excluded' THEN 'excluded'
     WHEN m.work_status='processing' THEN 'processing'
     WHEN m.work_status IN ('approval_pending','sourcing_review') THEN 'review'
     ELSE 'correction'
   END AS operator_group
 FROM marked m
)
`;

function publicRow(row) {
  const candidate = row.record_kind === 'candidate';
  const issues = [];
  // Null readiness for pre-handoff is NOT an operator defect. Sourcing still
  // owns source qualification; absence of a finished scan is not a human task.
  if (!candidate) {
    if (!row.source_ready) issues.push('source_to_normalize');
    if (!row.taxonomy_ready) issues.push('taxonomy_to_confirm');
    if (!row.editorial_ready) issues.push('editorial_to_complete');
    if (row.work_status === 'approval_pending' && !issues.length)
      issues.push('approval_pending');
  }
  return {
    record_kind: row.record_kind,
    product_ref: row.product_ref || null,
    candidate_ref: row.candidate_ref || null,
    name: row.name || null,
    description: row.description || null,
    name_source: row.name_source || null,
    description_source: row.description_source || null,
    image_url: row.image_url || null,
    supplier_image_preview: row.supplier_image_preview === true,
    supplier_name: row.supplier_name || null,
    supplier_product_id: row.supplier_product_id || null,
    supplier_category: row.supplier_category || null,
    supplier_name_original: row.supplier_name_original || null,
    supplier_description: row.supplier_description || null,
    product_url: row.product_url || null,
    candidate_state: row.candidate_state || null,
    sourcing_decision: row.sourcing_decision || null,
    sourcing_confidence: row.sourcing_confidence || null,
    source_locale: row.source_locale || null,
    content_source: row.content_source || null,
    boutique_category_key: row.boutique_category_key || null,
    boutique_subcategory_key: row.boutique_subcategory_key || null,
    boutique_category_label: row.boutique_category_label || null,
    boutique_subcategory_label: row.boutique_subcategory_label || null,
    lifecycle_status: row.lifecycle_status || null,
    is_active: row.is_active === true,
    needs_review: row.needs_review === true,
    work_status: row.work_status,
    operator_group: row.operator_group,
    issues,
    updated_at: row.updated_at || null,
  };
}

async function listUnified(query = {}, executor = db) {
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 50, 1), 100);
  const offset = Math.max(Number.parseInt(query.offset, 10) || 0, 0);
  const filters = [];
  const values = [];
  function add(value, expression) {
    if (!String(value || '').trim()) return;
    values.push(value);
    filters.push(expression.replace('?', '$' + values.length));
  }
  if (String(query.search || '').trim()) {
    values.push('%' + String(query.search).trim() + '%');
    const p = '$' + values.length;
    filters.push('(name ILIKE ' + p + ' OR product_ref ILIKE ' + p +
      ' OR candidate_ref ILIKE ' + p + ' OR supplier_product_id ILIKE ' + p + ')');
  }
  add(query.supplier, 'supplier_name = ?');
  add(query.category, 'boutique_category_key = ?');
  add(query.subcategory, 'boutique_subcategory_key = ?');
  if (['correction','review','validated','processing','excluded'].includes(query.status)) {
    add(query.status, 'operator_group = ?');
  }
  const where = filters.length ? ' WHERE ' + filters.join(' AND ') : '';
  // Both queries share the same scope and filters: server counts are never
  // estimated from just the current page.
  const [counts, list] = await Promise.all([
    executor.query(UNIFIED_CTE + '\nSELECT operator_group, COUNT(*)::int AS count FROM operator_view' +
      where + ' GROUP BY operator_group', values),
    executor.query(UNIFIED_CTE + '\nSELECT * FROM operator_view' + where +
      '\nORDER BY CASE operator_group WHEN \'correction\' THEN 0 WHEN \'review\' THEN 1' +
      ' WHEN \'processing\' THEN 2 WHEN \'validated\' THEN 3 ELSE 4 END,' +
      ' updated_at DESC NULLS LAST, COALESCE(product_ref,candidate_ref) ASC' +
      ' LIMIT $' + (values.length + 1) + ' OFFSET $' + (values.length + 2),
      [...values, limit, offset]),
  ]);
  const groups = { correction: 0, review: 0, validated: 0, processing: 0, excluded: 0 };
  for (const item of counts.rows) {
    if (Object.prototype.hasOwnProperty.call(groups, item.operator_group))
      groups[item.operator_group] = Number(item.count) || 0;
  }
  const total = Object.values(groups).reduce((sum, n) => sum + n, 0);
  return {
    products: list.rows.map(publicRow),
    groups,
    page: { total, limit, offset, has_previous: offset > 0,
      has_next: offset + list.rows.length < total },
  };
}

module.exports = { listUnified, publicRow };
