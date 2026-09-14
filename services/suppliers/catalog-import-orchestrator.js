/**
 * @komerce-arch
 * @role          catalog-import-orchestrator
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        normalized_supplier_products, catalog_import_context
 * @outputs       sourcing_candidates, import_summary, shadow_observation_summary
 * @depends       db.js, services/supplier-catalog-scanner.js, services/pricing-engine.js, services/sourcing-candidate-import-service.js, services/sourcing-observation-shadow-service.js, services/suppliers/normalized-product.js, services/suppliers/connectors/*
 * @used-by       routes/sourcing-scanner.js
 * @db-read       none
 * @db-write      supplier_catalog_imports
 * @db-txn        resolve_before_behavior_change
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/doctrine/DOCTRINE_SOURCE_SHADOW_INGESTION.md
 * @impact-areas  catalog, product-detail, sourcing
 * @version       2026-09
 */

'use strict';

const db = require('../../db');
const scanner = require('../supplier-catalog-scanner');
const pricingEngine = require('../pricing-engine');
const eligibility = require('../catalog-eligibility');
const sourcingCandidateImport = require('../sourcing-candidate-import-service');
const sourcingObservationShadow = require('../sourcing-observation-shadow-service');
const { buildNormalizedSourceContractSnapshot } = require('./normalized-product');
const { getRuleNumber } = require('../../utils/rules');
const { importJsonCatalog } = require('./catalog-import-json');

function aggregateReasons(invalidArr) {
  const counts = {};
  for (const item of invalidArr || []) {
    const reasons = Array.isArray(item.errors)
      ? item.errors
      : (item.error ? [item.error] : ['raison inconnue']);
    for (const reason of reasons) counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function eligibilityMatchLabel(verdict) {
  const match = verdict?.match;
  if (!match?.type || match.value == null) return null;
  return `${match.type}=${JSON.stringify(String(match.value))}`;
}

function eligibilityReason(verdict) {
  if (!verdict) return null;
  const parts = [verdict.label];
  const evidence = eligibilityMatchLabel(verdict);
  if (evidence) parts.push(evidence);
  if (verdict.legal_note) parts.push(verdict.legal_note);
  return parts.filter(Boolean).join(' — ');
}

function automaticRejectedReason(verdict) {
  const evidence = eligibilityMatchLabel(verdict);
  return `[auto-exclusion] ${verdict?.label || 'Exclusion'}${evidence ? ` [${evidence}]` : ''}`;
}

async function importCatalog(body, userId, dispatchToConnector) {
  const b = body || {};
  const supplierName = (b.supplier_name || '').trim();
  const sourceType = b.source_type || 'manual';

  if (!supplierName) return { status: 400, body: { error: 'supplier_name requis' } };
  if (!['csv', 'manual', 'api', 'json'].includes(sourceType)) {
    return { status: 400, body: { error: 'source_type doit être csv, manual, api ou json' } };
  }

  // Le chemin JSON transactionnel historique reste volontairement hors PR 2.
  if (sourceType === 'json') return importJsonCatalog(b, userId);

  let connectorResult;
  try {
    connectorResult = await dispatchToConnector(b);
  } catch (err) {
    return { status: 400, body: { error: err.message } };
  }

  const products = connectorResult.products || [];
  const invalidFromConnector = connectorResult.invalid || [];
  if (!products.length) {
    return { status: 400, body: { error: 'Aucun produit valide trouvé', invalid: invalidFromConnector } };
  }

  const totalFromConnector = products.length + invalidFromConnector.length;
  const maxInvalidPct = await getRuleNumber('CATALOG_IMPORT_MAX_INVALID_PCT', 30);
  const invalidPct = totalFromConnector > 0 ? (invalidFromConnector.length / totalFromConnector) * 100 : 0;
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

  const config = await pricingEngine.loadGlobalConfig();
  const activeExclusions = await eligibility.loadActiveExclusions();

  const importRes = await db.query(
    `INSERT INTO supplier_catalog_imports
       (supplier_name, source_type, source_filename, notes, total_items, imported_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [supplierName, sourceType, b.source_filename || null, b.notes || null, products.length, userId || null]
  );
  const importId = importRes.rows[0].id;

  // Shadow uniquement : aucune erreur de cette couche ne peut bloquer le chemin
  // historique. Le résumé est exposé pour preuve et diagnostic.
  let shadowIngestion;
  try {
    shadowIngestion = await sourcingObservationShadow.recordCatalogImportObservationsShadow({
      importId,
      supplierName,
      sourceType,
      supplierId: b.supplier_id || null,
      sourceFilename: b.source_filename || null,
      products,
    });
  } catch (errShadow) {
    shadowIngestion = {
      status: 'failed',
      code: errShadow.code || 'SHADOW_OBSERVATION_FAILED',
    };
  }

  const results = { created: 0, errors: [...invalidFromConnector] };
  for (const product of products) {
    try {
      const normalizedSourceContract = buildNormalizedSourceContractSnapshot(product);
      const normalized = await scanner.normalizeCandidate(product, { config });
      const verdict = eligibility.checkEligibility(normalized, activeExclusions);
      const isAbsoluteExclusion = verdict?.layer === 'absolute';

      const scan = isAbsoluteExclusion
        ? {
            scan_result: null,
            sourcing_decision: 'EXCLUDED',
            reason: eligibilityReason(verdict),
            recommended_action: 'Ne pas importer — exclusion douane/légale.',
            confidence: normalized.confidence || 'low',
          }
        : await scanner.scanCandidate(normalized, { config });

      const autoState = isAbsoluteExclusion ? 'rejected' : 'scanned';
      const autoRejectedReason = isAbsoluteExclusion ? automaticRejectedReason(verdict) : null;

      const { wasUpdated } = await sourcingCandidateImport.upsertCandidateFromCatalogImport(db, {
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
      });

      if (wasUpdated) results.updated = (results.updated || 0) + 1;
      else results.created++;
    } catch (errOne) {
      results.errors.push({ product_name: product.product_name || '?', error: errOne.message });
    }
  }

  if (b.is_full_snapshot) {
    const importedIds = products.map((product) => product.supplier_product_id).filter(Boolean);
    results.archived = await sourcingCandidateImport.archiveMissingCandidatesFromCatalogImport(db, {
      supplierName,
      importedIds,
      userId,
      importId,
    });
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
      shadow_ingestion: shadowIngestion,
    },
  };
}

module.exports = {
  importCatalog,
  aggregateReasons,
  eligibilityMatchLabel,
  eligibilityReason,
  automaticRejectedReason,
};
