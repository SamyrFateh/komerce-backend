/**
 * @komerce-arch
 * @role          sourcing-resolution-evidence
 * @domain        sourcing
 * @layer         service
 * @criticality   medium
 * @inputs        immutable_observation, candidate_evidence
 * @outputs       normalized_evidence, candidate_scores, resolution_route
 * @depends       none
 * @used-by       services/sourcing-shadow-resolution-service.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SOURCE_RESOLUTION.md, docs/doctrine/DOCTRINE_SOURCE_SHADOW_RESOLUTION.md
 * @impact-areas  sourcing
 * @version       2026-09
 */
'use strict';

const GTIN_KEYS = new Set(['gtin', 'ean', 'ean8', 'ean13', 'upc', 'upca', 'barcode']);
const MPN_KEYS = new Set(['mpn', 'manufacturerpartnumber', 'manufacturerreference', 'partnumber']);
const MODEL_KEYS = new Set(['model', 'modelnumber', 'manufacturer_model']);

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().replace(/\s+/g, ' ');
}

function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function keyToken(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '');
}

function sourceScopedRef(sourceId, sourceRef) {
  return JSON.stringify([String(sourceId || '').trim(), String(sourceRef || '').trim()]);
}

function optionSignature(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
  const pairs = Object.entries(values)
    .map(([key, value]) => [normalizeText(key), normalizeText(value)])
    .filter(([key, value]) => key && value)
    .sort(([a], [b]) => a.localeCompare(b));
  return pairs.length ? pairs.map(([key, value]) => `${key}=${value}`).join('|') : null;
}

