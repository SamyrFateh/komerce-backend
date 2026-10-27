/**
 * @komerce-arch
 * @role          sourcing-candidate-action-service
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        candidate_id_internal, import_id_internal, validated_candidate_payload, actor_id
 * @outputs       candidate_mutation_result, inactive_catalog_draft, automatic_catalogue_handoff_summary
 * @depends       db.js, services/supplier-commercial-category-mapping.js, services/supplier-catalog-scanner.js, services/pricing-engine.js, services/catalog-candidate-product-service.js, services/catalog-promotion.js, services/catalog-enrichment.js, services/import-runtime-runs.js, services/sourcing-certification.js
 * @used-by       routes/sourcing-scanner.js, services/sourcing-workspace.js
 * @db-read       sourcing_candidates, sourcing_candidate_events, supplier_catalog_imports, import_runtime_runs
 * @db-write      sourcing_candidates, sourcing_candidate_events
 * @db-write-via:catalog-candidate-product-service products
 * @db-write-via:catalog-promotion catalog_media, product_variants, product_skus, product_sku_media
 * @db-write-via:import-runtime-runs import_runtime_runs
 * @db-write-via:supplier-commercial-category-mapping supplier_commercial_category_mappings
 * @db-txn        promoteCandidate, confirmCandidateBoutiqueCategory : transactions dédiées
 * @doctrine      single_sourcing_candidate_mutation_authority, sourcing_certified_auto_handoff, catalog_promotion_owner_respected, engine_price_is_not_market_decision, draft_handoff_has_no_market_price, publication_requires_price
 * @impact-areas  sourcing, catalog, economic-engine
 * @version       2026-09
 */

'use strict';

const db = require('../db');
const scanner = require('./supplier-catalog-scanner');
const pricingEngine = require('./pricing-engine');
const { createDraftProductFromSourcingCandidate, resolveCommercialTaxonomyVerdict } = require('./catalog-candidate-product-service');
const { promoteCatalog } = require('./catalog-promotion');
const importRuns = require('./import-runtime-runs');
const certification = require('./sourcing-certification');
const commercialMapping = require('./supplier-commercial-category-mapping');

