/**
 * @komerce-arch
 * @role          sourcing-candidate-import-owner
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        catalog_import_candidate, full_snapshot_context
 * @outputs       persisted_candidate, archive_count
 * @depends       none
 * @used-by       services/suppliers/catalog-import-orchestrator.js
 * @db-read       sourcing_candidates
 * @db-write      sourcing_candidates, sourcing_candidate_events
 * @db-txn        caller_owned
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  sourcing, catalog
 * @version       2026-08
 */

'use strict';

/**
 * Lifecycle-owner boundary for catalog import writes into sourcing candidates.
 *
 * The catalog orchestrator keeps connector/normalization/eligibility orchestration,
 * while this sourcing-owned service is the only place that persists the candidate
 * lifecycle facts produced by that import.
 *
 * q is deliberately injected so callers keep their existing pool/client and
 * transaction semantics unchanged.
 */

async function upsertCandidateFromCatalogImport(q, {
  importId,
  supplierName,
  product,
  normalized,
  normalizedSourceContract,
  scan,
  verdict,
  autoState,
  autoRejectedReason,
  userId,
}) {
  const scanJson = JSON.stringify({
    ...scan.scan_result,
    sourcing_decision: scan.sourcing_decision,
    reason: scan.reason,
    recommended_action: scan.recommended_action,
    eligibility: verdict,
  });
  const incomingDataSources = JSON.stringify(normalized.data_sources);

  const upsertRes = await q.query(
    `INSERT INTO sourcing_candidates (
       import_id, supplier_name, supplier_product_id,
       product_name, supplier_category, purchase_price, currency,
       image_url, product_url, description,
       stock_available, min_order_qty, supplier_delay_days,
       weight_kg, dim_l_cm, dim_w_cm, dim_h_cm,
       komerce_category, estimated_weight_kg, estimated_volume_m3,
       purchase_price_kmf, target_margin_pct,
       data_sources, scan_result, scan_at, confidence,
       state, rejected_reason, updated_by, raw_payload,
       normalized_source_contract
     ) VALUES (
       $1, $2, $3,
       $4, $5, $6, $7,
       $8, $9, $10,
       $11, $12, $13,
       $14, $15, $16, $17,
       $18, $19, $20,
       $21, $22,
       $23::jsonb, $24, NOW(), $25,
       $26, $27, $28, $29::jsonb,
       $30::jsonb
     )
     ON CONFLICT (supplier_name, supplier_product_id)
       WHERE supplier_product_id IS NOT NULL
     DO UPDATE SET
       import_id           = EXCLUDED.import_id,
       product_name        = EXCLUDED.product_name,
       supplier_category   = EXCLUDED.supplier_category,
       purchase_price      = CASE WHEN (sourcing_candidates.data_sources->>'purchase_price') = 'manual'
                                  THEN sourcing_candidates.purchase_price
                                  ELSE EXCLUDED.purchase_price END,
       currency            = CASE WHEN (sourcing_candidates.data_sources->>'purchase_price') = 'manual'
                                  THEN sourcing_candidates.currency
                                  ELSE EXCLUDED.currency END,
       purchase_price_kmf  = CASE WHEN (sourcing_candidates.data_sources->>'purchase_price') = 'manual'
                                  THEN sourcing_candidates.purchase_price_kmf
                                  ELSE EXCLUDED.purchase_price_kmf END,
       komerce_category    = CASE WHEN (sourcing_candidates.data_sources->>'category') = 'manual'
                                  THEN sourcing_candidates.komerce_category
                                  ELSE EXCLUDED.komerce_category END,
       estimated_weight_kg = CASE WHEN (sourcing_candidates.data_sources->>'weight') = 'manual'
                                  THEN sourcing_candidates.estimated_weight_kg
                                  ELSE EXCLUDED.estimated_weight_kg END,
       estimated_volume_m3 = CASE WHEN (sourcing_candidates.data_sources->>'volume') = 'manual'
                                  THEN sourcing_candidates.estimated_volume_m3
                                  ELSE EXCLUDED.estimated_volume_m3 END,
       target_margin_pct   = CASE WHEN (sourcing_candidates.data_sources->>'target_margin') = 'manual'
                                  THEN sourcing_candidates.target_margin_pct
                                  ELSE EXCLUDED.target_margin_pct END,
       image_url           = EXCLUDED.image_url,
       product_url         = EXCLUDED.product_url,
       description         = EXCLUDED.description,
       raw_payload         = EXCLUDED.raw_payload,
       normalized_source_contract = EXCLUDED.normalized_source_contract,
       stock_available     = EXCLUDED.stock_available,
       min_order_qty       = EXCLUDED.min_order_qty,
       supplier_delay_days = EXCLUDED.supplier_delay_days,
       weight_kg           = EXCLUDED.weight_kg,
       dim_l_cm            = EXCLUDED.dim_l_cm,
       dim_w_cm            = EXCLUDED.dim_w_cm,
       dim_h_cm            = EXCLUDED.dim_h_cm,
       data_sources        = sourcing_candidates.data_sources || EXCLUDED.data_sources,
       scan_result         = EXCLUDED.scan_result,
       scan_at             = NOW(),
       confidence          = EXCLUDED.confidence,
       state               = CASE WHEN sourcing_candidates.state IN ('imported_to_catalog', 'rejected')
                                  THEN sourcing_candidates.state
                                  ELSE EXCLUDED.state END,
       rejected_reason     = CASE WHEN sourcing_candidates.state IN ('imported_to_catalog', 'rejected')
                                  THEN sourcing_candidates.rejected_reason
                                  ELSE EXCLUDED.rejected_reason END,
       updated_by          = EXCLUDED.updated_by
     RETURNING *, (xmax <> 0) AS was_updated`,
    [
      importId, supplierName, product.supplier_product_id || null,
      product.product_name, product.supplier_category || null, product.purchase_price || null, product.currency || 'AED',
      product.image_url || null, product.product_url || null, product.description || null,
      product.stock_available || null, product.min_order_qty || null, product.supplier_delay_days || null,
      product.weight_kg || null, product.dimensions?.l_cm || null, product.dimensions?.w_cm || null, product.dimensions?.h_cm || null,
      normalized.komerce_category, normalized.estimated_weight_kg, normalized.estimated_volume_m3,
      normalized.purchase_price_kmf, normalized.target_margin_pct,
      incomingDataSources, scanJson, scan.confidence,
      autoState, autoRejectedReason, userId || null,
      product.raw_payload ? JSON.stringify(product.raw_payload) : null,
      normalizedSourceContract ? JSON.stringify(normalizedSourceContract) : null,
    ]
  );

  const row = upsertRes.rows[0];
  const wasUpdated = row.was_updated;

  if (wasUpdated) {
    const manualSources = row.data_sources || {};
    const lockedFields = Object.entries(manualSources)
      .filter(([, value]) => value === 'manual')
      .map(([key]) => key);

    await q.query(
      `INSERT INTO sourcing_candidate_events
         (candidate_id, event_type, changes, notes, triggered_by)
       VALUES ($1, 'data_correction', $2, $3, $4)`,
      [
        row.id,
        JSON.stringify({ re_import: true, locked_manual_fields: lockedFields }),
        lockedFields.length
          ? `Re-import : ${lockedFields.join(', ')} conservé(s) (édition manuelle).`
          : 'Re-import sans champ manuel verrouillé.',
        userId || null,
      ]
    );
  }

  return { row, wasUpdated };
}

async function archiveMissingCandidatesFromCatalogImport(q, {
  supplierName,
  importedIds,
  userId,
  importId,
}) {
  const archiveRes = await q.query(
    `UPDATE sourcing_candidates
        SET state = 'archived', updated_by = $1
      WHERE supplier_name = $2
        AND supplier_product_id IS NOT NULL
        AND supplier_product_id <> ALL($3::text[])
        AND state NOT IN ('imported_to_catalog', 'rejected', 'archived')
      RETURNING id, supplier_product_id, state`,
    [userId || null, supplierName, importedIds]
  );

  for (const archived of archiveRes.rows) {
    await q.query(
      `INSERT INTO sourcing_candidate_events
         (candidate_id, event_type, old_state, new_state, notes, triggered_by)
       VALUES ($1, 'state_change', $2, 'archived', $3, $4)`,
      [
        archived.id,
        archived.state,
        `Absent du full-snapshot import ${importId}`,
        userId || null,
      ]
    );
  }

  return archiveRes.rows.length;
}

module.exports = {
  upsertCandidateFromCatalogImport,
  archiveMissingCandidatesFromCatalogImport,
};
