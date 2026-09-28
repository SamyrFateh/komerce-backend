/**
 * @komerce-arch
 * @role          catalog-import-orchestrator
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        normalized_supplier_products, catalog_import_context
 * @outputs       sourcing_candidates, import_summary, shadow_observation_summary, provider_runtime_certification_attempt
 * @depends       db.js, services/supplier-catalog-scanner.js, services/pricing-engine.js, services/sourcing-candidate-import-service.js, services/sourcing-observation-shadow-service.js, services/sourcing-provider-control-policy.js, services/sourcing-certification.js, services/suppliers/normalized-product.js, services/suppliers/connectors/*
 * @used-by       routes/sourcing-scanner.js
 * @db-read       none
 * @db-write      supplier_catalog_imports
 * @db-write-via:import-runtime-runs import_runtime_runs
 * @db-write-via:sourcing-provider-control-policy sourcing_sources
 * @db-txn        resolve_before_behavior_change
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/doctrine/DOCTRINE_SOURCE_SHADOW_INGESTION.md, provider_runtime_certification_requires_canonical_resolved_api_capture
 * @impact-areas  catalog, product-detail, sourcing
 * @version       2026-09
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
const sourcingCandidateImport = require('../sourcing-candidate-import-service');
const sourcingObservationShadow = require('../sourcing-observation-shadow-service');
const providerPolicy = require('../sourcing-provider-control-policy');
const {
  SOURCING_CERTIFICATION_VERSION,
  decisionOutcome,
  reconcileSourcingCounts,
} = require('../sourcing-certification');
const { buildNormalizedSourceContractSnapshot } = require('./normalized-product');
const { getRuleNumber } = require('../../utils/rules');
const { importJsonCatalog } = require('./catalog-import-json');
const importRuns = require('../import-runtime-runs');

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

  // Toute source API doit porter son identité canonique AVANT le dispatch et toute écriture.
  // Certains runners injectent eux-mêmes le produit et contournent le dispatch API.
  const supplierId = String(b.supplier_id || '').trim().toLowerCase();
  if (sourceType === 'api' && !supplierId) {
    return { status: 400, body: { code: 'API_SUPPLIER_ID_REQUIRED', error: 'supplier_id canonique requis pour une source API' } };
  }

  // ING-6 — la source JSON emprunte un chemin transactionnel dédié.
  // PR 2 ne modifie pas encore ce rail ; il sera raccordé au writer shadow
  // après sa propre frontière V2.
  if (sourceType === 'json') {
    return importJsonCatalog(b, userId);
  }

  // Run de suivi : projection fail-open, jamais autorité métier.
  const runtimeRun = await importRuns.safe(() => importRuns.startRun({
    provider: supplierName,
    sourceType,
    sourceRef: sourceType === 'api' ? supplierId : null,
    mode: b.mode,
    actorId: userId || null,
  }));
  const runHook = (fn) => runtimeRun
    ? importRuns.safe(() => fn(runtimeRun.id))
    : Promise.resolve(null);

  // 1. Dispatcher vers le connecteur → NormalizedSupplierProduct[]
  let connectorResult;
  try {
    connectorResult = await dispatchToConnector(b);
    await runHook((id) => importRuns.markStage(id, 'SOURCE_CONNECTED', { finished: true }));
  } catch (err) {
    await runHook((id) => importRuns.failRun(id, `connector_failed: ${err.message}`));
    return { status: 400, body: { error: err.message, run_ref: runtimeRun?.run_ref || null } };
  }

  const products = connectorResult.products || [];
  const invalidFromConnector = connectorResult.invalid || [];

  if (!products.length) {
    await runHook((id) => importRuns.failRun(id, 'no_valid_product'));
    return {
      status: 400,
      body: { error: 'Aucun produit valide trouvé', invalid: invalidFromConnector, run_ref: runtimeRun?.run_ref || null },
    };
  }

  // ING-I4 : un fichier malade est refusé en bloc.
  const totalFromConnector = products.length + invalidFromConnector.length;
  const maxInvalidPct = await getRuleNumber('CATALOG_IMPORT_MAX_INVALID_PCT', 30);
  const invalidPct = totalFromConnector > 0
    ? (invalidFromConnector.length / totalFromConnector) * 100
    : 0;

  if (invalidPct > maxInvalidPct && sourceType !== 'api') {
    await runHook((id) => importRuns.failRun(id, 'invalid_ratio_above_threshold'));
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
  await runHook((id) => importRuns.attachImport(id, {
    importId,
    sourceTotal: totalFromConnector,
  }));
  await runHook((id) => importRuns.markStage(id, 'RAW_IMPORT', { started: true }));

  // PR 2 — shadow dual-write : aucune erreur de cette couche ne peut bloquer
  // le chemin historique sourcing_candidates. Le résumé est exposé pour preuve.
  let shadowIngestion;
  try {
    shadowIngestion = await sourcingObservationShadow.recordCatalogImportObservationsShadow({
      importId,
      supplierName,
      sourceType,
      supplierId: sourceType === 'api' ? supplierId : null,
      sourceFilename: b.source_filename || null,
      products,
    });
  } catch (errShadow) {
    shadowIngestion = {
      status: 'failed',
      code: errShadow.code || 'SHADOW_OBSERVATION_FAILED',
      reason: String(errShadow.message || 'Shadow ingestion failed').slice(0, 300),
    };
  }

  await runHook((id) => importRuns.attachImport(id, {
    importId,
    sourceTotal: totalFromConnector,
    sourceRef: sourceType === 'api' ? (shadowIngestion?.source_id || supplierId) : null,
  }));
  await runHook((id) => importRuns.markStage(id, 'RAW_IMPORT', { finished: true }));
  await runHook((id) => importRuns.markStage(id, 'REFINERY', { started: true }));

  // 4. Pour chaque NormalizedSupplierProduct : raffiner et persister.
  const results = {
    created: 0,
    auto_rejected: 0,
    ready_for_refinery: 0,
    certification_blocked: 0,
    deferred: 0,
    errors: [...invalidFromConnector],
  };
  for (const product of products) {
    try {
      // PDC-1 : snapshot du mapping fournisseur → contrat normalisé. V1 = null.
      const normalizedSourceContract = buildNormalizedSourceContractSnapshot(product);
      const normalized = await scanner.normalizeCandidate(product, { config });

      // ③ Éligibilité — avant pricing, sur la donnée SOURCE.
      // Le verdict inclut la preuve du match (mot-clé/catégorie), persistée
      // dans scan_result.eligibility et dans rejected_reason pour audit humain.
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

      if (wasUpdated) {
        results.updated = (results.updated || 0) + 1;
      } else {
        results.created++;
      }
      if (isAbsoluteExclusion) {
        results.auto_rejected += 1;
      } else {
        const outcome = decisionOutcome(scan.sourcing_decision);
        if (outcome === 'ready_for_refinery') {
          if (String(normalizedSourceContract?.schema_version || '') === '2') {
            results.ready_for_refinery += 1;
          } else {
            results.certification_blocked += 1;
          }
        } else if (outcome === 'deferred') {
          results.deferred += 1;
        }
      }
    } catch (errOne) {
      results.errors.push({ product_name: product.product_name || '?', error: errOne.message });
    }
  }

  await runHook((id) => importRuns.markStage(id, 'REFINERY', { finished: true }));

  // DSC-E3 — Archivage des candidats disparus, full snapshot uniquement.
  if (b.is_full_snapshot) {
    const importedIds = products
      .map((product) => product.supplier_product_id)
      .filter(Boolean);

    results.archived = await sourcingCandidateImport.archiveMissingCandidatesFromCatalogImport(db, {
      supplierName,
      importedIds,
      userId,
      importId,
    });
  }

  // Un upsert candidat n'est pas une preuve de résolution canonique.
  const shadowResolution = shadowIngestion?.resolution;
  const canonicalResolved = shadowIngestion?.status === 'recorded'
    && Boolean(shadowIngestion.capture_id)
    && shadowResolution?.status === 'resolved'
    && Number(shadowResolution.review_required || 0) === 0
    && Number(shadowResolution.deferred_parent || 0) === 0;
  const accepted = results.created + (results.updated || 0);
  const sourceCertificationAccounting = reconcileSourcingCounts({
    inputTotal: totalFromConnector,
    readyForRefinery: results.ready_for_refinery,
    rejected: invalidFromConnector.length + results.auto_rejected,
    deferred: results.deferred,
  });
  const pipelineStatus = sourceType === 'api'
    ? (sourceCertificationAccounting.balanced
      && canonicalResolved
      && accepted === products.length
      && results.errors.length === 0
        ? 'CANONICAL_RESOLVED'
        : 'PARTIAL_BLOCKED')
    : 'CATALOG_IMPORT_RECORDED';

  const duplicateCount = invalidFromConnector.filter(
    (row) => row?.reason_code === importRuns.DUPLICATE_CODE
  ).length;

  await runHook((id) => importRuns.recordIntake(id, {
    recorded_at: new Date().toISOString(),
    accepted,
    duplicates: duplicateCount,
    rejected: Math.max(0, results.errors.length - duplicateCount) + results.auto_rejected,
    quarantined: 0,
    deferred: results.deferred,
    ready_for_refinery: results.ready_for_refinery,
    certification_blocked: results.certification_blocked,
    pipeline_status: pipelineStatus,
    capture_id: sourceType === 'api' ? (shadowIngestion?.capture_id || null) : null,
  }));

  // Provider runtime authority is produced only by a real, fully resolved API run.
  // Failure to persist this proof never lies about certification: Production simply remains locked.
  if (sourceType === 'api' && pipelineStatus === 'CANONICAL_RESOLVED') {
    await providerPolicy.recordRuntimeCertification({
      sourceRef: shadowIngestion?.source_id || null,
      captureId: shadowIngestion?.capture_id || null,
      pipelineStatus,
    }).catch(() => null);
  }

  await runHook((id) => importRuns.syncRun(id));

  return {
    status: 200,
    body: {
      run_ref: runtimeRun?.run_ref || null,
      pipeline_status: pipelineStatus,
      canonical_resolved: sourceType === 'api' ? canonicalResolved : null,
      import_id: importId,
      supplier_name: supplierName,
      source_type: sourceType,
      total_items: products.length,
      created: results.created,
      updated: results.updated || 0,
      archived: results.archived || 0,
      errors: results.errors,
      accepted,
      rejected: results.errors.length,
      reject_reasons: aggregateReasons(results.errors),
      unmapped_columns: connectorResult.unmapped_columns || [],
      source_certification: {
        certification_version: SOURCING_CERTIFICATION_VERSION,
        stage: 'SCANNED',
        ready_for_refinery: results.ready_for_refinery,
        certification_blocked: results.certification_blocked,
        deferred: results.deferred,
        ...sourceCertificationAccounting,
      },
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