class SourcingCandidateActionError extends Error {
  constructor(status, message, code = null, details = null) {
    super(message);
    this.name = 'SourcingCandidateActionError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function requireCandidate(id, q = db) {
  const { rows } = await q.query('SELECT * FROM sourcing_candidates WHERE id = $1', [id]);
  if (!rows.length) throw new SourcingCandidateActionError(404, 'Candidat introuvable', 'candidate_not_found');
  return rows[0];
}

async function updateCandidate(id, body = {}, actorId = null, q = db) {
  const CURRENCY_WHITELIST = ['AED', 'EUR', 'USD', 'KMF', 'PLN'];
  if (body.currency !== undefined && !CURRENCY_WHITELIST.includes(body.currency)) {
    throw new SourcingCandidateActionError(400, `currency doit être l'une de : ${CURRENCY_WHITELIST.join(', ')}`, 'candidate_currency_invalid');
  }

  const allowed = [
    'komerce_category', 'estimated_weight_kg', 'estimated_volume_m3',
    'purchase_price', 'currency', 'target_margin_pct', 'notes',
    'product_name', 'supplier_category',
  ];
  const sets = [];
  const params = [];
  let pi = 1;
  const sourceUpdates = {};

  for (const key of allowed) {
    if (body[key] !== undefined) {
      sets.push(`${key} = $${pi++}`);
      params.push(body[key]);
      const srcKey = ({
        komerce_category: 'category',
        estimated_weight_kg: 'weight',
        estimated_volume_m3: 'volume',
        purchase_price: 'purchase_price',
        target_margin_pct: 'target_margin',
      })[key];
      if (srcKey) sourceUpdates[srcKey] = 'manual';
    }
  }

  if (!sets.length) throw new SourcingCandidateActionError(400, 'Aucun champ à modifier', 'candidate_no_changes');

  if (body.purchase_price !== undefined || body.currency !== undefined) {
    const needsCurrent = body.purchase_price === undefined || body.currency === undefined;
    const current = needsCurrent ? await requireCandidate(id, q) : null;
    const currency = body.currency !== undefined ? body.currency : current?.currency;
    if (!currency) {
      throw new SourcingCandidateActionError(
        400,
        'Devise introuvable : ni fournie dans la requête, ni présente en base pour ce candidat. Fournir explicitement currency.',
        'candidate_currency_required'
      );
    }
    const purchasePrice = body.purchase_price !== undefined ? body.purchase_price : current?.purchase_price;
    const config = await pricingEngine.loadGlobalConfig();
    const priceKmf = scanner.convertToKMF(purchasePrice, currency, config.finance);
    sets.push(`purchase_price_kmf = $${pi++}`);
    params.push(priceKmf);
  }

  if (Object.keys(sourceUpdates).length) {
    sets.push(`data_sources = data_sources || $${pi++}::jsonb`);
    params.push(JSON.stringify(sourceUpdates));
  }

  sets.push(`updated_by = $${pi++}`);
  params.push(actorId || null);
  params.push(id);

  const { rows } = await q.query(
    `UPDATE sourcing_candidates SET ${sets.join(', ')} WHERE id = $${pi} RETURNING *`,
    params
  );
  if (!rows.length) throw new SourcingCandidateActionError(404, 'Candidat introuvable', 'candidate_not_found');

  await q.query(
    `INSERT INTO sourcing_candidate_events (candidate_id, event_type, changes, notes, triggered_by)
     VALUES ($1, 'data_correction', $2, $3, $4)`,
    [id, JSON.stringify(body), body.notes || null, actorId || null]
  );
  return rows[0];
}

async function scanCandidate(id, actorId = null, q = db) {
  const candidate = await requireCandidate(id, q);
  const config = await pricingEngine.loadGlobalConfig();
  const scan = await scanner.scanCandidate(candidate, { config });
  const merged = {
    ...scan.scan_result,
    sourcing_decision: scan.sourcing_decision,
    reason: scan.reason,
    recommended_action: scan.recommended_action,
  };
  const { rows } = await q.query(
    `UPDATE sourcing_candidates
        SET scan_result = $1, scan_at = NOW(), confidence = $2, state = 'scanned', updated_by = $3
      WHERE id = $4 RETURNING *`,
    [JSON.stringify(merged), scan.confidence, actorId || null, id]
  );
  await q.query(
    `INSERT INTO sourcing_candidate_events (candidate_id, event_type, result, triggered_by)
     VALUES ($1, 'scan', $2, $3)`,
    [id, JSON.stringify(merged), actorId || null]
  );
  return rows[0];
}

async function watchlistCandidate(id, actorId = null, q = db) {
  const candidate = await requireCandidate(id, q);
  await q.query(
    `UPDATE sourcing_candidates SET state='watchlist', updated_by=$1 WHERE id=$2`,
    [actorId || null, id]
  );
  await q.query(
    `INSERT INTO sourcing_candidate_events
       (candidate_id, event_type, old_state, new_state, triggered_by)
     VALUES ($1, 'state_change', $2, 'watchlist', $3)`,
    [id, candidate.state, actorId || null]
  );
  return { state: 'watchlist' };
}

async function rejectCandidate(id, reason = '', actorId = null, q = db) {
  const candidate = await requireCandidate(id, q);
  const text = String(reason || '').trim();
  await q.query(
    `UPDATE sourcing_candidates SET state='rejected', rejected_reason=$1, updated_by=$2 WHERE id=$3`,
    [text || null, actorId || null, id]
  );
  await q.query(
    `INSERT INTO sourcing_candidate_events
       (candidate_id, event_type, old_state, new_state, notes, triggered_by)
     VALUES ($1, 'rejected', $2, 'rejected', $3, $4)`,
    [id, candidate.state, text, actorId || null]
  );
  return { state: 'rejected', rejected_reason: text || null };
}

function resolveDraftPrice(body = {}) {
  if (body.price_kmf === undefined || body.price_kmf === null || body.price_kmf === '') return null;
  const explicitPrice = Number(body.price_kmf);
  if (!Number.isFinite(explicitPrice) || explicitPrice <= 0) {
    throw new SourcingCandidateActionError(
      400,
      'price_kmf doit être strictement positif lorsqu’il est fourni. Un brouillon Catalogue peut rester sans prix jusqu’à sa publication.',
      'candidate_price_invalid'
    );
  }
  return explicitPrice;
}

function resolveEnrichmentMode(body = {}) {
  const mode = body.enrichment_mode == null
    ? 'source_only'
    : String(body.enrichment_mode).trim().toLowerCase();

  if (mode !== 'source_only') {
    throw new SourcingCandidateActionError(
      400,
      'enrichment_mode doit être source_only — aucune API IA n’est appelée par la promotion catalogue',
      'candidate_enrichment_mode_invalid'
    );
  }
  return mode;
}

async function promoteCandidate(id, body = {}, actorId = null, options = {}) {
  const enrichmentMode = resolveEnrichmentMode(body);
  const client = await db.getClient();
  let productId = null;
  let candidate = null;
  let promotion = null;
  let initialPrice = null;
  try {
    await client.query('BEGIN');
    candidate = await requireCandidate(id, client);

    if (candidate.state === 'imported_to_catalog' && candidate.product_id) {
      throw new SourcingCandidateActionError(409, 'Déjà importé', 'candidate_already_promoted', { product_id: candidate.product_id });
    }
    if (candidate.state === 'rejected' || candidate.scan_result?.sourcing_decision === 'EXCLUDED') {
      throw new SourcingCandidateActionError(409, 'Candidat exclu (douane/légal) — import interdit, non ré-évaluable.', 'candidate_excluded');
    }
    // A confirmed BOUTIQUE category allows an INACTIVE draft to enter
    // refinery under grouped shipping. Customs remain backend-only and
    // cannot be invented by this decision. Publication/pricing gates remain.
    const commercialConfirmed = candidate.commercial_taxonomy_review?.status === 'CONFIRMED'
      && candidate.commercial_taxonomy_review?.category
      && candidate.commercial_taxonomy_review?.subcategory;
    // A validated mapping for this exact provider/category path is already an
    // authoritative commercial decision. Never ask to approve it again merely
    // because the legacy customs category is absent in a grouped-shipping flow.
    const provider = candidate.normalized_source_contract?.supplier_name || candidate.supplier_name;
    const sourcePath = candidate.supplier_category
      || candidate.normalized_source_contract?.supplier_category;
    const commercialVerdict = !commercialConfirmed && sourcePath
      ? await resolveCommercialTaxonomyVerdict(client,candidate)
      : null;
    const commercialMapped = Boolean(commercialVerdict?.category && (
      (commercialVerdict.status==='AUTO_CLASSIFIED' && commercialVerdict.subcategory)
      || (commercialVerdict.status==='CATEGORY_CLASSIFIED'
          && commercialVerdict.subcategory===null
          && commercialVerdict.level==='CATEGORY'
          && commercialVerdict.source==='SOURCE_AND_OBJECT_ROOT_CORROBORATED')
    ));
    if (!commercialConfirmed && !commercialMapped && (!candidate.komerce_category
        || candidate.data_sources?.category === 'default'
        || candidate.scan_result?.customs_review?.status === 'REQUIRED')) {
      throw new SourcingCandidateActionError(
        409, 'Catégorie boutique à confirmer avant préparation du brouillon.',
        'candidate_commercial_category_review_required'
      );
    }
    if (candidate.state === 'quarantined') {
      throw new SourcingCandidateActionError(409, 'Candidat en quarantaine — non promouvable en l’état.', 'candidate_quarantined');
    }

    if (candidate.import_id) {
      const { rows } = await client.query('SELECT status FROM supplier_catalog_imports WHERE id = $1', [candidate.import_id]);
      const batchStatus = rows[0]?.status;
      if (batchStatus && batchStatus !== 'COMPLETED' && batchStatus !== 'COMPLETED_WITH_QUARANTINE') {
        throw new SourcingCandidateActionError(
          409,
          `Import parent non promouvable (statut batch: ${batchStatus}).`,
          'candidate_parent_batch_blocked',
          { import_id: candidate.import_id, batch_status: batchStatus }
        );
      }
    }

    // Doctrine prix : le passage Sourcing → Catalogue crée un brouillon inactif.
    // Il n'a besoin d'aucun prix de vente. Si un prix explicite est fourni par un
    // ancien appelant, on le conserve ; sinon NULL reste la vérité jusqu'au gate
    // de publication, qui exige alors un prix marché valide.
    initialPrice = resolveDraftPrice(body);

    productId = await createDraftProductFromSourcingCandidate(client, {
      candidate,
      initialPrice,
    });
    promotion = await promoteCatalog(client, {
      productId,
      normalizedSourceContract: candidate.normalized_source_contract || null,
    });

    await client.query(
      `UPDATE sourcing_candidates
          SET state = 'imported_to_catalog', product_id = $1, updated_by = $2
        WHERE id = $3`,
      [productId, actorId || null, id]
    );
    await client.query(
      `INSERT INTO sourcing_candidate_events
         (candidate_id, event_type, old_state, new_state, changes, triggered_by)
       VALUES ($1, 'imported', $2, 'imported_to_catalog', $3, $4)`,
      [id, candidate.state, JSON.stringify({
        product_id: productId,
        price_kmf: initialPrice,
        price_decision: initialPrice == null ? 'DEFERRED_TO_PUBLICATION' : 'EXPLICIT_HUMAN_INPUT',
        enrichment_mode: enrichmentMode,
      }), actorId || null]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Projection live uniquement : recalcul après commit, jamais bloquant.
  // L'orchestrateur peut différer cette projection pour éviter un N+1 lors
  // d'une remise automatique de plusieurs brouillons.
  if (options.syncRuntime !== false) {
    await importRuns.safe(() => importRuns.syncRunsForImport(candidate?.import_id));
  }

  const enrichment = {
    status: 'source_only',
    mode: 'source_only',
    reason: body.enrichment_mode == null ? 'default_source_only_no_ai_api' : 'explicit_source_only',
  };

  return {
    product_id: productId,
    candidate_id: id,
    promotion,
    enrichment,
    enrichment_mode: enrichmentMode,
    price_decision: initialPrice == null ? 'DEFERRED_TO_PUBLICATION' : 'EXPLICIT_HUMAN_INPUT',
    message: initialPrice == null
      ? 'Brouillon Catalogue créé sans prix et non publié — le prix sera exigé au moment de la publication.'
      : 'Brouillon Catalogue créé avec prix explicite, toujours inactif jusqu’à publication.',
  };
}


async function confirmCandidateBoutiqueCategory(candidateRef, body, actorId = null) {
  const category = String(body?.category || '').trim();
  const subcategory = String(body?.subcategory || '').trim();
  if (!category || !subcategory) throw new SourcingCandidateActionError(400,
    'Catégorie et sous-catégorie boutique requises.', 'sourcing_boutique_pair_required');
  const client = await db.getClient();
  let candidate;
  try {
    await client.query('BEGIN');
    const { rows:[row] } = await client.query(
      'SELECT * FROM sourcing_candidates WHERE candidate_ref=$1 FOR UPDATE', [candidateRef]);
    candidate = row;
    if (!candidate) throw new SourcingCandidateActionError(404, 'Produit Sourcing introuvable','candidate_not_found');
    if (candidate.product_id || ['imported_to_catalog','rejected','archived','quarantined'].includes(candidate.state)
        || candidate.scan_result?.sourcing_decision === 'EXCLUDED') {
      throw new SourcingCandidateActionError(409,'Candidat bloqué ou déjà transmis.','candidate_not_classifiable');
    }
    const provider = candidate.normalized_source_contract?.supplier_name || candidate.supplier_name;
    if (!provider || !candidate.supplier_category) {
      throw new SourcingCandidateActionError(409,'Catégorie source fournisseur absente.','supplier_category_source_missing');
    }
    try {
      await commercialMapping.confirmMapping({
        provider, source_category_path:candidate.supplier_category,
        category,subcategory,
        source_locale:candidate.normalized_source_contract?.source_locale || 'en',
      },String(actorId || 'sourcing'),client);
    } catch (error) {
      if (error.message === 'BOUTIQUE_TAXONOMY_INVALID') throw new SourcingCandidateActionError(
        400,'Catégorie boutique inactive ou inconnue.','sourcing_boutique_pair_invalid');
      throw error;
    }
    const review = { status:'CONFIRMED', category, subcategory, source:'OPERATOR',
      confirmed_at:new Date().toISOString() };
    await client.query(
      'UPDATE sourcing_candidates SET commercial_taxonomy_review=$1::jsonb, updated_by=$2, updated_at=now() WHERE id=$3',
      [JSON.stringify(review),actorId,candidate.id]);
    await client.query(
      "INSERT INTO sourcing_candidate_events (candidate_id,event_type,old_state,new_state,changes,triggered_by) VALUES ($1,'data_correction',$2,$2,$3,$4)",
      [candidate.id,candidate.state,JSON.stringify({ commercial_taxonomy_review:review }),actorId]);
    await client.query('COMMIT');
  } catch(error) {
    try { await client.query('ROLLBACK'); } catch(_) { /* preserve original error */ }
    throw error;
  } finally { client.release(); }
  // Mapping is durable even if a separate draft handoff fails; never publish.
  try {
    const draft = await promoteCandidate(candidate.id,
      {enrichment_mode:'source_only'},actorId);
    return { candidate_ref:candidateRef, category,subcategory, confirmed:true,
      draft_created:true, price_decision:draft.price_decision,
      next_step:'Préparer la fiche et décider du prix marché avant publication.' };
  } catch(error) {
    return { candidate_ref:candidateRef, category,subcategory, confirmed:true,
      draft_created:false, handoff_error_code:error?.code || 'catalogue_handoff_failed',
      next_step:'Mapping conservé ; compléter la Raffinerie avant de relancer la remise Catalogue.' };
  }
}


class SourcingCatalogueHandoffError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'SourcingCatalogueHandoffError';
    this.status = 500;
    this.code = 'sourcing_catalogue_handoff_failed';
    this.details = details;
  }
}

async function catalogueHandoffCandidateRows(importId, q = db) {
  const { rows } = await q.query(
    `SELECT id, state, product_id, supplier_name, supplier_category, product_name, supplier_product_id,
            raw_payload, normalized_source_contract, scan_result,
            rejected_reason, promotion_status, promotion_reasons, findings
       FROM sourcing_candidates
      WHERE import_id = $1
      ORDER BY created_at, id`,
    [importId]
  );
  return rows;
}

async function failRunsForCatalogueHandoff(importId, count, q = db) {
  const { rows } = await q.query(
    `SELECT id
       FROM import_runtime_runs
      WHERE import_id = $1
        AND status <> 'FAILED'`,
    [importId]
  );
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    await importRuns.failRun(row.id, `catalogue_handoff_failed:${count}`, q);
  }
}

