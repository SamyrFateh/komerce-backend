'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  pool: { end: jest.fn() },
}));
jest.mock('../../services/suppliers/catalog-import-orchestrator', () => ({
  importCatalog: jest.fn(),
}));
jest.mock('../../services/sourcing-candidate-actions', () => ({
  promoteCandidate: jest.fn(),
}));
jest.mock('../../services/catalog-overrides', () => ({
  upsertOverrides: jest.fn(),
}));
jest.mock('../../scripts/cj-reconcile-current-new-12-promote', () => ({
  NEW_UNIQUE_IDS: Array.from({ length: 12 }, (_, i) => `cj-new-${i + 1}`),
}));
jest.mock('../../scripts/catalog-cj-certified-500-materialize', () => ({
  decodeCertifiedIds: jest.fn(() => Array.from({ length: 500 }, (_, i) => `cj-old-${i + 1}`)),
  CERTIFIED_RUN_ID: 36299995007,
  SNAPSHOT_ENV: 'KOMERCE_CJ_CERTIFIED_500_IDS_GZIP_B64',
}));

const fs=require('fs');
const os=require('os');
const path=require('path');
const zlib=require('zlib');

const db=require('../../db');
const transfer=require('../../scripts/catalog-712-transfer');
const audit=require('../../scripts/catalog-712-production-exclusion-audit');
const importer=require('../../scripts/catalog-712-transfer-import');

describe('catalog 712 certified transfer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('source runtime must be isolated and destination must be different real DB', () => {
    expect(transfer.assertRuntime({
      KOMERCE_ALLOW_CATALOG_712_PRODUCTION_IMPORT:'1',
      DATABASE_URL:'postgres://u:p@ali-e2e-200-postgres.railway.internal:5432/source',
      KOMERCE_CATALOG_DEST_DATABASE_URL:'postgres://u:p@Postgres.railway.internal:5432/real',
    })).toMatchObject({
      source_host:'ali-e2e-200-postgres.railway.internal',
      dest_host:'postgres.railway.internal',
    });

    expect(() => transfer.assertRuntime({
      KOMERCE_ALLOW_CATALOG_712_PRODUCTION_IMPORT:'1',
      DATABASE_URL:'postgres://u:p@Postgres.railway.internal:5432/source',
      KOMERCE_CATALOG_DEST_DATABASE_URL:'postgres://u:p@Postgres.railway.internal:5432/real',
    })).toThrow(/SOURCE_DB_NOT_ISOLATED/);
  });

  test('destination runtime refuses isolated E2E database', () => {
    expect(() => importer.assertRuntime({
      KOMERCE_ALLOW_CATALOG_712_PRODUCTION_IMPORT:'1',
      KOMERCE_CATALOG_TRANSFER_ROLE:'destination',
      DATABASE_URL:'postgres://u:p@ali-e2e-200-postgres.railway.internal:5432/source',
    })).toThrow(/DEST_DB_IS_E2E_SOURCE/);
  });

  test('transfer and exclusion audit select the exact certified CJ 512 identities, never the broad campaign', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const snapshotEnv={KOMERCE_CJ_CERTIFIED_500_IDS_GZIP_B64:'fixture'};
    await expect(transfer.loadBundle(snapshotEnv)).rejects.toThrow(/SOURCE_712_BUNDLE_INVALID/);

    let [sql, params] = db.query.mock.calls[0];
    expect(sql).not.toMatch(/discovery,campaign/);
    expect(sql).toMatch(/supplier_product_id\s*=\s*ANY\(\$2::text\[\]\)/);
    expect(params).toHaveLength(2);
    expect(params[1]).toHaveLength(512);
    expect(params[1].slice(0, 2)).toEqual(['cj-old-1', 'cj-old-2']);
    expect(params[1].slice(-2)).toEqual(['cj-new-11', 'cj-new-12']);
    expect(new Set(params[1]).size).toBe(512);

    db.query.mockClear();
    db.query.mockResolvedValue({ rows: [] });
    await expect(audit.expectedIdentities(snapshotEnv)).rejects.toThrow(/SOURCE_712_IDENTITIES_INVALID/);

    [sql, params] = db.query.mock.calls[0];
    expect(sql).not.toMatch(/discovery,campaign/);
    expect(sql).toMatch(/supplier_product_id\s*=\s*ANY\(\$2::text\[\]\)/);
    expect(params).toHaveLength(2);
    expect(params[1]).toHaveLength(512);
    expect(new Set(params[1]).size).toBe(512);
  });

  test('falls back to persisted certified-run provenance when the legacy snapshot env is absent', async () => {
    const historical=Array.from({length:500},(_,i)=>({supplier_product_id:`cj-old-${i+1}`}));
    db.query
      .mockResolvedValueOnce({rows:historical})
      .mockResolvedValueOnce({rows:[]});

    await expect(transfer.loadBundle({})).rejects.toThrow(/SOURCE_712_BUNDLE_INVALID/);

    const [provenanceSql, provenanceParams]=db.query.mock.calls[0];
    expect(provenanceSql).toMatch(/certified_run_id/);
    expect(provenanceSql).toMatch(/certified-artifact\+exact-product-query/);
    expect(provenanceSql).toMatch(/historical_final_acceptance_500_of_500/);
    expect(provenanceParams).toEqual(['36299995007','github-actions-run-36299995007']);

    const [selectionSql, selectionParams]=db.query.mock.calls[1];
    expect(selectionSql).not.toMatch(/discovery,campaign/);
    expect(selectionParams[1]).toHaveLength(512);
    expect(selectionParams[1].slice(0,2)).toEqual(['cj-old-1','cj-old-2']);
    expect(selectionParams[1].slice(-2)).toEqual(['cj-new-11','cj-new-12']);
  });

  test('bundle parser requires exactly 712 unique supplier identities', () => {
    const products=Array.from({length:712},(_,i)=>({
      supplier_name:i<200?'AliExpress':'CJdropshipping',
      supplier_product_id:`id-${i+1}`,
    }));
    const bundle={schema_version:1,dataset_id:'catalog-e2e-712-v1',total:712,products};
    const file=path.join(os.tmpdir(),`catalog-712-transfer-test-${process.pid}.json.gz`);
    fs.writeFileSync(file,zlib.gzipSync(Buffer.from(JSON.stringify(bundle))));
    try{
      expect(importer.readBundle(file).products).toHaveLength(712);
    }finally{
      fs.unlinkSync(file);
    }
  });

  test('bundle parser refuses duplicate identity', () => {
    const products=Array.from({length:712},(_,i)=>({
      supplier_name:i<200?'AliExpress':'CJdropshipping',
      supplier_product_id:`id-${i+1}`,
    }));
    products[711]={...products[710]};
    const bundle={schema_version:1,dataset_id:'catalog-e2e-712-v1',total:712,products};
    const file=path.join(os.tmpdir(),`catalog-712-transfer-test-dup-${process.pid}.json.gz`);
    fs.writeFileSync(file,zlib.gzipSync(Buffer.from(JSON.stringify(bundle))));
    try{
      expect(() => importer.readBundle(file)).toThrow(/DUPLICATE_IDENTITY/);
    }finally{
      fs.unlinkSync(file);
    }
  });
});
