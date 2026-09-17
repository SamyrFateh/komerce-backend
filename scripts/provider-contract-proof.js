/**
 * @komerce-arch
 * @role          provider-contract-proof
 * @domain        purchasing
 * @layer         script
 * @criticality   high
 * @inputs        provider contract checks grouped by proof stage
 * @outputs       normalized proof report and fail-closed stage assertion
 * @depends       none
 * @used-by       provider sandbox probes and Golden E2E runners
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md
 * @impact-areas  sourcing, purchasing, supplier-integration, tests
 */
'use strict';

const STAGES = Object.freeze([
  Object.freeze({ id: 'P0', name: 'BUSINESS_READINESS' }),
  Object.freeze({ id: 'P1', name: 'RAW_API' }),
  Object.freeze({ id: 'P2', name: 'ADAPTER' }),
  Object.freeze({ id: 'P3', name: 'PIPELINE' }),
  Object.freeze({ id: 'P4', name: 'GOLDEN_E2E' }),
]);

const STAGE_INDEX = new Map(STAGES.map((stage, index) => [stage.id, index]));
const SAFE_ID = /^[A-Z0-9_][A-Z0-9_.-]{0,119}$/;

function safeId(value, label) {
  const id = String(value || '').trim().toUpperCase();
  if (!SAFE_ID.test(id)) throw new Error(`PROVIDER_CONTRACT_${label}_INVALID`);
  return id;
}

function normalizeCheck(check) {
  if (!check || typeof check !== 'object') throw new Error('PROVIDER_CONTRACT_CHECK_INVALID');
  const id = safeId(check.id, 'CHECK_ID');
  if (typeof check.pass !== 'boolean') throw new Error(`PROVIDER_CONTRACT_CHECK_RESULT_INVALID_${id}`);
  const evidence = check.evidence == null ? null : String(check.evidence).trim().slice(0, 240);
  return Object.freeze({ id, pass: check.pass, evidence: evidence || null });
}

function buildProof({ provider, environment, stages }) {
  const providerId = safeId(provider, 'PROVIDER');
  const environmentId = safeId(environment, 'ENVIRONMENT');
  const source = stages && typeof stages === 'object' ? stages : {};
  const normalizedStages = STAGES.map(stage => {
    const checks = (Array.isArray(source[stage.id]) ? source[stage.id] : []).map(normalizeCheck);
    const status = checks.length > 0 && checks.every(check => check.pass) ? 'PASS' : 'BLOCKED';
    return Object.freeze({ id: stage.id, name: stage.name, status, checks });
  });
  return Object.freeze({
    provider: providerId,
    environment: environmentId,
    stages: normalizedStages,
  });
}

function assertThrough(proof, through = 'P1') {
  if (!proof || !Array.isArray(proof.stages)) throw new Error('PROVIDER_CONTRACT_PROOF_INVALID');
  const target = safeId(through, 'STAGE');
  const targetIndex = STAGE_INDEX.get(target);
  if (targetIndex == null) throw new Error(`PROVIDER_CONTRACT_STAGE_UNKNOWN_${target}`);

  for (const stage of proof.stages.slice(0, targetIndex + 1)) {
    if (stage.status === 'PASS') continue;
    const failed = stage.checks.find(check => !check.pass);
    const checkId = failed?.id || 'NO_PROOF';
    throw new Error(`PROVIDER_CONTRACT_BLOCKED_${proof.provider}_${stage.id}_${checkId}`);
  }
  return proof;
}

function summary(proof) {
  if (!proof || !Array.isArray(proof.stages)) throw new Error('PROVIDER_CONTRACT_PROOF_INVALID');
  return {
    provider: proof.provider,
    environment: proof.environment,
    stages: proof.stages.map(stage => ({
      id: stage.id,
      name: stage.name,
      status: stage.status,
      failed_checks: stage.checks.filter(check => !check.pass).map(check => check.id),
    })),
  };
}

module.exports = { STAGES, buildProof, assertThrough, summary };
