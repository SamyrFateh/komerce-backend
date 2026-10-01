/**
 * @komerce-arch
 * @role          external-provider-onboarding-contracts
 * @domain        external-provider-contracts
 * @layer         service
 * @criticality   high
 * @inputs        governance/external-provider-registry.json, provider_id, public_auth_contract
 * @outputs       safe_human_onboarding_contract, onboarding_readiness
 * @depends       governance/external-provider-registry.json
 * @used-by       services/sourcing-import-dispatch.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_ONBOARDING.md, docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md
 * @impact-areas  sourcing, catalog, external-provider-contracts
 * @version       2026-10
 */
'use strict';

const registry = require('../governance/external-provider-registry.json');

const ALLOWED_AUTHORITIES = new Set(['provider_documentation', 'provider_confirmation']);
const ALLOWED_OWNERS = new Set([
  'partner_account',
  'integration_application',
  'komerce_platform_application',
  'provider_managed',
  'none',
]);

function text(value, max = 500) {
  const out = String(value ?? '').replace(/\s+/g, ' ').trim();
  return out ? out.slice(0, max) : null;
}

function strings(values, maxItems = 12) {
  return (Array.isArray(values) ? values : [])
    .map((value) => text(value))
    .filter(Boolean)
    .slice(0, maxItems);
}

function providerRow(providerId) {
  const id = String(providerId || '').trim().toLowerCase();
  return (registry.providers || []).find((provider) => String(provider.id || '').toLowerCase() === id) || null;
}

function safeUrl(value) {
  const url = text(value, 1000);
  return url && /^https:\/\//i.test(url) ? url : null;
}

function publicContract(providerId) {
  const row = providerRow(providerId);
  const onboarding = row?.onboarding || null;
  if (!row || !onboarding) {
    return {
      provider_id: row?.id || String(providerId || '').trim().toLowerCase() || null,
      status: 'missing',
      authority: null,
      evidence_url: null,
      credential_owner: null,
      prerequisites: [],
      setup_steps: [],
      operator_must_obtain: [],
      operator_must_not_request: [],
      completion: null,
      blocker: null,
    };
  }

  return {
    provider_id: row.id,
    status: text(onboarding.status, 40) || 'missing',
    authority: text(onboarding.authority, 80),
    evidence_url: safeUrl(onboarding.evidence_url),
    credential_owner: text(onboarding.credential_owner, 80),
    prerequisites: strings(onboarding.prerequisites),
    setup_steps: strings(onboarding.setup_steps),
    operator_must_obtain: (Array.isArray(onboarding.operator_must_obtain) ? onboarding.operator_must_obtain : [])
      .map((item) => ({
        key: text(item?.key, 120),
        label: text(item?.label, 200),
      }))
      .filter((item) => item.key && item.label)
      .slice(0, 12),
    operator_must_not_request: strings(onboarding.operator_must_not_request),
    completion: text(onboarding.completion, 800),
    blocker: text(onboarding.blocker, 800),
  };
}

function keySet(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function checkReady(providerId, auth = {}) {
  const contract = publicContract(providerId);
  const fail = (reason) => ({ ready: false, reason, contract });

  if (contract.status === 'blocked') return fail('provider_onboarding_blocked');
  if (contract.status !== 'defined') return fail('provider_onboarding_not_defined');
  if (!ALLOWED_AUTHORITIES.has(contract.authority)) return fail('provider_onboarding_authority_missing');
  if (!contract.evidence_url) return fail('provider_onboarding_evidence_missing');
  if (!ALLOWED_OWNERS.has(contract.credential_owner)) return fail('provider_onboarding_credential_owner_missing');
  if (!contract.prerequisites.length) return fail('provider_onboarding_prerequisite_missing');
  if (!contract.setup_steps.length) return fail('provider_onboarding_setup_missing');
  if (!contract.completion) return fail('provider_onboarding_completion_missing');

  const mode = String(auth?.mode || 'none');
  const scope = String(auth?.scope || '');
  const authKeys = keySet((auth?.fields || []).map((field) => field?.key));
  const onboardingKeys = keySet(contract.operator_must_obtain.map((field) => field.key));

  if (scope === 'source' && ['api_key', 'client_credentials'].includes(mode)) {
    if (!authKeys.length) return fail('provider_auth_fields_missing');
    if (authKeys.join('|') !== onboardingKeys.join('|')) return fail('provider_onboarding_auth_fields_mismatch');
  }

  if (mode === 'oauth' && onboardingKeys.length) {
    return fail('provider_onboarding_oauth_must_not_request_credentials');
  }

  return { ready: true, reason: null, contract };
}

module.exports = {
  publicContract,
  checkReady,
  _providerRow: providerRow,
};
