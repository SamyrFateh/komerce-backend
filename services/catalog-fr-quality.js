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
  'adjustable', 'anti-slip', 'best', 'breathable', 'charger', 'charging', 'comfortable',
  'compatible', 'durable', 'fashion', 'foldable', 'holder', 'lightweight', 'portable',
  'premium', 'professional', 'rechargeable', 'replacement', 'shockproof', 'smart',
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
    compactJson(source.option_axes),
  ].filter(Boolean).join(' ');
}

function englishResidues(value) {
  const text = normalizeSpace(value).toLowerCase();
  const words = text.match(/[a-z][a-z-]{2,}/g) || [];
  return [...new Set(words.filter(word => ENGLISH_RESIDUE_WORDS.has(word)))];
}

function looksFrench(value) {
  const text = ` ${normalizeSpace(value).toLowerCase()} `;
  if (!text.trim()) return false;
  const markers = [
    ' avec ', ' pour ', ' une ', ' un ', ' des ', ' les ', ' dans ', ' sans ',
    ' sur ', ' et ', ' de ', ' du ', ' la ', ' le ', ' à ', ' au ', ' aux ',
  ];
  return markers.filter(marker => text.includes(marker)).length >= 2
    || /[àâçéèêëîïôùûüÿœ]/i.test(text);
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

  const srcTech = new Set(technicalTokens(sourceText(source)));
  const outTech = technicalTokens(`${title} ${description}`);
  const invented = outTech.filter(token => !srcTech.has(token));
  if (invented.length) blocking.push('invented_technical_token');

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
  _stableValue: stableValue,
  technicalTokens,
  englishResidues,
  looksFrench,
  evaluateFrenchCopy,
};
