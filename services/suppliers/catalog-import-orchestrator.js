/**
 * @komerce-arch
 * @role          catalog-import-orchestrator
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        normalized_supplier_products, catalog_import_context
 * @outputs       sourcing_candidates, import_summary
 * @depends       db.js, services/supplier-catalog-scanner.js, services/pricing-engine.js, services/suppliers/normalized-product.js, services/suppliers/connectors/*
 * @used-by       routes/sourcing-scanner.js
 * @db-read       sourcing_candidates
 * @db-write      products, sourcing_candidate_events, sourcing_candidates, supplier_catalog_imports
 * @db-txn        resolve_before_behavior_change
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md
 * @impact-areas  catalog, product-detail
 * @version       2026-07
 */

'use strict';

/**
 * KOMERCE — Service orchestration import catalogue fournisseur
 *
 * Le connecteur produit un NormalizedSupplierProduct versionné. Le brut source
 * et, en V2, le snapshot du contrat NORMALISÉ sont persistés séparément :
 * `raw_payload` reste la source intégrale ; `normalized_source_contract`
 * conserve le mapping riche validé sans transformer ces faits en catalogue.
 */

const db = require('../../db');
const scanner = require('../supplier-catalog-scanner');
const pricingEngine = require('../pricing-engine');
const eligibility = require('../catalog-eligibility');
const { buildNormalizedSourceContractSnapshot } = require('./normalized-product');
const { getRuleNumber } = require('../../utils/rules');
const { importJsonCatalog } = require('./catalog-import-json');

/**
 * Agrège les raisons de rejet d'un tableau d'entrées invalides en compte par
 * raison — c'est la « ligne de synthèse » que lit le fondateur.
 */
function aggregateReasons(invalidArr) {
  const counts = {};
  for (const item of invalidArr || []) {
    const reasons = Array.isArray(item.errors)
      ? item.errors
      : (item.error ? [item.error] : ['raison inconnue']);
    for (const reason of reasons) {
      counts[reason] = (counts[reason] || 0) + 1;
    }
  }
  return counts;
}

/**
 * Importe un catalogue fournisseur : dispatch connecteur → normalisation →
 * éligibilité/scan → upsert sourcing_candidates → archivage optionnel.
 */
