#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-termium-reference-import
 * @domain        catalog
 * @layer         tooling
 * @criticality   medium
 * @inputs        official TERMIUM CSV files + optional FR Quality workpack corpus
 * @outputs       relevant sourced terminology references + coverage report
 * @depends       db.js, papaparse, services/catalog-terminology-memory.js
 * @used-by       isolated-catalog-termium-memory.yml
 * @db-read       catalog_terminology_reference
 * @db-write      catalog_terminology_reference
 * @db-txn        one import transaction
 * @doctrine      external_reference_not_editorial_authority, relevance_filtered_import
 * @impact-areas  catalog, product-detail, staging
 * @version       2026-09-v1
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Papa = require('papaparse');
const db = require('../db');
const {
  normalizeTerm,
  candidateNgrams,
} = require('../services/catalog-terminology-memory');

const SOURCE = 'termium_plus';
const LICENSE = 'Open Government Licence – Canada';
const ATTRIBUTION = 'Contains information licensed under the Open Government Licence – Canada.';
const SOURCE_DATA_DATE = '2026-05-04';
const DEFAULT_REPORT = path.resolve('artifacts/catalog-termium/report.json');
const DEFAULT_OUTPUT = path.resolve('artifacts/catalog-termium/relevant-references.json');

function parseArgs(argv = process.argv.slice(2)) {
  let csvDir = null;
  let corpusDir = null;
  let report = DEFAULT_REPORT;
  let output = DEFAULT_OUTPUT;
  let execute = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--csv-dir') csvDir = path.resolve(String(argv[++i] || '').trim());
    else if (arg.startsWith('--csv-dir=')) csvDir = path.resolve(String(arg.split('=', 2)[1] || '').trim());
    else if (arg === '--corpus-dir') corpusDir = path.resolve(String(argv[++i] || '').trim());
    else if (arg.startsWith('--corpus-dir=')) corpusDir = path.resolve(String(arg.split('=', 2)[1] || '').trim());
    else if (arg === '--report') report = path.resolve(String(argv[++i] || '').trim());
    else if (arg.startsWith('--report=')) report = path.resolve(String(arg.split('=', 2)[1] || '').trim());
    else if (arg === '--output') output = path.resolve(String(argv[++i] || '').trim());
    else if (arg.startsWith('--output=')) output = path.resolve(String(arg.split('=', 2)[1] || '').trim());
    else if (arg === '--execute') execute = true;
    else if (arg === '--dry-run') execute = false;
    else throw new Error(`Argument inconnu: ${arg}`);
  }

  if (!csvDir) throw new Error('--csv-dir requis');
  if (!corpusDir) throw new Error('--corpus-dir requis');
  return { csvDir, corpusDir, report, output, execute };
}

function assertDisposableRuntime(env = process.env) {
  if (String(env.KOMERCE_ENV || '').trim().toLowerCase() !== 'staging' || env.NODE_ENV !== 'test') {
    throw new Error('REFUS: KOMERCE_ENV=staging et NODE_ENV=test requis');
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  const url = new URL(env.DATABASE_URL);
  const dbName = String(url.pathname || '').replace(/^\//, '');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || dbName !== 'komerce_real_catalog_stress') {
    throw new Error('REFUS: base jetable localhost komerce_real_catalog_stress requise');
  }
}

function listFilesRecursive(root, extension) {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full, extension));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) out.push(full);
  }
  return out.sort();
}

function normalizedHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizedRow(row) {
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [normalizedHeader(key), value]));
}

function pick(row, keys) {
  for (const key of keys) {
    const value = row[normalizedHeader(key)];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return null;
}

function loadCorpus(corpusDir) {
  const files = listFilesRecursive(corpusDir, '.json')
    .filter(file => /^batch-\d+\.json$/i.test(path.basename(file)));
  const ngrams = new Set();
  let productCount = 0;

  for (const file of files) {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const product of payload.products || []) {
      productCount += 1;
      for (const ngram of candidateNgrams(product.source || {}, 7)) ngrams.add(ngram);
    }
  }

  if (!productCount) throw new Error('CORPUS_EMPTY: aucun produit trouvé dans les batch-*.json');
  return { ngrams, productCount, files: files.length };
}

