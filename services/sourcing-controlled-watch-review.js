/**
 * @komerce-arch-lite
 * @role sourcing-controlled-watch-review
 * @domain sourcing
 * @layer service
 * @owner sourcing
 * @purpose Record an auditable human authorization for a marginal WATCH test without rewriting economic scan truth.
 * @db-read sourcing_candidates, products, sourcing_candidate_events
 * @db-write sourcing_candidate_events
 * @db-txn delegated_to_database_withTransaction
 * @impact-areas sourcing,catalog,economic-engine
 */
'use strict';

const db = require('../db');

const KIND = 'CONTROLLED_WATCH_TEST_V1';
const AUTHORIZE = 'AUTHORIZE_CONTROLLED_TEST';
const REVOKE = 'REVOKE';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ControlledWatchReviewError extends Error {
  constructor(status, code, message, reasons = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = { reasons };
  }
}

function stringOrNull(value) {
  return value == null ? null : String(value);
}

function inputSnapshot(row = {}) {
  return {
    supplier_product_id: stringOrNull(row.supplier_product_id),
    purchase_price: stringOrNull(row.purchase_price),
    currency: stringOrNull(row.currency),
    purchase_price_kmf: stringOrNull(row.purchase_price_kmf),
    estimated_weight_kg: stringOrNull(row.estimated_weight_kg),
    estimated_volume_m3: stringOrNull(row.estimated_volume_m3),
    komerce_category: stringOrNull(row.komerce_category),
    target_margin_pct: stringOrNull(row.target_margin_pct),
    data_sources: row.data_sources ?? {},
    normalized_source_contract: row.normalized_source_contract ?? {},
  };
}

function evaluateWatchEligibility(row = {}) {
  const reasons = [];
  const scan = row.scan_result || {};
  const decision = String(scan.sourcing_decision || '').toUpperCase();
  const health = String(scan.economic_test_health_status || '').toLowerCase();
  const margin = Number(scan.economic_test_margin_pct);
  const testPrice = Number(scan.test_price_kmf);
  const variableCost = Number(scan.variable_cost_complete_kmf ?? scan.variable_cost_estimated_kmf);
  const sourcePrice = Number(row.purchase_price_kmf);

  if (decision !== 'WATCH') reasons.push('SOURCE_DECISION_NOT_WATCH');
  if (['rejected', 'archived', 'quarantined'].includes(row.state)
      || row.catalog_product_active === true) reasons.push('CANDIDATE_NOT_REVIEWABLE');
  if (!row.scan_at || !Number.isFinite(new Date(row.scan_at).getTime())) reasons.push('CURRENT_SCAN_REQUIRED');
  if (health !== 'fragile') reasons.push('ONLY_MEASURED_FRAGILE_WATCH_REVIEWABLE');
  if (!Number.isFinite(margin) || margin < 15 || margin >= 25) reasons.push('MARGIN_OUTSIDE_CONTROLLED_TEST_RANGE');
  if (!(testPrice > 0 && variableCost > 0 && testPrice > variableCost)) reasons.push('POSITIVE_CONTRIBUTION_NOT_PROVEN');
  if (!(sourcePrice > 0) || !(Number(row.purchase_price) > 0) || !row.currency) reasons.push('SOURCE_PRICE_OR_FX_MISSING');
  if (!row.supplier_product_id) reasons.push('SOURCE_PRODUCT_ID_MISSING');
  if (!row.komerce_category || row.data_sources?.category === 'default'
      || scan.customs_review?.status === 'REQUIRED') reasons.push('CUSTOMS_CLASSIFICATION_NOT_PROVEN');
  if (scan.fx_gate?.code || scan.fx_gate?.status === 'AWAITING_OFFICIAL_QUOTE') reasons.push('FX_QUOTE_NOT_PROVEN');
  if (String(row.normalized_source_contract?.schema_version || '') !== '2') reasons.push('SOURCE_CONTRACT_V2_MISSING');

  return { eligible: reasons.length === 0, economic_decision: decision, margin_pct: Number.isFinite(margin) ? margin : null, reasons };
}

