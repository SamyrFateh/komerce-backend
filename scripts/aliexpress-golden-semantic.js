/**
 * @komerce-arch
 * @role          aliexpress-golden-semantic-gate
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        AliExpress normalized product, Golden discovery query
 * @outputs       deterministic semantic relevance audit
 * @depends       none
 * @used-by       scripts/aliexpress-golden-e2e.js, scripts/aliexpress-golden-repair-existing.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  sourcing, catalog, supplier-integration, staging
 * @version       2026-09-golden-semantic-v2
 */
'use strict';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'your', 'this', 'that',
  'new', 'mini', 'plus', 'pro', 'version',
]);

function tokens(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
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

function audit(product, query) {
  const queryTokens = [...new Set(tokens(query))];
  const sourceTokens = new Set(tokens(productText(product)));
  const matchedTokens = queryTokens.filter((token) => sourceTokens.has(token));
  const requiredMatches = requiredMatchCount(queryTokens.length);
  const coverageRatio = queryTokens.length ? matchedTokens.length / queryTokens.length : 0;
  return {
    relevant: requiredMatches > 0 && matchedTokens.length >= requiredMatches,
    query_tokens: queryTokens,
    matched_tokens: matchedTokens,
    required_matches: requiredMatches,
    coverage_ratio: Number(coverageRatio.toFixed(3)),
  };
}

module.exports = { tokens, requiredMatchCount, audit };