function datasetDomainFromPath(file) {
  const parts = file.split(path.sep);
  const parent = parts.length >= 2 ? parts[parts.length - 2] : '';
  return String(parent || path.basename(file, path.extname(file))).replace(/[_-]+/g, ' ').trim();
}

function recordFromCsvRow(raw, file) {
  const row = normalizedRow(raw);
  const termEn = pick(row, ['term_en', 'english_term', 'terme_en', 'english']);
  const termFr = pick(row, ['terme_fr', 'term_fr', 'french_term', 'french']);
  if (!termEn || !termFr) return null;

  const subjectEn = pick(row, ['subject_en', 'domain_en', 'field_en']);
  const subjectFr = pick(row, ['domaine_fr', 'subject_fr', 'domain_fr', 'field_fr']);
  const sourceRecordId = pick(row, ['id', 'record_id', 'fiche_id', 'record']);
  const datasetDomain = datasetDomainFromPath(file);

  const identity = JSON.stringify([
    SOURCE,
    sourceRecordId || '',
    datasetDomain,
    subjectEn || '',
    subjectFr || '',
    termEn,
    termFr,
  ]);
  const referenceKey = crypto.createHash('sha256').update(identity).digest('hex');

  return {
    reference_key: referenceKey,
    source: SOURCE,
    source_record_id: sourceRecordId,
    dataset_domain: datasetDomain || null,
    subject_en: subjectEn,
    subject_fr: subjectFr,
    term_en: termEn,
    term_en_normalized: normalizeTerm(termEn),
    term_fr: termFr,
    term_fr_normalized: normalizeTerm(termFr),
    term_en_parameter: pick(row, ['term_en_parameter', 'parameter_en', 'parametre_en']),
    term_fr_parameter: pick(row, ['term_fr_parameter', 'parameter_fr', 'parametre_fr']),
    abbreviation_en: pick(row, ['abbreviation_en', 'abbr_en']),
    abbreviation_fr: pick(row, ['abbreviation_fr', 'abbr_fr']),
    source_url: 'https://open.canada.ca/data/en/dataset/94fc74d6-9b9a-4c2e-9c6c-45a5092453aa',
    source_license: LICENSE,
    source_data_date: SOURCE_DATA_DATE,
    metadata: {
      csv_file: path.basename(file),
    },
  };
}

function parseCsvFile(file) {
  const input = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const parsed = Papa.parse(input, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: header => normalizedHeader(header),
  });
  if (parsed.errors?.some(error => error.type === 'Quotes' || error.type === 'Delimiter')) {
    throw new Error(`CSV_PARSE_FAILED:${path.basename(file)}:${JSON.stringify(parsed.errors.slice(0, 5))}`);
  }
  return parsed.data;
}

function collectRelevantReferences(csvDir, corpusNgrams) {
  const files = listFilesRecursive(csvDir, '.csv');
  if (!files.length) throw new Error('TERMIUM_CSV_EMPTY: aucun CSV trouvé');
  const refs = new Map();
  const stats = {
    csv_files: files.length,
    csv_rows: 0,
    bilingual_rows: 0,
    relevant_rows: 0,
    skipped_unmatched: 0,
    skipped_missing_pair: 0,
    by_domain: {},
  };

  for (const file of files) {
    const rows = parseCsvFile(file);
    stats.csv_rows += rows.length;
    for (const raw of rows) {
      const record = recordFromCsvRow(raw, file);
      if (!record) {
        stats.skipped_missing_pair += 1;
        continue;
      }
      stats.bilingual_rows += 1;
      if (!record.term_en_normalized || !corpusNgrams.has(record.term_en_normalized)) {
        stats.skipped_unmatched += 1;
        continue;
      }
      refs.set(record.reference_key, record);
      stats.relevant_rows += 1;
      const key = record.dataset_domain || '<unknown>';
      stats.by_domain[key] = (stats.by_domain[key] || 0) + 1;
    }
  }

  return { references: [...refs.values()], stats };
}

