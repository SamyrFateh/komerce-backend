/**
 * @komerce-arch
 * @role          catalog-french-quality-contract
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        canonical source text, offline French translation proposal
 * @outputs       source fingerprint, static French editorial quality verdict
 * @depends       node:crypto
 * @used-by       scripts/catalog-fr-quality-workpack.js, scripts/catalog-fr-quality-apply.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      source_truth_preserved, offline_ai_assistance, no_runtime_llm_dependency
 * @impact-areas  catalog, product-detail, staging
 * @version       2026-09-v1
 */
'use strict';

const crypto = require('crypto');

const TITLE_MAX = 80;
const DESCRIPTION_MIN = 60;
const DESCRIPTION_MAX = 1200;

const ENGLISH_RESIDUE_WORDS = new Set([
  'adjustable', 'anti-slip', 'best', 'breathable', 'charging', 'comfortable',
  'fashion', 'foldable', 'holder', 'lightweight',
  'professional', 'rechargeable', 'replacement', 'shockproof', 'smart',
  'stand', 'storage', 'supporting', 'universal', 'waterproof', 'wireless',
]);

const MARKETING_NOISE = [
  /\bhot\s*sale\b/i,
  /\bbest\s*seller\b/i,
  /\bhigh\s*quality\b/i,
  /\bnew\s*arrival\b/i,
  /\bfactory\s*direct\b/i,
  /\bfree\s*shipping\b/i,
];

const TECH_TOKEN_RE = /\b\d+(?:[.,]\d+)?\s?(?:mah|wh|w|kw|v|a|hz|khz|mhz|ghz|gb|tb|mb|mm|cm|m|kg|g|mg|ml|l|inch|inches|mp|°c)\b/gi;

const FRENCH_MARKERS = new Set([
  'avec', 'pour', 'sans', 'dans', 'une', 'des', 'les', 'aux', 'sur', 'entre',
  'grâce', 'permet', 'permettant', 'adapté', 'adaptée', 'convient', 'utilisation',
  'recharge', 'charge', 'téléphone', 'produit', 'réglable', 'léger', 'légère',
  'résistant', 'résistante', 'comprend', 'offre', 'maintient', 'conçu', 'conçue',
]);
const SPANISH_MARKERS = new Set([
  'con', 'para', 'sin', 'una', 'unos', 'unas', 'los', 'las', 'del', 'el', 'esta',
  'este', 'permite', 'incluye', 'integrado', 'integrada', 'producto', 'carga',
  'telefono', 'teléfono', 'ajustable', 'ligero', 'ligera', 'resistente',
]);
const ENGLISH_MARKERS = new Set([
  'with', 'for', 'without', 'from', 'this', 'that', 'the', 'and', 'use', 'uses',
  'includes', 'integrated', 'product', 'charging', 'phone', 'adjustable', 'lightweight',
  'designed', 'provides', 'keeps', 'made',
]);

const CONTROLLED_CLAIM_PATTERNS = [
  /\bbluetooth\s*v?\d+(?:\.\d+)?\b/gi,
  /\bip(?:x?\d{1,2}|\d{2})\b/gi,
  /\b(?:gps|nfc)\b/gi,
  /\busb(?:\s*[- ]?\s*(?:a|b|c)|\s*\d+(?:\.\d+)?)\b/gi,
  /\bwi-?fi\s*\d+\b/gi,
];

function normalizeSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function compactJson(value, max = 6000) {
  if (value == null) return null;
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  const clean = normalizeSpace(raw);
  return clean ? clean.slice(0, max) : null;
}

function boundedArray(value, maxItems = 20) {
  if (!Array.isArray(value)) return null;
  return value.slice(0, maxItems);
}

function sourceDocumentFromRow(row = {}) {
  const contract = row.normalized_source_contract || {};
  return {
    product_ref: String(row.product_ref || '').trim(),
    supplier_name: String(row.supplier_name || '').trim(),
    supplier_product_id: String(row.supplier_product_id || '').trim(),
    source_locale: String(contract.source_locale || row.source_locale || '').trim() || null,
    title: normalizeSpace(contract.product_name || row.name_source || row.current_name),
    description: compactJson(contract.description || row.description_source, 10000),
    supplier_category: normalizeSpace(contract.supplier_category || row.supplier_category) || null,
    current_category: normalizeSpace(row.category) || null,
    current_subcategory: normalizeSpace(row.subcategory) || null,
    brand: normalizeSpace(contract.brand) || null,
    highlights: boundedArray(contract.highlights),
    specifications: boundedArray(contract.specifications),
    materials: boundedArray(contract.materials),
    care: boundedArray(contract.care),
    warnings: boundedArray(contract.warnings),
    option_axes: boundedArray(contract.option_axes, 12),
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, stableValue(value[key])])
    );
  }
  return value;
}

function sourceFingerprint(source) {
  const stable = JSON.stringify(stableValue(source));
  return crypto.createHash('sha256').update(stable).digest('hex');
}

function proposalFingerprint({ source_hash: sourceHash, title_fr: titleFr, description_fr: descriptionFr } = {}) {
  return crypto.createHash('sha256').update(JSON.stringify({
    source_hash: String(sourceHash || '').trim(),
    title_fr: normalizeSpace(titleFr),
    description_fr: normalizeSpace(descriptionFr),
  })).digest('hex');
}

function technicalTokens(value) {
  const text = normalizeSpace(value).toLowerCase().replace(/,/g, '.');
  const tokens = new Set();
  for (const match of text.matchAll(TECH_TOKEN_RE)) {
    tokens.add(match[0].replace(/\s+/g, ''));
  }
  return [...tokens].sort();
}

