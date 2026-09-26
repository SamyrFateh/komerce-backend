'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  pool: { end: jest.fn() },
}));

const importer = require('../../scripts/catalog-termium-import');

describe('catalog TERMIUM importer', () => {
  test('maps official-style EN/FR columns and keeps provenance', () => {
    const row = importer.normalizedRow({
      id: '42',
      subject_en: 'Electronics',
      term_en: 'power bank',
      term_en_parameter: 'correct',
      abbreviation_en: 'PB',
      terme_fr: 'batterie externe',
      domaine_fr: 'Électronique',
    });
    const record = importer.recordFromCsvRow(row, '/tmp/electronics-informatics/sample.csv');
    expect(record).toMatchObject({
      source: 'termium_plus',
      source_record_id: '42',
      dataset_domain: 'electronics informatics',
      subject_en: 'Electronics',
      subject_fr: 'Électronique',
      term_en: 'power bank',
      term_fr: 'batterie externe',
      source_license: importer.LICENSE,
    });
    expect(record.reference_key).toMatch(/^[a-f0-9]{64}$/);
  });

  test('keeps only TERMIUM rows actually present in the current product corpus', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'termium-import-'));
    const csvDir = path.join(root, 'raw', 'electronics');
    const corpusDir = path.join(root, 'workpack');
    fs.mkdirSync(csvDir, { recursive: true });
    fs.mkdirSync(corpusDir, { recursive: true });

    fs.writeFileSync(path.join(csvDir, 'terms.csv'), [
      'id,subject_en,term_en,terme_fr,domaine_fr',
      '1,Electronics,power bank,batterie externe,Électronique',
      '2,Electronics,oscilloscope,oscilloscope,Électronique',
    ].join('\n'));

    fs.writeFileSync(path.join(corpusDir, 'batch-001.json'), JSON.stringify({
      products: [{
        source: {
          title: 'Portable Power Bank 20000mAh',
          description: null,
          materials: null,
        },
      }],
    }));

    const corpus = importer.loadCorpus(corpusDir);
    const { references, stats } = importer.collectRelevantReferences(csvDir, corpus.ngrams);
    expect(references).toHaveLength(1);
    expect(references[0].term_en).toBe('power bank');
    expect(stats.bilingual_rows).toBe(2);
    expect(stats.skipped_unmatched).toBe(1);

    fs.rmSync(root, { recursive: true, force: true });
  });

  test('refuses production or non-local databases', () => {
    expect(() => importer.assertDisposableRuntime({
      KOMERCE_ENV: 'production',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://komerce:komerce@127.0.0.1:5432/komerce_real_catalog_stress',
    })).toThrow(/staging/);

    expect(() => importer.assertDisposableRuntime({
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://prod.example.com/production',
    })).toThrow(/base jetable/);
  });
});
