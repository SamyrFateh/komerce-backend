/**
 * @komerce-arch
 * @role          sourcing-candidate-action-service
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        candidate_id_internal, validated_candidate_payload, actor_id
 * @outputs       candidate_mutation_result, promoted_catalog_product
 * @depends       db.js, services/supplier-catalog-scanner.js, services/pricing-engine.js, services/catalog-candidate-product-service.js, services/catalog-promotion.js, services/catalog-enrichment.js
 * @used-by       routes/sourcing-scanner.js, services/sourcing-workspace.js
 * @db-read       sourcing_candidates, sourcing_candidate_events, supplier_catalog_imports
 * @db-write      sourcing_candidates, sourcing_candidate_events
 * @db-write-via:catalog-candidate-product-service products
 * @db-write-via:catalog-promotion catalog_media, product_variants, product_skus, product_sku_media
 * @db-txn        promoteCandidate : transaction dédiée
 * @doctrine      single_sourcing_candidate_mutation_authority, catalog_promotion_owner_respected
 * @impact-areas  sourcing, catalog
 * @version       2026-08
 */

'use strict';

const db = require('../db');
const scanner = require('./supplier-catalog-scanner');
const pricingEngine = require('./pricing-engine');
const catalogEnrichment = require('./catalog-enrichment');
const { createDraftProductFromSourcingCandidate } = require('./catalog-candidate-product-service');
const { promoteCatalog } = require('./catalog-promotion');

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
  const CURRENCY_WHITELIST = ['AED', 'EUR', 'USD', 'KMF'];
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
    const current = await requireCandidate(id, q);
    const currency = body.currency !== undefined ? body.currency : current.currency;
    if (!currency) {
      throw new SourcingCandidateActionError(
        400,
        'Devise introuvable : fournir explicitement currency.',
        'candidate_currency_required'
      );
    }
    const purchasePrice = body.purchase_price !== undefined ? body.purchase_price : current.purchase_price;
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

async function promoteCandidate(id, body = {}, actorId = null) {
  const client = await db.getClient();
  let productId = null;
  let candidate = null;
  let promotion = null;
  try {
    await client.query('BEGIN');
    candidate = await requireCandidate(id, client);

    if (candidate.state === 'imported_to_catalog' && candidate.product_id) {
      throw new SourcingCandidateActionError(409, 'Déjà importé', 'candidate_already_promoted', { product_id: candidate.product_id });
    }
    if (candidate.state === 'rejected' || candidate.scan_result?.sourcing_decision === 'EXCLUDED') {
      throw new SourcingCandidateActionError(409, 'Candidat exclu (douane/légal) — import interdit, non ré-évaluable.', 'candidate_excluded');
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
          { batch_status: batchStatus }
        );
      }
    }

    const scanResult = candidate.scan_result || {};
    const initialPrice = body.price_kmf
      || scanResult.test_price_kmf
      || scanResult.recommended_price_kmf
      || scanResult.minimum_safe_price_kmf
      || 0;
    if (!initialPrice) {
      throw new SourcingCandidateActionError(400, 'Pas de prix calculé. Re-scannez le candidat avant import.', 'candidate_price_missing');
    }

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
      [id, candidate.state, JSON.stringify({ product_id: productId, price_kmf: initialPrice }), actorId || null]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const enrichment = await catalogEnrichment.enrichAndApply(productId);
  return {
    product_id: productId,
    candidate_id: id,
    promotion,
    enrichment,
    message: enrichment.status === 'ok'
      ? 'Produit créé en mode inactif, fiche FR générée. Approuvez-la quand prête.'
      : 'Produit créé en mode inactif — fiche à relire (needs_review). Activez-le manuellement quand prêt.',
  };
}

module.exports = {
  SourcingCandidateActionError,
  requireCandidate,
  updateCandidate,
  scanCandidate,
  watchlistCandidate,
  rejectCandidate,
  promoteCandidate,
};
