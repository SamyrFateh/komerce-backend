/**
 * @komerce-arch
 * @role          isolated-e2e-runtime-guard
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        process environment and DATABASE_URL
 * @outputs       fail-closed disposable E2E runtime proof
 * @depends       none
 * @used-by       supplier E2E stress and final acceptance scripts
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      staging_test_only, disposable_database_only, explicit_railway_dataset
 * @impact-areas  catalog, sourcing, staging-e2e
 * @version       2026-09-v1
 */
'use strict';

const RAILWAY_FLAG = 'KOMERCE_ALLOW_RAILWAY_ISOLATED_E2E';
const DATASET_ENV = 'KOMERCE_E2E_DATASET_ID';
const CANONICAL_700_DATASET = 'catalog-e2e-700-v1';
const LOCAL_DB = 'komerce_real_catalog_stress';

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function parseDatabaseUrl(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL requis');
  const url = new URL(env.DATABASE_URL);
  return {
    url,
    host: String(url.hostname || '').toLowerCase(),
    dbName: String(url.pathname || '').replace(/^\//, ''),
  };
}

function assertIsolatedE2eRuntime(env = process.env) {
  if (String(env.KOMERCE_ENV || '').trim().toLowerCase() !== 'staging' || env.NODE_ENV !== 'test') {
    throw new Error('REFUS: KOMERCE_ENV=staging et NODE_ENV=test requis');
  }

  const { host, dbName } = parseDatabaseUrl(env);
  const local = ['127.0.0.1', 'localhost'].includes(host) && dbName === LOCAL_DB;
  if (local) return { mode: 'local-disposable', dataset_id: null, host, db_name: dbName };

  const railway = host.endsWith('.railway.internal')
    && isTruthy(env[RAILWAY_FLAG])
    && String(env[DATASET_ENV] || '').trim() === CANONICAL_700_DATASET
    && isTruthy(env.KOMERCE_DISABLE_CRONS);

  if (!railway) {
    throw new Error(
      `REFUS: base E2E isolée requise (localhost/${LOCAL_DB} ou Railway explicite ${CANONICAL_700_DATASET})`
    );
  }

  return {
    mode: 'railway-isolated',
    dataset_id: CANONICAL_700_DATASET,
    host,
    db_name: dbName,
  };
}

module.exports = {
  RAILWAY_FLAG,
  DATASET_ENV,
  CANONICAL_700_DATASET,
  LOCAL_DB,
  isTruthy,
  parseDatabaseUrl,
  assertIsolatedE2eRuntime,
};