async function handoffCertifiedImport(importId, {
  actorId = null,
  q = db,
  promote = promoteCandidate,
} = {}) {
  if (!importId) return { attempted:0, catalogued:0, already_catalogued:0, failed:[] };

  const rows = await catalogueHandoffCandidateRows(importId, q);
  const ready = [];
  let alreadyCatalogued = 0;

  for (const row of rows) {
    const verdict = certification.evaluateSourcingCandidateOutcome(row);
    if (!verdict.outcome_valid) continue;
    // A deferred classification is not a commercial rejection. Only a
    // previously CONFIRMED exact provider/path mapping may cross this seam;
    // economics-deferred WATCH, quarantined, excluded and unknown sources do not.
    if (!verdict.sourcing_certified) {
      const reason = String(row.scan_result?.reason || '');
      const classificationOnly = verdict.decision === 'WATCH'
        && reason.startsWith('Catégorie Komerce non résolue')
        && String(row.normalized_source_contract?.schema_version) === '2';
      const provider = row.normalized_source_contract?.supplier_name || row.supplier_name;
      const sourcePath = row.supplier_category || row.normalized_source_contract?.supplier_category;
      if (!classificationOnly || !provider || !sourcePath) continue;
      // eslint-disable-next-line no-await-in-loop
      // Reuse the single Catalogue commercial classifier (confirmed mapping,
      // object phrase, then supplier category), not a second eligibility rule.
      // eslint-disable-next-line no-await-in-loop
      const commercialVerdict = await resolveCommercialTaxonomyVerdict(q,row);
      if (commercialVerdict.status !== 'AUTO_CLASSIFIED' ||
          !commercialVerdict.category || !commercialVerdict.subcategory) continue;
    }
    if (row.state === 'imported_to_catalog' && row.product_id) {
      alreadyCatalogued += 1;
      continue;
    }
    ready.push(row);
  }

  const summary = {
    attempted: ready.length,
    catalogued: 0,
    already_catalogued: alreadyCatalogued,
    failed: [],
  };

  for (const row of ready) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await promote(
        row.id,
        { enrichment_mode:'source_only' },
        actorId,
        { syncRuntime:false }
      );
      summary.catalogued += 1;
    } catch (error) {
      if (error?.code === 'candidate_already_promoted') {
        summary.already_catalogued += 1;
        continue;
      }
      summary.failed.push({
        candidate_id: row.id,
        supplier_product_id: row.supplier_product_id || null,
        code: error?.code || 'catalogue_handoff_failed',
        error: String(error?.message || error).slice(0, 300),
      });
    }
  }

  if (summary.failed.length) {
    await failRunsForCatalogueHandoff(importId, summary.failed.length, q);
    throw new SourcingCatalogueHandoffError(
      `Remise automatique au Catalogue incomplète : ${summary.failed.length} produit(s) bloqué(s)`,
      summary
    );
  }

  await importRuns.syncRunsForImport(importId, q);
  return summary;
}

async function handoffImportResult(result, actorId = null, options = {}) {
  if (!result || Number(result.status) >= 400 || !result.body?.import_id) return result;
  const summary = await handoffCertifiedImport(result.body.import_id, {
    actorId,
    ...options,
  });
  return {
    ...result,
    body: {
      ...(result.body || {}),
      catalogue_handoff: summary,
    },
  };
}

module.exports = {
  SourcingCandidateActionError,
  SourcingCatalogueHandoffError,
  requireCandidate,
  updateCandidate,
  scanCandidate,
  watchlistCandidate,
  rejectCandidate,
  promoteCandidate,
  confirmCandidateBoutiqueCategory,
  handoffCertifiedImport,
  handoffImportResult,
  _resolveDraftPrice: resolveDraftPrice,
  _resolveEnrichmentMode: resolveEnrichmentMode,
};