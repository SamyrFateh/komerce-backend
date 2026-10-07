/**
 * @komerce-arch
 * @role          provider-capability-certification-projector
 * @domain        supplier-connectivity
 * @layer         service
 * @criticality   high
 * @inputs        provider code, external provider capability certification ledger
 * @outputs       observational provider capability evidence, purchasing mode evidence, fail-closed execution certification verdict
 * @depends       services/suppliers/provider-authority.js, governance/external-provider-capability-certifications.json
 * @used-by       services/supplier-360.js, services/product-360.js, services/suppliers/procurement-execution-boundary.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md
 * @impact-areas  supplier-connectivity, purchasing, admin-dashboard, catalog
 * @version       2026-10
 */
'use strict';

const providerAuthority = require('./provider-authority');
const defaultRegistry = require('../../governance/external-provider-capability-certifications.json');

function projectCapabilityCertifications(platform, registry = defaultRegistry) {
  const provider = providerAuthority.normalizeProviderCode(platform);
  const supported = providerAuthority.isSupportedProvider(provider);
  const rawRecords = supported && registry && registry.providers && Array.isArray(registry.providers[provider])
    ? registry.providers[provider]
    : [];

  const records = rawRecords.map(row => Object.freeze({
    capability: row.capability,
    classification: row.classification,
    availability: row.availability,
    highest_proof: row.highest_proof,
    environment: row.environment,
    evidence: Object.freeze(Array.isArray(row.evidence) ? row.evidence.map(String) : []),
    limitations: Object.freeze(Array.isArray(row.limitations) ? row.limitations.map(String) : []),
  }));

  return Object.freeze({
    provider: supported ? provider : null,
    resolution: !supported ? 'UNSUPPORTED_PROVIDER' : (records.length ? 'RECORDED' : 'NO_RECORD'),
    source: 'governance/external-provider-capability-certifications.json',
    authority: 'observational_proof_only',
    records: Object.freeze(records),
  });
}

function projectMode(projection, capability) {
  const record = projection.records.find(row => row.capability === capability);
  if (!record) {
    return Object.freeze({
      capability,
      resolution: projection.resolution === 'UNSUPPORTED_PROVIDER' ? 'UNSUPPORTED_PROVIDER' : 'NO_RECORD',
      classification: null,
      availability: null,
      highest_proof: null,
      environment: null,
    });
  }
  return Object.freeze({
    capability: record.capability,
    resolution: 'RECORDED',
    classification: record.classification,
    availability: record.availability,
    highest_proof: record.highest_proof,
    environment: record.environment,
  });
}

const RUNTIME_ENVIRONMENTS = Object.freeze(['SANDBOX', 'LIVE_STAGING', 'LIVE']);

function normalizeRuntimeEnvironment(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return RUNTIME_ENVIRONMENTS.includes(normalized) ? normalized : null;
}

function certificationEnvironmentAllows(environment, runtimeEnvironment) {
  const certified = String(environment || '').trim().toUpperCase();
  const runtime = normalizeRuntimeEnvironment(runtimeEnvironment);
  if (!runtime || !certified) return false;
  if (runtime === 'SANDBOX') return certified.includes('SANDBOX');
  if (runtime === 'LIVE_STAGING') {
    return certified === 'LIVE_STAGING' || certified.startsWith('LIVE_STAGING_');
  }
  if (runtime === 'LIVE') {
    return ['LIVE', 'PRODUCTION', 'LIVE_PRODUCTION'].includes(certified);
  }
  return false;
}

function evaluateRuntimeCapability(platform, capability, options = {}) {
  const registry = options.registry || defaultRegistry;
  const projection = projectCapabilityCertifications(platform, registry);
  const record = projection.records.find(row => row.capability === capability) || null;
  const runtimeEnvironment = normalizeRuntimeEnvironment(options.runtime_environment);

  if (!record) {
    return Object.freeze({
      allowed: false,
      reason: projection.resolution === 'UNSUPPORTED_PROVIDER'
        ? 'CERTIFICATION_PROVIDER_UNSUPPORTED'
        : 'CERTIFICATION_CAPABILITY_NOT_RECORDED',
      provider: projection.provider,
      capability,
      runtime_environment: runtimeEnvironment,
      certified_environment: null,
    });
  }

  if (record.classification === 'GAP') {
    return Object.freeze({
      allowed: false,
      reason: 'CERTIFICATION_CAPABILITY_GAP',
      provider: projection.provider,
      capability,
      classification: record.classification,
      availability: record.availability,
      runtime_environment: runtimeEnvironment,
      certified_environment: record.environment,
    });
  }

  if (record.classification !== 'CONFIRMED' || String(record.availability || '').toUpperCase() !== 'PROVEN') {
    return Object.freeze({
      allowed: false,
      reason: 'CERTIFICATION_CAPABILITY_NOT_PROVEN',
      provider: projection.provider,
      capability,
      classification: record.classification,
      availability: record.availability,
      runtime_environment: runtimeEnvironment,
      certified_environment: record.environment,
    });
  }

  if (!runtimeEnvironment) {
    return Object.freeze({
      allowed: false,
      reason: 'CERTIFICATION_RUNTIME_ENVIRONMENT_REQUIRED',
      provider: projection.provider,
      capability,
      classification: record.classification,
      availability: record.availability,
      runtime_environment: null,
      certified_environment: record.environment,
    });
  }

  if (!certificationEnvironmentAllows(record.environment, runtimeEnvironment)) {
    return Object.freeze({
      allowed: false,
      reason: 'CERTIFICATION_ENVIRONMENT_MISMATCH',
      provider: projection.provider,
      capability,
      classification: record.classification,
      availability: record.availability,
      runtime_environment: runtimeEnvironment,
      certified_environment: record.environment,
    });
  }

  return Object.freeze({
    allowed: true,
    reason: null,
    provider: projection.provider,
    capability,
    classification: record.classification,
    availability: record.availability,
    highest_proof: record.highest_proof,
    runtime_environment: runtimeEnvironment,
    certified_environment: record.environment,
  });
}

function projectPurchasingModeEvidence(platform, registry = defaultRegistry) {
  const projection = projectCapabilityCertifications(platform, registry);
  return Object.freeze({
    provider: projection.provider,
    resolution: projection.resolution,
    source: projection.source,
    authority: projection.authority,
    manual_procurement: projectMode(projection, 'purchasing.manual_procurement'),
    auto_order: projectMode(projection, 'purchasing.auto_order'),
  });
}

module.exports = {
  RUNTIME_ENVIRONMENTS,
  projectCapabilityCertifications,
  projectPurchasingModeEvidence,
  normalizeRuntimeEnvironment,
  certificationEnvironmentAllows,
  evaluateRuntimeCapability,
};
