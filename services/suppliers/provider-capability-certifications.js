/**
 * @komerce-arch
 * @role          provider-capability-certification-projector
 * @domain        supplier-connectivity
 * @layer         service
 * @criticality   high
 * @inputs        provider code, external provider capability certification ledger
 * @outputs       observational provider capability evidence, purchasing mode evidence
 * @depends       services/suppliers/provider-authority.js, governance/external-provider-capability-certifications.json
 * @used-by       services/supplier-360.js, services/product-360.js
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
  projectCapabilityCertifications,
  projectPurchasingModeEvidence,
};
