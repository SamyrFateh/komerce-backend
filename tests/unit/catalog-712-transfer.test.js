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

const fs=require('fs');
const os=require('os');
const path=require('path');
const zlib=require('zlib');

const transfer=require('../../scripts/catalog-712-transfer');
const importer=require('../../scripts/catalog-712-transfer-import');

describe('catalog 712 certified transfer', () => {
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