async function importReferences(q, references) {
  let upserted = 0;
  for (const ref of references) {
    // eslint-disable-next-line no-await-in-loop
    await q.query(
      `INSERT INTO catalog_terminology_reference (
         reference_key, source, source_record_id, dataset_domain,
         subject_en, subject_fr,
         term_en, term_en_normalized, term_fr, term_fr_normalized,
         term_en_parameter, term_fr_parameter,
         abbreviation_en, abbreviation_fr,
         source_url, source_license, source_data_date,
         metadata, is_active, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
         $11,$12,$13,$14,$15,$16,$17,$18::jsonb,TRUE,NOW()
       )
       ON CONFLICT (reference_key)
       DO UPDATE SET
         subject_en=EXCLUDED.subject_en,
         subject_fr=EXCLUDED.subject_fr,
         term_en=EXCLUDED.term_en,
         term_en_normalized=EXCLUDED.term_en_normalized,
         term_fr=EXCLUDED.term_fr,
         term_fr_normalized=EXCLUDED.term_fr_normalized,
         term_en_parameter=EXCLUDED.term_en_parameter,
         term_fr_parameter=EXCLUDED.term_fr_parameter,
         abbreviation_en=EXCLUDED.abbreviation_en,
         abbreviation_fr=EXCLUDED.abbreviation_fr,
         source_url=EXCLUDED.source_url,
         source_license=EXCLUDED.source_license,
         source_data_date=EXCLUDED.source_data_date,
         metadata=EXCLUDED.metadata,
         is_active=TRUE,
         updated_at=NOW()`,
      [
        ref.reference_key,
        ref.source,
        ref.source_record_id,
        ref.dataset_domain,
        ref.subject_en,
        ref.subject_fr,
        ref.term_en,
        ref.term_en_normalized,
        ref.term_fr,
        ref.term_fr_normalized,
        ref.term_en_parameter,
        ref.term_fr_parameter,
        ref.abbreviation_en,
        ref.abbreviation_fr,
        ref.source_url,
        ref.source_license,
        ref.source_data_date,
        JSON.stringify(ref.metadata || {}),
      ]
    );
    upserted += 1;
  }
  return upserted;
}

async function run(options = parseArgs()) {
  assertDisposableRuntime();
  const corpus = loadCorpus(options.corpusDir);
  const collected = collectRelevantReferences(options.csvDir, corpus.ngrams);

  const termKeys = new Set(collected.references.map(ref => ref.term_en_normalized));
  const summary = {
    mode: options.execute ? 'execute' : 'dry-run',
    corpus_products: corpus.productCount,
    corpus_files: corpus.files,
    corpus_unique_ngrams: corpus.ngrams.size,
    ...collected.stats,
    unique_references: collected.references.length,
    unique_english_terms: termKeys.size,
    attribution: ATTRIBUTION,
    source_license: LICENSE,
    source_data_date: SOURCE_DATA_DATE,
  };

  let imported = 0;
  if (options.execute) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      imported = await importReferences(client, collected.references);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  summary.imported = imported;

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.mkdirSync(path.dirname(options.report), { recursive: true });
  fs.writeFileSync(options.output, JSON.stringify({
    schema_version: 1,
    generated_at: new Date().toISOString(),
    attribution: ATTRIBUTION,
    source_license: LICENSE,
    references: collected.references,
  }, null, 2) + '\n');
  fs.writeFileSync(options.report, JSON.stringify({
    schema_version: 1,
    generated_at: new Date().toISOString(),
    summary,
  }, null, 2) + '\n');

  console.log(`[catalog-termium-import] ${JSON.stringify(summary)}`);
  return { summary, references: collected.references };
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`[catalog-termium-import] FAILED: ${error.stack || error.message || error}`);
      process.exit(1);
    })
    .finally(() => db.pool.end());
}

module.exports = {
  SOURCE,
  LICENSE,
  ATTRIBUTION,
  normalizeTerm,
  parseArgs,
  assertDisposableRuntime,
  normalizedHeader,
  normalizedRow,
  pick,
  loadCorpus,
  datasetDomainFromPath,
  recordFromCsvRow,
  parseCsvFile,
  collectRelevantReferences,
  importReferences,
  run,
};
