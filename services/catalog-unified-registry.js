/**
 * @komerce-arch
 * @role          unified-catalog-operator-read
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        read-only catalog filters
 * @outputs       single candidate/product projection, counts and safe next steps
 * @depends       db.js
 * @db-read       products, sourcing_candidates, boutique_categories, boutique_subcategories, catalog_field_overrides, catalog_publication_decision_audit, catalog_media
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
        sc.purchase_price_kmf, sc.komerce_category,
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
        (sc.scan_result->'commercial_review'->>'status'='PENDING_CLASSIFICATION') AS source_category_review_required,
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
        (EXISTS (
          SELECT 1 FROM catalog_publication_decision_audit d
           WHERE d.product_id=p.id
             AND d.action IN ('CATALOG_PRODUCT_APPROVED','CATALOG_PRODUCT_OVERRIDDEN_AND_APPROVED')
             AND NOT EXISTS (
               SELECT 1 FROM catalog_publication_decision_audit later
                WHERE later.product_id=p.id
                  AND (later.created_at, later.id) > (d.created_at, d.id)
             )
        )) AS approval_audited,
        (NULLIF(BTRIM(p.image_url),'') IS NULL
         AND NULLIF(BTRIM(sc.image_url),'') IS NOT NULL) AS supplier_image_preview,
        (SELECT COUNT(*)::int FROM catalog_media cm
          WHERE cm.product_id=p.id AND cm.is_active=TRUE) AS active_media_count,
        (SELECT COUNT(*)::int FROM catalog_media cm
          WHERE cm.product_id=p.id) AS total_media_count,
        CASE WHEN jsonb_typeof(sc.normalized_source_contract->'media')='array'
           THEN jsonb_array_length(sc.normalized_source_contract->'media') ELSE 0 END AS source_media_count,
        (sc.state='imported_to_catalog'
          AND sc.normalized_source_contract->>'schema_version'='2'
          AND jsonb_typeof(sc.normalized_source_contract->'media')='array'
          AND CASE WHEN jsonb_typeof(sc.normalized_source_contract->'media')='array'
            THEN jsonb_array_length(sc.normalized_source_contract->'media')>0 ELSE FALSE END
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(CASE
              WHEN jsonb_typeof(sc.normalized_source_contract->'media')='array'
              THEN sc.normalized_source_contract->'media' ELSE '[]'::jsonb END) m
            WHERE jsonb_typeof(m) <> 'object'
              OR NULLIF(BTRIM(m->>'supplier_media_id'),'') IS NULL
              OR m->>'url' NOT LIKE 'https://%'
          )
        ) AS source_media_repairable,
        sc.purchase_price_kmf,
        sc.komerce_category AS economic_category_key,
        sc.scan_result->>'variable_cost_complete_kmf' AS variable_cost_complete_kmf,
        sc.scan_result->>'minimum_safe_price_kmf' AS minimum_safe_price_kmf,
        sc.scan_result->>'test_price_kmf' AS test_price_kmf,
        sc.scan_result->>'economic_test_health_status' AS economic_test_health_status,
        p.updated_at
   FROM products p
   LEFT JOIN picked_source sc ON sc.product_id=p.id
   LEFT JOIN boutique_categories bc
     ON bc.key=p.boutique_category_key AND bc.is_active=TRUE
   LEFT JOIN boutique_subcategories bs
     ON bs.category_key=bc.key AND bs.key=p.boutique_subcategory_key
    AND bs.is_active=TRUE
   -- Only retired RCT1 source-backed fixtures are excluded: exact paired
   -- identities plus test supplier and both disabled flags, never real drafts.
   WHERE NOT COALESCE((
     p.is_active=FALSE AND p.is_available=FALSE
     AND sc.supplier_name='RCT1-FICTIF-recette'
     AND (p.product_ref,sc.supplier_product_id) IN (
       ('KSC-000180','RCT1-P1'), ('KSC-000181','RCT1-P2'),
       ('KSC-000182','RCT1-P3'), ('KSC-000183','RCT1-P4'),
       ('KSC-000184','RCT1-P5')
     )
   ), FALSE)
 UNION ALL
 SELECT 'candidate'::text, NULL::text, sc.candidate_ref,
        sc.product_name, sc.description, NULL::text, NULL::text,
        sc.image_url, NULL::text, NULL::text, sc.supplier_name,
        sc.supplier_product_id, sc.supplier_category, sc.product_name,
        sc.description, sc.product_url, sc.state,
        sc.scan_result->>'sourcing_decision', sc.confidence,
        (sc.scan_result->'commercial_review'->>'status'='PENDING_CLASSIFICATION'),
        (sc.normalized_source_contract IS NOT NULL
          AND NULLIF(BTRIM(sc.supplier_name),'') IS NOT NULL
          AND NULLIF(BTRIM(sc.supplier_product_id),'') IS NOT NULL),
        NULL::boolean, NULL::boolean,
        NULL::text, NULL::text, NULL::text, NULL::text,
        NULL::text, FALSE, FALSE, FALSE, FALSE,
        0::int,
        0::int,
        CASE WHEN jsonb_typeof(sc.normalized_source_contract->'media')='array'
          THEN jsonb_array_length(sc.normalized_source_contract->'media') ELSE 0 END,
        FALSE,
        sc.purchase_price_kmf,
        sc.komerce_category,
        sc.scan_result->>'variable_cost_complete_kmf',
        sc.scan_result->>'minimum_safe_price_kmf',
        sc.scan_result->>'test_price_kmf',
        sc.scan_result->>'economic_test_health_status',
        sc.updated_at
   FROM sourcing_candidates sc
  WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.id=sc.product_id)
), marked AS (
 SELECT u.*,
   CASE
     WHEN u.record_kind='candidate' AND u.candidate_state IN ('rejected','archived')
       THEN 'excluded'
     WHEN u.record_kind='candidate' AND u.candidate_state='imported_to_catalog'
       THEN 'handoff_missing'
     WHEN u.record_kind='candidate' AND u.source_category_review_required
       THEN 'sourcing_category_review'
     WHEN u.record_kind='candidate' AND
       (u.candidate_state='watchlist' OR
        UPPER(COALESCE(u.sourcing_decision,'')) IN ('WATCH','AVOID','LOSS'))
       THEN 'sourcing_deferred'
     WHEN u.record_kind='candidate' AND u.candidate_state IN ('scanned','test_ready')
       THEN 'sourcing_review'
     WHEN u.record_kind='candidate' THEN 'processing'
     -- Prior catalogue activation of a candidate requires lineage review.
     -- A lifecycle='active' item with is_active=FALSE can be an intentional
     -- soft deactivation (product-admin-service.deleteProduct).
     WHEN u.is_active=TRUE AND u.lifecycle_status='candidate'
       THEN 'activation_to_reconcile'
     WHEN u.lifecycle_status='rejected' THEN 'excluded'
     WHEN NOT u.source_ready THEN 'source_to_normalize'
     WHEN NOT u.taxonomy_ready THEN 'taxonomy_to_confirm'
     WHEN NOT u.editorial_ready THEN 'editorial_to_complete'
     WHEN COALESCE(u.active_media_count,0)=0 THEN 'media_to_complete'
     WHEN u.lifecycle_status='candidate' THEN 'approval_pending'
     WHEN u.is_active=TRUE AND u.lifecycle_status='active' AND u.approval_audited
       THEN 'catalog_approved'
     WHEN u.is_active=TRUE AND u.lifecycle_status='active' THEN 'approval_unproven'
     -- Correction achevée ≠ activation. Un produit déjà approuvé mais
     -- volontairement désactivé n'est PAS un produit « à compléter ».
     WHEN u.lifecycle_status='active' AND u.approval_audited
       THEN 'catalog_approved_inactive'
     -- Même sans approbation historique, l'absence d'anomalie de contenu
     -- relève d'une revue de preuve, pas de la file de correction.
     WHEN u.lifecycle_status='active' THEN 'approval_to_review'
     ELSE 'approval_to_review'
   END AS work_status
 FROM unified u
), operator_view AS (
 SELECT m.*,
   -- Only an explicit operator decision, not an import/scan/proof status.
   CASE WHEN (m.record_kind='candidate' AND m.work_status IN
      ('sourcing_category_review','sourcing_review'))
      OR (m.record_kind='product' AND m.work_status IN
      ('taxonomy_to_confirm','editorial_to_complete','approval_pending'))
      THEN TRUE ELSE FALSE END AS requires_arbitration,
   CASE
     WHEN m.work_status IN ('catalog_approved','catalog_approved_inactive') THEN 'validated'
     WHEN m.work_status='excluded' THEN 'excluded'
     WHEN m.work_status IN ('processing','sourcing_deferred') THEN 'processing'
     WHEN m.work_status IN ('approval_pending','approval_unproven','approval_to_review','sourcing_review') THEN 'review'
     ELSE 'correction'
   END AS operator_group
 FROM marked m
)
`;

// Diagnostics only: neither the API nor the browser may turn a scan
// recommendation into a market selling price.
function positiveKmf(value) {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function publicRow(row) {
  const candidate = row.record_kind === 'candidate';
  const issues = [];
  // Null readiness for pre-handoff is NOT an operator defect. Sourcing still
  // owns source qualification; absence of a finished scan is not a human task.
  if (candidate && row.work_status === 'handoff_missing') issues.push('handoff_missing');
  if (candidate && row.work_status === 'sourcing_category_review')
    issues.push('sourcing_economic_category_missing');
  if (!candidate) {
    if (row.work_status === 'activation_to_reconcile') issues.push('activation_to_reconcile');
    if (!row.source_ready) issues.push('source_to_normalize');
    if (!row.taxonomy_ready) issues.push('taxonomy_to_confirm');
    if (!row.editorial_ready) issues.push('editorial_to_complete');
    if (row.active_media_count != null && Number(row.active_media_count) < 1)
      issues.push('media_missing');
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
    active_media_count: row.active_media_count == null ? null : Number(row.active_media_count),
    total_media_count: row.total_media_count == null ? null : Number(row.total_media_count),
    source_media_count: row.source_media_count == null ? null : Number(row.source_media_count),
    media_status: candidate ? 'pre_handoff'
      : (Number(row.active_media_count) > 0 ? 'canonical_ready'
        : (Number(row.total_media_count) > 0 ? 'canonical_inactive_review'
          : (row.source_media_repairable === true ? 'source_recoverable'
          : (Number(row.source_media_count) > 0 ? 'source_requires_review'
            : (row.image_url ? 'preview_only' : 'source_missing'))))),
    supplier_name: row.supplier_name || null,
    supplier_product_id: row.supplier_product_id || null,
    supplier_category: row.supplier_category || null,
    supplier_name_original: row.supplier_name_original || null,
    supplier_description: row.supplier_description || null,
    product_url: row.product_url || null,
    candidate_state: row.candidate_state || null,
    sourcing_decision: row.sourcing_decision || null,
    sourcing_confidence: row.sourcing_confidence || null,
    source_category_review_required: row.source_category_review_required === true,
    economic_category_key: row.economic_category_key || null,
    purchase_price_kmf: positiveKmf(row.purchase_price_kmf),
    variable_cost_complete_kmf: positiveKmf(row.variable_cost_complete_kmf),
    minimum_safe_price_kmf: positiveKmf(row.minimum_safe_price_kmf),
    test_price_kmf: positiveKmf(row.test_price_kmf),
    economic_test_health_status: row.economic_test_health_status || 'unknown',
    approval_audited: row.approval_audited === true,
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
    requires_arbitration: row.requires_arbitration === true ||
      (row.requires_arbitration == null &&
        ((candidate && ['sourcing_category_review','sourcing_review'].includes(row.work_status)) ||
         (!candidate && ['taxonomy_to_confirm','editorial_to_complete','approval_pending'].includes(row.work_status)))),
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
  // The workflow counts must stay stable when a user selects one status.
  // Search, supplier and taxonomy still scope the counts; status only scopes
  // the page rows, so switching tabs does not make other tabs read "0".
  const groupWhere = filters.length ? ' WHERE ' + filters.join(' AND ') : '';
  const groupValues = [...values];
  const status = ['arbitration','correction','review','validated','processing','excluded']
    .includes(query.status) ? query.status : null;
  if (status === 'arbitration') filters.push('requires_arbitration IS TRUE');
  else if (status) add(status, 'operator_group = ?');
  const pageWhere = filters.length ? ' WHERE ' + filters.join(' AND ') : '';
  const [counts, list] = await Promise.all([
    executor.query(UNIFIED_CTE + '\nSELECT operator_group, COUNT(*)::int AS count, ' +
      'COUNT(*) FILTER (WHERE requires_arbitration)::int AS arbitration_count FROM operator_view' +
      groupWhere + ' GROUP BY operator_group', groupValues),
    executor.query(UNIFIED_CTE + '\nSELECT * FROM operator_view' + pageWhere +
      '\nORDER BY CASE operator_group WHEN \'correction\' THEN 0 WHEN \'review\' THEN 1' +
      ' WHEN \'processing\' THEN 2 WHEN \'validated\' THEN 3 ELSE 4 END,' +
      ' updated_at DESC NULLS LAST, COALESCE(product_ref,candidate_ref) ASC' +
      ' LIMIT $' + (values.length + 1) + ' OFFSET $' + (values.length + 2),
      [...values, limit, offset]),
  ]);
  const groups = { correction: 0, review: 0, validated: 0, processing: 0, excluded: 0 };
  let arbitrations = 0;
  for (const item of counts.rows) {
    arbitrations += Number(item.arbitration_count) || 0;
    if (Object.prototype.hasOwnProperty.call(groups, item.operator_group))
      groups[item.operator_group] = Number(item.count) || 0;
  }
  const total = status === 'arbitration' ? arbitrations
    : status ? groups[status] : Object.values(groups).reduce((sum, n) => sum + n, 0);
  return {
    products: list.rows.map(publicRow),
    groups,
    arbitrations,
    page: { total, limit, offset, has_previous: offset > 0,
      has_next: offset + list.rows.length < total },
  };
}

module.exports = { listUnified, publicRow };