function uniqueEvidence(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    if (!item?.value) continue;
    const k = `${item.evidence_type}\u001f${item.evidence_key}\u001f${item.value}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function add(items, evidenceType, evidenceKey, value) {
  if (value == null || String(value).trim() === '') return;
  items.push({ evidence_type: evidenceType, evidence_key: evidenceKey, value: String(value) });
}

function extractProductEvidence(normalized, items) {
  const brand = normalizeText(normalized.brand);
  const productName = normalizeText(normalized.product_name);
  const category = normalizeText(normalized.supplier_category);
  let model = '';

  if (brand) add(items, 'attribute', 'brand', brand);
  if (productName) add(items, 'lexical', 'product_name', productName);
  if (category) add(items, 'attribute', 'supplier_category', category);

  for (const spec of normalized.specifications || []) {
    const tokens = [keyToken(spec?.key), keyToken(spec?.label)].filter(Boolean);
    const rawValue = String(spec?.value ?? '').trim();
    if (!rawValue) continue;

    if (tokens.some((token) => GTIN_KEYS.has(token))) {
      const digits = rawValue.replace(/\D/g, '');
      if (digits.length >= 8 && digits.length <= 14) add(items, 'deterministic_id', 'gtin', digits);
    }
    if (tokens.some((token) => MPN_KEYS.has(token))) {
      add(items, 'deterministic_id', 'mpn', normalizeCode(rawValue));
    }
    if (!model && tokens.some((token) => MODEL_KEYS.has(token))) {
      model = normalizeText(rawValue);
      if (model) add(items, 'lexical', 'model', model);
    }
  }

  if (brand && model) add(items, 'lexical', 'brand_model', `${brand} ${model}`);
}

function extractObservationEvidence(observation) {
  const items = [];
  const normalized = observation?.normalized || {};
  const grain = String(observation?.grain || '');

  if (observation?.source_id && observation?.source_ref) {
    add(items, 'source_ref', 'source_scoped_ref', sourceScopedRef(observation.source_id, observation.source_ref));
  }

  if (grain === 'product') extractProductEvidence(normalized, items);
  if (grain === 'unit') {
    const signature = optionSignature(normalized.option_values);
    if (signature) add(items, 'lexical', 'option_signature', signature);
  }

  return uniqueEvidence(items);
}

function evidenceWeight(evidence) {
  const key = `${evidence.evidence_type}:${evidence.evidence_key}`;
  if (key === 'source_ref:source_scoped_ref') return 1;
  if (key === 'deterministic_id:gtin') return 1;
  if (key === 'deterministic_id:mpn') return 0.85;
  if (key === 'lexical:brand_model') return 0.65;
  if (key === 'lexical:model') return 0.35;
  if (key === 'lexical:product_name') return 0.35;
  if (key === 'lexical:option_signature') return 0.75;
  if (key === 'attribute:brand') return 0.25;
  if (key === 'attribute:supplier_category') return 0.1;
  return 0.05;
}

function evidenceMap(items) {
  const map = new Map();
  for (const item of items || []) {
    const key = `${item.evidence_type}\u001f${item.evidence_key}`;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(item.value);
  }
  return map;
}

function hasExact(items, type, key, candidateMap) {
  return (items || []).some((item) => {
    if (item.evidence_type !== type || item.evidence_key !== key) return false;
    return candidateMap.get(`${type}\u001f${key}`)?.has(item.value) || false;
  });
}

function round5(n) {
  return Math.round(Math.max(0, Math.min(1, n)) * 100000) / 100000;
}

function scoreCandidate(currentEvidence, candidateEvidence, hints = {}) {
  const candidateMap = evidenceMap(candidateEvidence);
  let total = 0;
  let compared = 0;
  let matched = 0;
  let contradicted = 0;
  const matchedEvidence = [];
  const contradictions = [];

  for (const item of currentEvidence || []) {
    const weight = evidenceWeight(item);
    total += weight;
    const key = `${item.evidence_type}\u001f${item.evidence_key}`;
    const candidateValues = candidateMap.get(key);
    if (!candidateValues?.size) continue;
    compared += weight;
    if (candidateValues.has(item.value)) {
      matched += weight;
      matchedEvidence.push(item);
    } else if (item.evidence_type === 'deterministic_id' ||
               (item.evidence_type === 'attribute' && item.evidence_key === 'brand')) {
      contradicted += weight;
      contradictions.push({ ...item, candidate_values: [...candidateValues] });
    }
  }

  const denominator = total || 1;
  return {
    support_score: round5(matched / denominator),
    contradiction_score: round5(contradicted / denominator),
    coverage_score: round5(compared / denominator),
    source_ref_exact: Boolean(hints.sourceRefExact) || hasExact(currentEvidence, 'source_ref', 'source_scoped_ref', candidateMap),
    gtin_exact: hasExact(currentEvidence, 'deterministic_id', 'gtin', candidateMap),
    mpn_exact: hasExact(currentEvidence, 'deterministic_id', 'mpn', candidateMap),
    brand_exact: hasExact(currentEvidence, 'attribute', 'brand', candidateMap),
    brand_model_exact: hasExact(currentEvidence, 'lexical', 'brand_model', candidateMap),
    matched_evidence: matchedEvidence,
    contradictions,
  };
}

function rankCandidate(candidate) {
  if (candidate.source_ref_exact && candidate.contradiction_score === 0) return 100;
  if (candidate.gtin_exact && candidate.contradiction_score === 0) return 90;
  if (candidate.mpn_exact && candidate.brand_exact && candidate.contradiction_score === 0) return 70;
  return Math.round((candidate.support_score * 50) + (candidate.coverage_score * 20) - (candidate.contradiction_score * 60));
}

function chooseResolutionRoute(candidates) {
  if (!candidates?.length) return { action: 'NEW_CANONICAL', candidate: null, reason: 'no_candidate' };
  const ordered = [...candidates].sort((a, b) => rankCandidate(b) - rankCandidate(a));
  const auto = ordered.filter((candidate) =>
    candidate.contradiction_score === 0 && (candidate.source_ref_exact || candidate.gtin_exact)
  );
  const distinctAutoIds = new Set(auto.map((candidate) => candidate.canonical_entity_id));

  if (distinctAutoIds.size === 1) {
    const candidate = auto[0];
    return {
      action: 'LINK',
      candidate,
      reason: candidate.source_ref_exact ? 'exact_source_ref' : 'exact_gtin',
    };
  }

  return {
    action: 'REVIEW_REQUIRED',
    candidate: ordered[0],
    reason: distinctAutoIds.size > 1 ? 'ambiguous_strong_candidates' : 'insufficient_identity_evidence',
  };
}

module.exports = {
  extractObservationEvidence,
  scoreCandidate,
  chooseResolutionRoute,
  normalizeText,
  optionSignature,
  sourceScopedRef,
  _evidenceWeight: evidenceWeight,
};
