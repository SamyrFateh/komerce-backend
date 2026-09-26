/**
 * @komerce-arch
 * @role          catalog-terminology-memory
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        source text, catalog_glossary, catalog_terminology_reference
 * @outputs       curated glossary hits + sourced external terminology candidates
 * @depends       none
 * @used-by       scripts/catalog-fr-quality-workpack.js, scripts/catalog-termium-import.js
 * @db-read       catalog_glossary, catalog_terminology_reference
 * @db-write      none
 * @db-txn        none
 * @doctrine      curated_glossary_over_external_reference, source_provenance_required
 * @impact-areas  catalog, product-detail, staging
 * @version       2026-09-v1
 */
'use strict';

const STOPWORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'is', 'it',
  'of', 'on', 'or', 'the', 'to', 'with', 'without', 'your', 'this', 'that',
]);

function normalizeTerm(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, ' ')
    .replace(/[^a-z0-9+.#/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function flattenText(value, out = []) {
  if (value == null) return out;
  if (Array.isArray(value)) {
    for (const item of value) flattenText(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) flattenText(item, out);
    return out;
  }
  const text = String(value).trim();
  if (text) out.push(text);
  return out;
}

function sourceTextParts(source = {}) {
  return flattenText({
    title: source.title,
    description: source.description,
    supplier_category: source.supplier_category,
    brand: source.brand,
    highlights: source.highlights,
    specifications: source.specifications,
    materials: source.materials,
    care: source.care,
    warnings: source.warnings,
    option_axes: source.option_axes,
  });
}

function candidateNgrams(source, maxWords = 7) {
  const set = new Set();

  for (const part of sourceTextParts(source)) {
    const normalized = normalizeTerm(part);
    if (!normalized) continue;
    const words = normalized.split(' ').filter(Boolean);
    for (let i = 0; i < words.length; i += 1) {
      for (let size = 1; size <= maxWords && i + size <= words.length; size += 1) {
        const slice = words.slice(i, i + size);
        if (size === 1) {
          const word = slice[0];
          if (STOPWORDS.has(word)) continue;
          if (word.length < 3 && !/\d/.test(word)) continue;
        }
        set.add(slice.join(' '));
      }
    }
  }

  return [...set];
}

async function loadTerminologyHints(q, source, { maxReferences = 80 } = {}) {
  const candidates = candidateNgrams(source);
  if (!candidates.length) return { curated: [], references: [] };

  const candidateSet = new Set(candidates);
  const { rows: allCuratedRows } = await q.query(
    `SELECT term_source, term_fr, note
       FROM catalog_glossary
      WHERE is_active=TRUE
      ORDER BY length(term_source) DESC, term_source`
  );
  const curatedRows = allCuratedRows.filter(row => candidateSet.has(normalizeTerm(row.term_source)));

  const { rows: referenceRows } = await q.query(
    `SELECT source, source_record_id, dataset_domain,
            subject_en, subject_fr,
            term_en, term_fr,
            term_en_parameter, term_fr_parameter,
            abbreviation_en, abbreviation_fr,
            source_url, source_license, source_data_date
       FROM catalog_terminology_reference
      WHERE is_active=TRUE
        AND term_en_normalized = ANY($1::text[])
      ORDER BY length(term_en_normalized) DESC,
               source,
               dataset_domain NULLS LAST,
               subject_en NULLS LAST,
               term_en,
               term_fr
      LIMIT $2`,
    [candidates, maxReferences]
  );

  return {
    curated: curatedRows.map(row => ({
      authority: 'KOMERCE_CURATED',
      term_source: row.term_source,
      term_fr: row.term_fr,
      preserve_exact: row.term_fr === '=',
      note: row.note || null,
    })),
    references: referenceRows.map(row => ({
      authority: 'EXTERNAL_REFERENCE',
      source: row.source,
      source_record_id: row.source_record_id,
      dataset_domain: row.dataset_domain,
      subject_en: row.subject_en,
      subject_fr: row.subject_fr,
      term_en: row.term_en,
      term_fr: row.term_fr,
      term_en_parameter: row.term_en_parameter,
      term_fr_parameter: row.term_fr_parameter,
      abbreviation_en: row.abbreviation_en,
      abbreviation_fr: row.abbreviation_fr,
      source_url: row.source_url,
      source_license: row.source_license,
      source_data_date: row.source_data_date,
    })),
  };
}

module.exports = {
  normalizeTerm,
  sourceTextParts,
  candidateNgrams,
  loadTerminologyHints,
};