// Shared source of truth for the Sourcing UI and Catalogue certification.
// The newest review is authoritative, including an explicit revocation.
// A rescan or any changed supplier input invalidates the former review.
function authorizedWatchSql(alias = 'sc') {
  const a = String(alias);
  if (!/^[a-z_][a-z0-9_]*$/i.test(a)) throw new Error('INVALID_CANDIDATE_SQL_ALIAS');
  return [
    'COALESCE((',
    "SELECT (ev.result->>'action' = 'AUTHORIZE_CONTROLLED_TEST')",
    'FROM sourcing_candidate_events ev',
    'WHERE ev.candidate_id=' + a + '.id',
    "AND ev.event_type='note_added'",
    "AND ev.result->>'kind'='CONTROLLED_WATCH_TEST_V1'",
    "AND ev.result->>'scan_at'=to_char(" + a + ".scan_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')",
    "AND ev.result->'scan_result'=" + a + '.scan_result',
    "AND ev.result->'facts'=jsonb_build_object(",
    "'supplier_product_id'," + a + '.supplier_product_id,',
    "'purchase_price'," + a + '.purchase_price::text,',
    "'currency'," + a + '.currency,',
    "'purchase_price_kmf'," + a + '.purchase_price_kmf::text,',
    "'estimated_weight_kg'," + a + '.estimated_weight_kg::text,',
    "'estimated_volume_m3'," + a + '.estimated_volume_m3::text,',
    "'komerce_category'," + a + '.komerce_category,',
    "'target_margin_pct'," + a + '.target_margin_pct::text,',
    "'data_sources'," + a + '.data_sources,',
    "'normalized_source_contract'," + a + '.normalized_source_contract)',
    'AND ev.triggered_by IS NOT NULL AND length(btrim(ev.notes)) >= 30',
    'ORDER BY ev.created_at DESC, ev.id DESC LIMIT 1',
    '),FALSE)',
  ].join(' ');
}

async function recordControlledWatchReview(candidateRef, { action, reason } = {}, actorId, database = db) {
  const decision = String(action || '').trim().toUpperCase();
  const rationale = String(reason || '').trim();
  if (!UUID.test(String(actorId || ''))) {
    throw new ControlledWatchReviewError(403, 'REVIEWER_ID_REQUIRED', 'Administrateur authentifié requis');
  }
  if (![AUTHORIZE, REVOKE].includes(decision)) {
    throw new ControlledWatchReviewError(400, 'WATCH_ACTION_INVALID', 'Décision commerciale inconnue');
  }
  if (rationale.length < 30 || rationale.length > 1500) {
    throw new ControlledWatchReviewError(400, 'WATCH_REASON_REQUIRED', 'Motif explicite requis (30 à 1 500 caractères)');
  }
  if (typeof database.withTransaction !== 'function') {
    throw new Error('WATCH_REVIEW_TRANSACTION_REQUIRED');
  }
  return database.withTransaction(async tx => {
    const { rows: [row] } = await tx.query(
      'SELECT sc.*, p.is_active AS catalog_product_active FROM sourcing_candidates sc ' +
      'LEFT JOIN products p ON p.id=sc.product_id WHERE sc.candidate_ref=$1 FOR UPDATE OF sc',
      [candidateRef]
    );
    if (!row) throw new ControlledWatchReviewError(404, 'CANDIDATE_NOT_FOUND', 'Candidat introuvable');
    const evaluation = evaluateWatchEligibility(row);
    if (decision === AUTHORIZE && !evaluation.eligible) {
      throw new ControlledWatchReviewError(409, 'WATCH_NOT_ELIGIBLE_FOR_MANUAL_TEST',
        'La décision WATCH exige d’abord une correction des données ou des risques.', evaluation.reasons);
    }
    if (decision === REVOKE && !row.scan_at) {
      throw new ControlledWatchReviewError(409, 'CURRENT_SCAN_REQUIRED', 'Aucun scan à révoquer');
    }
    const currentScanAt = new Date(row.scan_at).toISOString();
    const evidence = {
      kind: KIND,
      action: decision,
      scan_at: currentScanAt,
      scan_result: row.scan_result,
      facts: inputSnapshot(row),
      margin_pct: evaluation.margin_pct,
    };
    await tx.query(
      "INSERT INTO sourcing_candidate_events (candidate_id,event_type,result,notes,triggered_by) " +
      "VALUES ($1,'note_added',$2::jsonb,$3,$4)",
      [row.id, JSON.stringify(evidence), rationale, actorId]
    );
    return {
      candidate_ref: candidateRef,
      economic_decision: String(row.scan_result?.sourcing_decision || 'UNKNOWN'),
      commercial_review: decision,
      current_scan_at: currentScanAt,
      catalogue_publication_changed: false,
      market_price_changed: false,
    };
  });
}

module.exports = {
  KIND, AUTHORIZE, REVOKE,
  inputSnapshot, evaluateWatchEligibility, authorizedWatchSql,
  recordControlledWatchReview, ControlledWatchReviewError,
};
