/**
 * @komerce-arch
 * @role          provider-certification-overview
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        governance_provider_capability_registry, KOMERCE_PROVIDER_EXECUTION_ENV
 * @outputs       provider_capability_matrix_with_runtime_decision
 * @depends       services/suppliers/provider-capability-certifications.js, services/procurement-execution-context.js
 * @used-by       routes/admin-providers-capabilities.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      activation_is_not_authorization, runtime_certification_decides, provider_secrets_never_exposed, observational_proof_only
 * @impact-areas  admin-dashboard, supplier-connectivity, external-provider-contracts
 * @version       2026-10
 */
'use strict';

const certifications = require('./suppliers/provider-capability-certifications');
const executionContext = require('./procurement-execution-context');
const defaultRegistry = require('../governance/external-provider-capability-certifications.json');

// Lecture seule du registre de preuves + décision runtime EXACTEMENT telle que
// la prennent les gardes d'exécution (evaluateRuntimeCapability). Aucun secret,
// aucun flag d'activation : activer un provider n'autorise pas son exécution.
function buildProviderCertificationOverview({ registry = defaultRegistry, env = process.env } = {}) {
  let runtimeEnvironment = null;
  let environmentError = null;
  try {
    runtimeEnvironment = executionContext.resolveCertificationEnvironment(env);
  } catch (error) {
    environmentError = error.message;
  }

  const providerCodes = Object.keys((registry && registry.providers) || {}).sort();
  const providers = providerCodes.map(code => {
    const projection = certifications.projectCapabilityCertifications(code, registry);
    // Le registre documente aussi des providers hors garde d'exécution
    // (paiement, messagerie…) : leurs preuves restent visibles, mais la décision
    // runtime est celle que le code prendrait réellement (provider non supporté).
    const guarded = projection.resolution !== 'UNSUPPORTED_PROVIDER';
    const rows = Array.isArray(registry.providers[code]) ? registry.providers[code] : [];
    const records = rows.map(record => {
      const decision = certifications.evaluateRuntimeCapability(code, record.capability, {
        registry,
        runtime_environment: runtimeEnvironment,
      });
      return Object.freeze({
        capability: record.capability,
        classification: record.classification,
        availability: record.availability,
        highest_proof: record.highest_proof,
        environment: record.environment,
        evidence: Object.freeze(Array.isArray(record.evidence) ? record.evidence.map(String) : []),
        limitations: Object.freeze(Array.isArray(record.limitations) ? record.limitations.map(String) : []),
        runtime_decision: Object.freeze({ allowed: decision.allowed === true, reason: decision.reason || null }),
      });
    });
    return Object.freeze({
      provider: code,
      runtime_guarded: guarded,
      records: Object.freeze(records),
    });
  });

  return Object.freeze({
    runtime_environment: runtimeEnvironment,
    runtime_environment_error: environmentError,
    authority: 'observational_proof_only',
    activation_notice: 'Activer un provider n’autorise pas son exécution : seule la certification runtime décide.',
    source: 'governance/external-provider-capability-certifications.json',
    providers: Object.freeze(providers),
  });
}

module.exports = { buildProviderCertificationOverview };