function sourceText(source = {}) {
  return [
    source.title,
    source.description,
    source.brand,
    compactJson(source.highlights),
    compactJson(source.specifications),
    compactJson(source.materials),
    compactJson(source.care),
    compactJson(source.warnings),
    compactJson(source.option_axes),
  ].filter(Boolean).join(' ');
}

function englishResidues(value) {
  const text = normalizeSpace(value).toLowerCase();
  const words = text.match(/[a-z][a-z-]{2,}/g) || [];
  return [...new Set(words.filter(word => ENGLISH_RESIDUE_WORDS.has(word)))];
}

function languageScores(value) {
  const text = normalizeSpace(value).toLowerCase();
  const words = text.match(/[a-zàâçéèêëîïôùûüÿœñáíóú]+/giu) || [];
  const score = (set) => words.reduce((total, word) => total + (set.has(word) ? 1 : 0), 0);
  return {
    french: score(FRENCH_MARKERS) + (/[àâçéèêëîïôùûüÿœ]/i.test(text) ? 1 : 0),
    spanish: score(SPANISH_MARKERS) + (/[ñáíóú]/i.test(text) ? 1 : 0),
    english: score(ENGLISH_MARKERS),
  };
}

function looksFrench(value) {
  const scores = languageScores(value);
  return scores.french >= 3
    && scores.french >= scores.spanish + 1
    && scores.french >= scores.english + 1;
}

function controlledClaims(value) {
  const text = normalizeSpace(value).toLowerCase();
  const claims = new Set();
  for (const pattern of CONTROLLED_CLAIM_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      claims.add(match[0].replace(/\s+/g, '').replace(/_/g, '-'));
    }
  }
  return [...claims].sort();
}

function criticalTechnicalTokens(value) {
  return technicalTokens(value).filter(token =>
    /(?:mah|wh|w|kw|v|a|gb|tb|mb)$/i.test(token)
  );
}

function evaluateFrenchCopy(source, proposal = {}) {
  const title = normalizeSpace(proposal.title_fr);
  const description = normalizeSpace(proposal.description_fr);
  const blocking = [];
  const warnings = [];

  if (title.length < 4) blocking.push('title_too_short');
  if (title.length > TITLE_MAX) blocking.push('title_too_long');
  if (/https?:\/\/|www\./i.test(title)) blocking.push('title_contains_url');
  if (MARKETING_NOISE.some(pattern => pattern.test(title))) blocking.push('title_marketing_noise');

  if (description.length < DESCRIPTION_MIN) blocking.push('description_too_short');
  if (description.length > DESCRIPTION_MAX) blocking.push('description_too_long');

  if (!looksFrench(`${title}. ${description}`)) blocking.push('french_not_detected');

  const titleEnglish = englishResidues(title);
  const descriptionEnglish = englishResidues(description);
  if (titleEnglish.length >= 1) blocking.push('english_residue_in_title');
  if (descriptionEnglish.length >= 3) blocking.push('english_residue_in_description');

  const sourceFullText = sourceText(source);
  const outputFullText = `${title} ${description}`;
  const srcTech = new Set(technicalTokens(sourceFullText));
  const outTech = technicalTokens(outputFullText);
  const invented = outTech.filter(token => !srcTech.has(token));
  if (invented.length) blocking.push('invented_technical_token');

  const srcControlled = new Set(controlledClaims(sourceFullText));
  const outControlled = controlledClaims(outputFullText);
  const inventedControlled = outControlled.filter(claim => !srcControlled.has(claim));
  if (inventedControlled.length) blocking.push('invented_controlled_claim');

  const sourceCritical = new Set([
    ...criticalTechnicalTokens(sourceFullText),
    ...srcControlled,
  ]);
  const outputClaims = new Set([
    ...criticalTechnicalTokens(outputFullText),
    ...outControlled,
  ]);
  const omittedCritical = [...sourceCritical].filter(token => !outputClaims.has(token));
  if (omittedCritical.length) blocking.push('critical_source_claim_omitted');

  const omitted = [...srcTech].filter(token => !outTech.includes(token));
  if (omitted.length) warnings.push('source_technical_tokens_omitted');

  if (source.title && title.toLowerCase() === normalizeSpace(source.title).toLowerCase()) {
    warnings.push('title_unchanged_from_source');
  }

  return {
    ok: blocking.length === 0,
    blocking,
    warnings,
    diagnostics: {
      title_length: title.length,
      description_length: description.length,
      title_english_residues: titleEnglish,
      description_english_residues: descriptionEnglish,
      source_technical_tokens: [...srcTech],
      output_technical_tokens: outTech,
      invented_technical_tokens: invented,
      omitted_source_technical_tokens: omitted,
      source_controlled_claims: [...srcControlled],
      output_controlled_claims: outControlled,
      invented_controlled_claims: inventedControlled,
      omitted_critical_source_claims: omittedCritical,
      language_scores: languageScores(`${title}. ${description}`),
    },
  };
}

module.exports = {
  TITLE_MAX,
  DESCRIPTION_MIN,
  DESCRIPTION_MAX,
  normalizeSpace,
  sourceDocumentFromRow,
  sourceFingerprint,
  proposalFingerprint,
  _stableValue: stableValue,
  technicalTokens,
  englishResidues,
  languageScores,
  looksFrench,
  controlledClaims,
  criticalTechnicalTokens,
  evaluateFrenchCopy,
};
