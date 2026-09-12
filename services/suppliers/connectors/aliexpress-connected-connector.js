/**
 * @komerce-arch
 * @role          aliexpress-connected-source-connector
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        AliExpress sourcing filters + managed OAuth session
 * @outputs       normalized_supplier_product_v2
 * @depends       services/suppliers/connectors/aliexpress-connector.js, services/suppliers/aliexpress-oauth.js
 * @used-by       services/sourcing-import-dispatch.js
 * @db-read       supplier_oauth_connections
 * @db-write      supplier_oauth_connections (token refresh only)
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md
 * @impact-areas  catalog, sourcing, supplier-import
 * @version       2026-09-v1
 */
'use strict';

const baseConnector = require('./aliexpress-connector');
const oauth = require('../aliexpress-oauth');

function isRuntimeConfigured(env = process.env) {
  const hasApp = Boolean(env.ALIEXPRESS_APP_KEY && env.ALIEXPRESS_APP_SECRET);
  const hasSessionPath = Boolean(env.ALIEXPRESS_SESSION || env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY);
  return hasApp && hasSessionPath;
}

function inactiveReason(env = process.env) {
  if (!env.ALIEXPRESS_APP_KEY || !env.ALIEXPRESS_APP_SECRET) {
    return 'ALIEXPRESS_APP_KEY et ALIEXPRESS_APP_SECRET requis';
  }
  if (!env.ALIEXPRESS_SESSION && !env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY) {
    return 'ALIEXPRESS_TOKEN_ENCRYPTION_KEY requise pour la session OAuth gérée';
  }
  return null;
}

async function fetchProducts(options = {}) {
  const env = options.env || process.env;
  if (!isRuntimeConfigured(env)) throw new Error(`[AliExpress] ${inactiveReason(env)}`);

  const session = env.ALIEXPRESS_SESSION || await oauth.getValidAccessToken({
    env,
    dbImpl: options.dbImpl,
    fetchImpl: options.oauthFetchImpl,
    now: options.now,
  });

  return baseConnector.fetchProducts({
    ...options,
    env: { ...env, ALIEXPRESS_SESSION: session },
  });
}

const IS_ACTIVE = isRuntimeConfigured(process.env);
const INACTIVE_REASON = inactiveReason(process.env);

module.exports = {
  ...baseConnector,
  IS_ACTIVE,
  INACTIVE_REASON,
  isRuntimeConfigured,
  inactiveReason,
  fetchProducts,
};
