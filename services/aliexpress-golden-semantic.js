'use strict';

/**
 * Deterministic semantic gate for the AliExpress Golden E2E probe.
 * It is intentionally conservative: a search hit must share meaningful
 * source terms with the query before it can become the Golden candidate.
 */
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
  return [
    product.product_name,
    product.supplier_category,
    product.description,
    ...specs,
  ].filter(Boolean).join(' ');
}

function audit(product, query) {
  const queryTokens = [...new Set(tokens(query))];
  const sourceTokens = new Set(tokens(productText(product)));
  const matchedTokens = queryTokens.filter((token) => sourceTokens.has(token));
  const requiredMatches = queryTokens.length >= 4 ? 2 : queryTokens.length ? 1 : 0;
  return {
    relevant: requiredMatches > 0 && matchedTokens.length >= requiredMatches,
    query_tokens: queryTokens,
    matched_tokens: matchedTokens,
    required_matches: requiredMatches,
  };
}

module.exports = { tokens, audit };