async function importCatalog(body, userId, dispatchToConnector) {
  const b = body || {};
  const supplierName = (b.supplier_name || '').trim();
  const sourceType = b.source_type || 'manual';

  if (!supplierName) {
    return { status: 400, body: { error: 'supplier_name requis' } };
  }
  if (!['csv', 'manual', 'api', 'json'].includes(sourceType)) {
    return { status: 400, body: { error: 'source_type doit être csv, manual, api ou json' } };
  }

  // ING-6 — la source JSON emprunte un chemin transactionnel dédié
  // (services/suppliers/catalog-import-json.js), volontairement séparé du
  // legacy ci-dessous : batch créé AVANT classification, staging
  // ready/quarantined/rejected, transaction propre. Le SQL et le
  // comportement legacy (csv/manual/api) ne sont ni lus ni modifiés par
  // cette branche — court-circuit avant tout appel à dispatchToConnector.
  if (sourceType === 'json') {
    return importJsonCatalog(b, userId);
  }

  // 1. Dispatcher vers le connecteur → NormalizedSupplierProduct[]
  let connectorResult;
  try {
    connectorResult = await dispatchToConnector(b);
  } catch (err) {
    return { status: 400, body: { error: err.message } };
  }

  const products = connectorResult.products || [];
  const invalidFromConnector = connectorResult.invalid || [];

  if (!products.length) {
    return {
      status: 400,
      body: { error: 'Aucun produit valide trouvé', invalid: invalidFromConnector },
    };
  }

  // ING-I4 : un fichier malade est refusé en bloc.
  const totalFromConnector = products.length + invalidFromConnector.length;
  const maxInvalidPct = await getRuleNumber('CATALOG_IMPORT_MAX_INVALID_PCT', 30);
  const invalidPct = totalFromConnector > 0
    ? (invalidFromConnector.length / totalFromConnector) * 100
    : 0;

  if (invalidPct > maxInvalidPct) {
    return {
      status: 400,
      body: {
        error: `Import refusé : fichier malade (${invalidPct.toFixed(1)}% invalides, seuil ${maxInvalidPct}%)`,
        total: totalFromConnector,
        accepted: products.length,
        rejected: invalidFromConnector.length,
        reject_reasons: aggregateReasons(invalidFromConnector),
        unmapped_columns: connectorResult.unmapped_columns || [],
      },
    };
  }

  // 2. Charger config Komerce + exclusions une fois.
  const config = await pricingEngine.loadGlobalConfig();
  const activeExclusions = await eligibility.loadActiveExclusions();

  // 3. Créer l'import.
  const importRes = await db.query(
    `INSERT INTO supplier_catalog_imports
       (supplier_name, source_type, source_filename, notes, total_items, imported_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [supplierName, sourceType, b.source_filename || null, b.notes || null, products.length, userId || null]
  );
  const importId = importRes.rows[0].id;

  // 4. Pour chaque NormalizedSupplierProduct : raffiner et persister.
  const results = { created: 0, errors: [...invalidFromConnector] };
  for (const product of products) {
    try {
      // PDC-1 : snapshot du mapping fournisseur → contrat normalisé. V1 = null.
      // On le construit AVANT le scanner : le scanner n'a pas le droit de
      // réinterpréter ou d'aplatir media/axes/unités vendables.
      const normalizedSourceContract = buildNormalizedSourceContractSnapshot(product);
      const normalized = await scanner.normalizeCandidate(product, { config });

      // ③ Éligibilité — avant pricing, sur la donnée SOURCE.
      const verdict = eligibility.checkEligibility(normalized, activeExclusions);
      const isAbsoluteExclusion = verdict?.layer === 'absolute';

      const scan = isAbsoluteExclusion
        ? {
            scan_result: null,
            sourcing_decision: 'EXCLUDED',
            reason: verdict.legal_note ? `${verdict.label} — ${verdict.legal_note}` : verdict.label,
            recommended_action: 'Ne pas importer — exclusion douane/légale.',
            confidence: normalized.confidence || 'low',
          }
        : await scanner.scanCandidate(normalized, { config });

      const autoState = isAbsoluteExclusion ? 'rejected' : 'scanned';
      const autoRejectedReason = isAbsoluteExclusion ? `[auto-exclusion] ${verdict.label}` : null;

      const scanJson = JSON.stringify({
        ...scan.scan_result,
        sourcing_decision: scan.sourcing_decision,
        reason: scan.reason,
        recommended_action: scan.recommended_action,
        eligibility: verdict,
      });
      const incomingDataSources = JSON.stringify(normalized.data_sources);

      const upsertRes = await db.query(
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
          // ING-I3 : source brute intégrale, non modifiée.
          product.raw_payload ? JSON.stringify(product.raw_payload) : null,
          // PDC-1 : mapping riche validé, séparé du brut. V1 reste NULL.
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

        await db.query(
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
        results.updated = (results.updated || 0) + 1;
      } else {
        results.created++;
      }
    } catch (errOne) {
      results.errors.push({ product_name: product.product_name || '?', error: errOne.message });
    }
  }

  // DSC-E3 — Archivage des candidats disparus, full snapshot uniquement.
  if (b.is_full_snapshot) {
    const importedIds = products
      .map((product) => product.supplier_product_id)
      .filter(Boolean);

    const archiveRes = await db.query(
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
      await db.query(
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

    results.archived = archiveRes.rows.length;
  }

  return {
    status: 200,
    body: {
      import_id: importId,
      supplier_name: supplierName,
      source_type: sourceType,
      total_items: products.length,
      created: results.created,
      updated: results.updated || 0,
      archived: results.archived || 0,
      errors: results.errors,
      accepted: results.created + (results.updated || 0),
      rejected: results.errors.length,
      reject_reasons: aggregateReasons(results.errors),
      unmapped_columns: connectorResult.unmapped_columns || [],
    },
  };
}

module.exports = { importCatalog, aggregateReasons };
