/**
 * @komerce-arch
 * @role          supplier-discovery-semantic-relevance
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        normalized supplier product, discovery query
 * @outputs       deterministic provider-independent relevance evidence
 * @depends       none
 * @used-by       AliExpress and CJ discovery/stress pipelines
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      supplier_independent_discovery_relevance, deterministic_no_paid_ai
 * @impact-areas  sourcing, catalog, supplier-integration, staging-e2e
 * @version       2026-09-v1
 */
'use strict';

const GATE_VERSION = 'supplier-discovery-semantic-v1';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'your', 'this', 'that',
  'new', 'mini', 'plus', 'pro', 'version',
]);

function normalizeToken(token) {
  let out = String(token || '').toLowerCase();
  if (out.length > 4 && out.endsWith('ies')) out = `${out.slice(0, -3)}y`;
  else if (out.length > 5 && /(?:sses|shes|ches|xes|zes)$/.test(out)) out = out.slice(0, -2);
  else if (out.length > 3 && out.endsWith('s') && !out.endsWith('ss')) out = out.slice(0, -1);
  return out;
}

function tokens(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
    .map(normalizeToken)
    .filter(Boolean);
}

function productText(product = {}) {
  const specs = Array.isArray(product.specifications)
    ? product.specifications.flatMap((spec) => [spec?.label, spec?.value])
    : [];
  return [product.product_name, product.supplier_category, product.description, ...specs]
    .filter(Boolean)
    .join(' ');
}

function requiredMatchCount(queryTokenCount) {
  if (queryTokenCount <= 0) return 0;
  if (queryTokenCount <= 2) return 1;
  return Math.max(2, Math.ceil(queryTokenCount * 0.6));
}

function intentAnchors(queryTokens) {
  if (!queryTokens.length) return [];
  return queryTokens.length >= 4 ? queryTokens.slice(-2) : queryTokens.slice(-1);
}

function audit(product, query) {
  const queryTokens = [...new Set(tokens(query))];
  const sourceTokens = new Set(tokens(productText(product)));
  const matchedTokens = queryTokens.filter((token) => sourceTokens.has(token));
  const anchors = intentAnchors(queryTokens);
  const matchedAnchors = anchors.filter((token) => sourceTokens.has(token));
  const requiredMatches = requiredMatchCount(queryTokens.length);
  const coverageRatio = queryTokens.length ? matchedTokens.length / queryTokens.length : 0;
  return {
    gate_version: GATE_VERSION,
    relevant: requiredMatches > 0
      && matchedTokens.length >= requiredMatches
      && matchedAnchors.length >= 1,
    query_tokens: queryTokens,
    matched_tokens: matchedTokens,
    required_matches: requiredMatches,
    coverage_ratio: Number(coverageRatio.toFixed(3)),
    intent_anchors: anchors,
    matched_intent_anchors: matchedAnchors,
  };
}

module.exports = {
  GATE_VERSION,
  STOPWORDS,
  normalizeToken,
  tokens,
  productText,
  requiredMatchCount,
  intentAnchors,
  audit,
};
