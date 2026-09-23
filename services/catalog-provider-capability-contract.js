/**
 * @komerce-arch
 * @role          catalog-provider-capability-contract
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        provider_capability_descriptor
 * @outputs       normalized_provider_capabilities
 * @depends       none
 * @used-by       supplier connectors, catalog diagnostics
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CATALOG_CHANGE_INTAKE.md
 * @impact-areas  catalog, supplier-connectivity
 * @version       2026-09
 */
'use strict';

const CAPABILITIES = Object.freeze([
  'discovery',
  'exact_read',
  'change_feed',
  'webhook',
  'stock_read',
  'price_read',
  'offer_status_read',
  'media_read',
  'stock_write',
  'price_write',
  'content_write',
  'publication_write',
  'atomic_reservation',
  'purchase',
]);

function normalizeState(input = {}) {
  const documented = input.documented === true;
  const authorized = input.authorized === true;
  const implemented = input.implemented === true;
  const proved = input.proved === true;
  if (proved && !implemented) throw new TypeError('proved capability must be implemented');
  if (implemented && !documented && input.documented !== null) {
    // A connector may implement a private/legacy contract whose documentation
    // state is explicitly unknown (null), but must not claim documented=false.
    throw new TypeError('implemented capability cannot contradict documented=false');
  }
  return Object.freeze({
    documented: input.documented === null ? null : documented,
    authorized: input.authorized === null ? null : authorized,
    implemented,
    proved,
    scope: input.scope == null ? null : String(input.scope),
  });
}

function normalizeProviderCapabilityDescriptor(input = {}) {
  const provider = String(input.provider || '').trim().toLowerCase();
  if (!provider) throw new TypeError('provider required');
  const environment = String(input.environment || '').trim().toLowerCase();
  if (!environment) throw new TypeError('environment required');
  const caps = {};
  const source = input.capabilities || {};
  for (const name of CAPABILITIES) {
    caps[name] = normalizeState(source[name] || {
      documented: null, authorized: null, implemented: false, proved: false,
    });
  }
  for (const name of Object.keys(source)) {
    if (!CAPABILITIES.includes(name)) throw new TypeError(`unknown capability: ${name}`);
  }
  return Object.freeze({
    schema_version: 1,
    provider,
    environment,
    account_scope: input.account_scope == null ? null : String(input.account_scope),
    capabilities: Object.freeze(caps),
  });
}

module.exports = { CAPABILITIES, normalizeProviderCapabilityDescriptor };
